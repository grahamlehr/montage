import { buildTimeline, frameAt } from '../engine';
import { decodePhoto } from '../ingest';
import { createRenderer } from '../render';
import type { MontageRenderer } from '../render';
import type { Timeline } from '../types';
import type { FrameSource } from './frameSource';
import { photosForSegments, segmentIndexAt } from './residency';
import type { PhotoDecode, Size } from './residency';

/**
 * Real export frame source: decodes each File inside the worker, builds the same timeline as the preview
 * (same overrides + settings + seed), and draws frameAt(i / fps) with the WebGL2 renderer on the
 * OffscreenCanvas. Residency is by shot (§4.7.6): only the photos of the previous, current and next
 * segment stay resident, each decoded at its cell size; photos are decoded ahead of need and released
 * once their shot has passed.
 */
export function createMontageSource(): FrameSource {
  let renderer: MontageRenderer | null = null;
  let timeline: Timeline | null = null;
  let files: File[] = [];
  let sizes: Size[] = [];
  let out: Size = { width: 0, height: 0 };
  let disposed = false;
  /** Set on any context loss or restore: a restore wipes every texture, so later frames would be blank. */
  let contextLost = false;
  const entries = new Map<number, Promise<ImageBitmap | null>>();

  const load = ({ photoIndex: i, maxW, maxH }: PhotoDecode): Promise<ImageBitmap | null> => {
    const existing = entries.get(i);
    if (existing) return existing;
    const file = files[i];
    if (!file) return Promise.resolve(null);
    const p: Promise<ImageBitmap | null> = decodePhoto(file, { maxW, maxH }).then(
      (bmp) => {
        if (disposed || entries.get(i) !== p) {
          bmp.close(); // released while decoding
          return null;
        }
        renderer?.setPhoto(i, bmp);
        return bmp;
      },
      (err: unknown) => {
        // Don't cache a failed decode: the next draw retries it.
        if (entries.get(i) === p) entries.delete(i);
        throw err;
      },
    );
    entries.set(i, p);
    return p;
  };

  const release = (i: number) => {
    const p = entries.get(i);
    if (!p) return;
    entries.delete(i);
    renderer?.setPhoto(i, null);
    void p.then((bmp) => bmp?.close()).catch(() => undefined);
  };

  const photosOfSegments = (segs: number[]): PhotoDecode[] =>
    timeline ? photosForSegments(timeline, segs, out, sizes) : [];

  return {
    async init(canvas, request, onDecodeProgress) {
      const { settings } = request;
      const photos = request.photos;
      files = request.files;
      sizes = photos.map((p) => ({ width: p.naturalWidth, height: p.naturalHeight }));
      out = { width: settings.width, height: settings.height };
      const built = buildTimeline(photos, request.overrides, settings);
      if (!built.ok) throw new Error(built.error);
      timeline = built.timeline;
      renderer = createRenderer(canvas);
      renderer.onContextEvent(() => {
        contextLost = true;
      });
      renderer.setSize(settings.width, settings.height);
      renderer.setBackground(settings.background);
      const first = photosOfSegments([0, 1]);
      let done = 0;
      onDecodeProgress(0, first.length);
      await Promise.all(first.map((d) => load(d).then(() => onDecodeProgress(++done, first.length))));
    },
    async draw(_frameIndex, t) {
      if (!renderer || !timeline) throw new Error('not initialised');
      // Derived from t alone, so going backwards (an encoder retry restarting at frame 0) rewinds the
      // window and re-decodes whatever it needs.
      const n = timeline.segments.length;
      const cur = segmentIndexAt(timeline, t);
      // Window: previous shot (still visible in a transition), current, next (decoded ahead). On a looping
      // timeline the last shot's next is shot 0 (the wrap, §4.9); shot 0's own transition-in is that wrap,
      // so it never needs a previous shot at the start of the video.
      const next = timeline.loop ? (cur + 1) % n : cur + 1;
      const wrap = timeline.loop ? timeline.segments[0]?.transitionIn : null;
      const inWrap = cur === n - 1 && !!wrap && t >= wrap.start;
      // The wrap needs shot 0 on screen as soon as it starts.
      const needed = photosOfSegments(inWrap ? [cur - 1, cur, next] : [cur - 1, cur]);
      const ahead = photosOfSegments([next]).filter((d) => !needed.some((x) => x.photoIndex === d.photoIndex));
      const wanted = new Set([...needed, ...ahead].map((d) => d.photoIndex));
      for (const i of [...entries.keys()]) if (!wanted.has(i)) release(i);
      for (const d of ahead) void load(d).catch(() => undefined);
      await Promise.all(needed.map((d) => load(d)));
      renderer.draw(frameAt(timeline, t));
      // A lost context makes draw() a no-op, which would silently encode stale frames: fail the export instead.
      if (renderer.isContextLost() || contextLost) {
        throw new Error('The graphics (WebGL) context was lost during export. Please try exporting again.');
      }
    },
    dispose() {
      disposed = true;
      for (const i of [...entries.keys()]) release(i);
      renderer?.dispose();
      renderer = null;
      timeline = null;
    },
  };
}
