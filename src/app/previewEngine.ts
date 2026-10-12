import { frameAt } from '../engine';
import { photosForSegments, segmentIndexAt, segmentWindow } from '../export/residency';
import type { PhotoDecode } from '../export/residency';
import { decodePhoto } from '../ingest';
import { createRenderer } from '../render';
import type { MontageRenderer, RendererStats } from '../render';
import type { MontageSettings, PhotoSource, Timeline } from '../types';

/** How many shots behind / ahead of the current segment stay resident (§4.6, §4.7.6). */
const BEHIND = 1;
const AHEAD = 2; // next shot + one extra lookahead
/** A failed decode is retried after this long if the photo is still wanted (transient failures, e.g. memory). */
const DECODE_RETRY_MS = 2000;

interface Entry {
  id: string;
  key: string; // decode bounds; a photo regrouped into a different cell size re-decodes
  bmp: ImageBitmap | null;
  /** performance.now() of the last failed decode; null unless it failed. */
  failedAt: number | null;
}

export interface PreviewStats {
  renderer: RendererStats;
  /** Decoded bitmaps currently held by the preview. */
  residentBitmaps: number;
  /** Decodes in flight or finished but not yet evicted. */
  entries: number;
}

export interface PreviewHooks {
  onTime(t: number): void;
  /** Playback stopped on its own: reached the end (not looping) or the timeline went away. */
  onEnded(): void;
}

/**
 * Drives the preview canvas: owns the renderer, a small window of decoded photo bitmaps (the photos of
 * the shots around the playhead, each decoded at its cell size; closed + setPhoto(i, null) on eviction)
 * and the rAF playback clock.
 * Plain class so React re-renders never touch the hot path.
 */
export class PreviewEngine {
  private renderer: MontageRenderer;
  private timeline: Timeline | null = null;
  private photos: PhotoSource[] = [];
  private settings: MontageSettings | null = null;
  private entries = new Map<number, Entry>();
  private time = 0;
  private playing = false;
  private loop = true;
  private raf = 0;
  private startNow = 0;
  private startTime = 0;
  private disposed = false;

  private hooks: PreviewHooks;

  constructor(canvas: HTMLCanvasElement, hooks: PreviewHooks) {
    this.hooks = hooks;
    this.renderer = createRenderer(canvas);
    this.renderer.onContextEvent((e) => {
      if (e !== 'restored') return;
      for (const [i, entry] of this.entries) if (entry.bmp) this.renderer.setPhoto(i, entry.bmp);
      this.renderCurrent();
    });
  }

  get currentTime(): number {
    return this.time;
  }
  get isPlaying(): boolean {
    return this.playing;
  }

  stats(): PreviewStats {
    let resident = 0;
    for (const e of this.entries.values()) if (e.bmp) resident++;
    return { renderer: this.renderer.stats(), residentBitmaps: resident, entries: this.entries.size };
  }

  update(timeline: Timeline | null, photos: PhotoSource[], settings: MontageSettings): void {
    if (this.disposed) return;
    this.timeline = timeline;
    this.photos = photos;
    this.settings = settings;
    const rs = this.renderer.stats();
    if (rs.width !== settings.width || rs.height !== settings.height) {
      this.renderer.setSize(settings.width, settings.height);
    }
    this.renderer.setBackground(settings.background);
    if (timeline && this.time > timeline.duration) this.time = timeline.duration;
    if (!timeline && this.playing) {
      this.pause();
      this.hooks.onEnded();
    }
    this.syncPhotos();
    this.renderCurrent();
    this.hooks.onTime(this.time);
  }

  seek(t: number): void {
    const dur = this.timeline?.duration ?? 0;
    this.time = Math.min(Math.max(0, t), dur);
    if (this.playing) {
      this.startNow = performance.now();
      this.startTime = this.time;
    }
    this.syncPhotos();
    this.renderCurrent();
    this.hooks.onTime(this.time);
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    this.syncPhotos();
  }

  play(): void {
    if (this.playing || !this.timeline) return;
    if (this.time >= this.timeline.duration) this.time = 0;
    this.playing = true;
    this.startNow = performance.now();
    this.startTime = this.time;
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    for (const i of [...this.entries.keys()]) this.evict(i);
    this.renderer.dispose();
  }

  private tick = (now: number): void => {
    if (!this.playing || !this.timeline) return;
    const dur = this.timeline.duration;
    let t = this.startTime + (now - this.startNow) / 1000;
    let ended = false;
    if (t >= dur) {
      if (this.loop && dur > 0) {
        t %= dur;
        this.startTime = t;
        this.startNow = now;
      } else {
        t = dur;
        ended = true;
      }
    }
    this.time = t;
    this.syncPhotos();
    this.renderCurrent();
    this.hooks.onTime(t);
    if (ended) {
      this.playing = false;
      this.hooks.onEnded();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private renderCurrent(): void {
    if (this.timeline) this.renderer.draw(frameAt(this.timeline, this.time));
  }

  /** Photos of the shots around the playhead, current shot first, with their decode bounds. */
  private wantedPhotos(): PhotoDecode[] {
    const timeline = this.timeline;
    const settings = this.settings;
    if (!timeline || !settings) return [];
    const cur = segmentIndexAt(timeline, this.time);
    // On a looping timeline the last shot's next is shot 0 (the wrap, §4.9).
    const segs = segmentWindow(timeline.segments.length, cur, BEHIND, AHEAD, timeline.loop);
    const naturals = this.photos.map((p) => ({ width: p.naturalWidth, height: p.naturalHeight }));
    return photosForSegments(timeline, segs, { width: settings.width, height: settings.height }, naturals);
  }

  private evict(i: number): void {
    const e = this.entries.get(i);
    if (!e) return;
    this.entries.delete(i);
    this.renderer.setPhoto(i, null);
    e.bmp?.close();
    e.bmp = null;
  }

  private syncPhotos(): void {
    if (!this.settings) return;
    const wanted = new Map<number, string>();
    const decodes = this.wantedPhotos();
    for (const d of decodes) wanted.set(d.photoIndex, `${d.maxW}x${d.maxH}`);
    for (const i of [...this.entries.keys()]) {
      const e = this.entries.get(i);
      const photo = this.photos[i];
      const retry = !!e && e.failedAt !== null && performance.now() - e.failedAt >= DECODE_RETRY_MS;
      if (!photo || !e || e.id !== photo.id || e.key !== wanted.get(i) || retry) this.evict(i);
    }
    for (const { photoIndex: i, maxW, maxH } of decodes) {
      const photo = this.photos[i];
      if (!photo || this.entries.has(i)) continue;
      const entry: Entry = { id: photo.id, key: `${maxW}x${maxH}`, bmp: null, failedAt: null };
      this.entries.set(i, entry);
      decodePhoto(photo.file, { maxW, maxH }).then(
        (bmp) => {
          if (this.disposed || this.entries.get(i) !== entry) {
            bmp.close(); // evicted while decoding
            return;
          }
          entry.bmp = bmp;
          this.renderer.setPhoto(i, bmp);
          this.renderCurrent();
        },
        (err: unknown) => {
          entry.failedAt = performance.now();
          console.warn('Preview decode failed', photo.name, err);
          // Retry even while paused (during playback the next tick would also pick it up).
          setTimeout(() => {
            if (this.disposed || this.entries.get(i) !== entry) return;
            this.syncPhotos();
            this.renderCurrent();
          }, DECODE_RETRY_MS + 50);
        },
      );
    }
  }
}
