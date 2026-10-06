import { frameAt } from '../engine';
import { decodePhoto, decodeSizeFor } from '../ingest';
import { createRenderer } from '../render';
import type { MontageRenderer, RendererStats } from '../render';
import type { MontageSettings, PhotoSource, Timeline } from '../types';

/** How many photos behind / ahead of the current segment stay resident (§4.6). */
const BEHIND = 1;
const AHEAD = 2; // next photo + one extra lookahead

interface Entry {
  id: string;
  key: string;
  bmp: ImageBitmap | null;
  failed: boolean;
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
  onEnded(): void;
}

/**
 * Drives the preview canvas: owns the renderer, a small LRU-ish window of decoded photo bitmaps
 * (decoded at the output size, closed + setPhoto(i, null) on eviction) and the rAF playback clock.
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
    if (!timeline && this.playing) this.pause();
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

  private segmentIndexAt(t: number): number {
    const segs = this.timeline?.segments ?? [];
    let idx = 0;
    for (let i = segs.length - 1; i > 0; i--) {
      if ((segs[i]?.start ?? Infinity) <= t) {
        idx = i;
        break;
      }
    }
    return idx;
  }

  private wantedIndices(): number[] {
    const n = this.timeline?.segments.length ?? 0;
    if (n === 0) return [];
    const cur = this.segmentIndexAt(this.time);
    const out: number[] = [];
    const push = (i: number) => {
      let k = i;
      if (this.loop) k = ((i % n) + n) % n;
      if (k >= 0 && k < n && !out.includes(k)) out.push(k);
    };
    push(cur);
    push(cur - 1);
    for (let d = 1; d <= AHEAD; d++) push(cur + d);
    for (let d = 2; d <= BEHIND; d++) push(cur - d);
    return out;
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
    const settings = this.settings;
    if (!settings) return;
    const key = `${settings.width}x${settings.height}`;
    const wanted = this.wantedIndices();
    for (const i of [...this.entries.keys()]) {
      const e = this.entries.get(i);
      const photo = this.photos[i];
      if (!wanted.includes(i) || !photo || !e || e.id !== photo.id || e.key !== key) this.evict(i);
    }
    for (const i of wanted) {
      const photo = this.photos[i];
      if (!photo || this.entries.has(i)) continue;
      const entry: Entry = { id: photo.id, key, bmp: null, failed: false };
      this.entries.set(i, entry);
      const size = decodeSizeFor(
        { width: settings.width, height: settings.height },
        { width: photo.naturalWidth, height: photo.naturalHeight },
      );
      decodePhoto(photo.file, size).then(
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
          entry.failed = true;
          console.warn('Preview decode failed', photo.name, err);
        },
      );
    }
  }
}
