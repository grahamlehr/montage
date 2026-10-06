import { buildTimeline, frameAt } from '../engine';
import { decodePhoto, decodeSizeFor } from '../ingest';
import { createRenderer } from '../render';
import type { MontageRenderer } from '../render';
import type { Timeline } from '../types';
import type { FrameSource } from './frameSource';

/**
 * Real export frame source: decodes each File at export size inside the worker, builds the same
 * timeline as the preview (same overrides + settings + seed), and draws frameAt(i / fps) with the
 * WebGL2 renderer on the OffscreenCanvas. Only the photos around the current segment stay resident
 * (previous, current, next); photos are decoded ahead of need and released once passed.
 */
export function createMontageSource(): FrameSource {
  let renderer: MontageRenderer | null = null;
  let timeline: Timeline | null = null;
  let files: File[] = [];
  let sizes: { width: number; height: number }[] = [];
  let out = { width: 0, height: 0 };
  let disposed = false;
  let cursor = 0; // current segment index (monotonic except when an encoder retry restarts at frame 0)
  const entries = new Map<number, Promise<ImageBitmap | null>>();

  const load = (i: number): Promise<ImageBitmap | null> => {
    const existing = entries.get(i);
    if (existing) return existing;
    const file = files[i];
    const size = sizes[i];
    if (!file || !size) return Promise.resolve(null);
    const p = decodePhoto(file, decodeSizeFor(out, size)).then((bmp) => {
      if (disposed || entries.get(i) !== p) {
        bmp.close(); // released while decoding
        return null;
      }
      renderer?.setPhoto(i, bmp);
      return bmp;
    });
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
      renderer.setSize(settings.width, settings.height);
      renderer.setBackground(settings.background);
      const first = Math.min(2, files.length);
      let done = 0;
      onDecodeProgress(0, first);
      await Promise.all(
        Array.from({ length: first }, (_, i) => load(i).then(() => onDecodeProgress(++done, first))),
      );
    },
    async draw(_frameIndex, t) {
      if (!renderer || !timeline) throw new Error('not initialised');
      const segs = timeline.segments;
      // Going backwards (export retry restarts at frame 0): rewind; the residency window re-decodes as needed.
      while (cursor > 0 && (segs[cursor]?.start ?? 0) > t) cursor--;
      while (cursor + 1 < segs.length && (segs[cursor + 1]?.start ?? Infinity) <= t) cursor++;
      // Window: previous (still visible in a transition), current, next (decoded ahead).
      const wanted = new Set([cursor - 1, cursor, cursor + 1].filter((i) => i >= 0 && i < segs.length));
      for (const i of [...entries.keys()]) if (!wanted.has(i)) release(i);
      const needed = [cursor - 1, cursor].filter((i) => wanted.has(i));
      const ahead = cursor + 1;
      if (wanted.has(ahead)) void load(ahead).catch(() => undefined);
      await Promise.all(needed.map((i) => load(i)));
      renderer.draw(frameAt(timeline, t));
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
