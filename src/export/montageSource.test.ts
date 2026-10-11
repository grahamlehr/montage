import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants';
import type { ExportRequest, FrameDescriptor, PhotoSource, Shot, Timeline } from '../types';
import { shotTimeline } from './shotFixtures';

interface FakeBitmap {
  index: number;
  closed: boolean;
  close(): void;
}

const created: FakeBitmap[] = [];
/** resident[i] = bitmap currently set on the fake renderer for photo i */
const resident = new Map<number, FakeBitmap>();
const drawn: Array<{ t: number; resident: number[]; photos: number[] }> = [];
/** decode bounds requested per photo index */
const decodeSizes = new Map<number, { maxW: number; maxH: number }>();
/** photos per shot for the next buildTimeline() call; default = one photo per shot (v1) */
let shotSizes: number[] | null = null;
/** true = use the real buildTimeline/frameAt (loop tests); false = hand-built shot timelines */
let realEngine = false;

vi.mock('../engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../engine')>();
  return {
    ...real,
    buildTimeline: (...args: Parameters<typeof real.buildTimeline>) => {
      if (realEngine) return real.buildTimeline(...args);
      const [photos, , settings] = args;
      return {
        ok: true,
        timeline: shotTimeline(shotSizes ?? photos.map(() => 1), settings.totalDuration, 0.5, settings.fps),
      };
    },
    frameAt: (tl: Timeline, t: number) => (realEngine ? real.frameAt(tl, t) : { time: t }),
  };
});

vi.mock('../ingest', () => ({
  decodeSizeFor: (out: { width: number; height: number }) => ({ maxW: out.width, maxH: out.height }),
  decodePhoto: async (file: File, size: { maxW: number; maxH: number }) => {
    decodeSizes.set(Number(file.name.replace(/\D/g, '')), size);
    await Promise.resolve();
    const bmp: FakeBitmap = {
      index: Number(file.name.replace(/\D/g, '')),
      closed: false,
      close() {
        this.closed = true;
      },
    };
    created.push(bmp);
    return bmp;
  },
}));

vi.mock('../render', () => ({
  createRenderer: () => ({
    setSize() {},
    setBackground() {},
    setPhoto(i: number, bmp: FakeBitmap | null) {
      if (bmp) resident.set(i, bmp);
      else resident.delete(i);
    },
    draw(frame: Partial<FrameDescriptor & { kind: 'single' }> & Partial<FrameDescriptor & { kind: 'transition' }>) {
      const ids = (shot?: Shot) => shot?.cells.map((c) => c.photoIndex) ?? [];
      const photos = frame.kind === 'single' ? ids(frame.shot) : [...ids(frame.from), ...ids(frame.to)];
      drawn.push({ t: -1, resident: [...resident.keys()].sort((a, b) => a - b), photos });
    },
    dispose() {},
  }),
}));

const { createMontageSource } = await import('./montageSource');

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function request(n: number, loop = false): ExportRequest {
  const photos: PhotoSource[] = Array.from({ length: n }, (_, i) => {
    const file = new File([''], `p${i}.jpg`);
    return { id: `p${i}`, file, name: file.name, naturalWidth: 400, naturalHeight: 300 };
  });
  return {
    files: photos.map((p) => p.file),
    photos,
    overrides: {},
    settings: { ...DEFAULT_SETTINGS, width: 320, height: 240, fps: 30, totalDuration: 10, loop },
  };
}

beforeEach(() => {
  created.length = 0;
  resident.clear();
  drawn.length = 0;
  decodeSizes.clear();
  shotSizes = null;
  realEngine = false;
});

describe('createMontageSource residency and rewind', () => {
  it('keeps only previous/current/next resident and closes everything on dispose', async () => {
    const src = createMontageSource();
    await src.init({} as OffscreenCanvas, request(6), () => undefined);
    for (let i = 0; i < 100; i++) {
      await src.draw(i, i / 10);
      expect(resident.size).toBeLessThanOrEqual(3);
    }
    src.dispose();
    await flush();
    expect(resident.size).toBe(0);
    expect(created.length).toBeGreaterThanOrEqual(6);
    expect(created.every((b) => b.closed)).toBe(true);
  });

  it('rewinds to frame 0 after a full pass (encoder retry): photos 0 and 1 are resident again, none leaked', async () => {
    const src = createMontageSource();
    await src.init({} as OffscreenCanvas, request(6), () => undefined);
    for (let i = 0; i < 100; i++) await src.draw(i, i / 10);
    const lastResident = [...resident.keys()];
    expect(Math.max(...lastResident)).toBe(5);
    expect(resident.has(0)).toBe(false);

    await src.draw(0, 0);
    // at t=0 photo 0 must be on the renderer with a live (not closed) bitmap
    expect(resident.get(0)?.closed).toBe(false);
    expect(resident.get(0)?.index).toBe(0);
    expect(drawn.at(-1)?.resident).toContain(0);

    // second pass: every drawn frame has its current photo resident and live, in order
    for (let i = 1; i < 100; i++) {
      await src.draw(i, i / 10);
      for (const b of resident.values()) expect(b.closed).toBe(false);
    }
    expect(Math.max(...resident.keys())).toBe(5);
    // bitmap handed to the renderer for photo i is always the decode of file i
    for (const [i, b] of resident) expect(b.index).toBe(i);

    src.dispose();
    await flush();
    expect(created.every((b) => b.closed)).toBe(true);
  });

  it('a rewind in the middle of the montage re-decodes the needed window', async () => {
    const src = createMontageSource();
    await src.init({} as OffscreenCanvas, request(6), () => undefined);
    for (let i = 0; i < 70; i++) await src.draw(i, i / 10);
    await src.draw(0, 0);
    expect([...resident.keys()].every((i) => i <= 1)).toBe(true);
    expect(resident.has(0)).toBe(true);
    src.dispose();
    await flush();
    expect(created.every((b) => b.closed)).toBe(true);
  });

  it('multi-photo shots: whole shots resident, decoded at cell size, released after passing', async () => {
    shotSizes = [1, 4, 2, 1]; // photos 0 | 1 2 3 4 | 5 6 | 7 — slots of 2.5 s
    const src = createMontageSource();
    const progress: Array<[number, number]> = [];
    await src.init({} as OffscreenCanvas, request(8), (d, t) => progress.push([d, t]));
    // initial decode = photos of shots 0 and 1
    expect(progress.at(-1)).toEqual([5, 5]);
    expect([...resident.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(decodeSizes.get(0)).toEqual({ maxW: 320, maxH: 240 });
    expect(decodeSizes.get(1)).toEqual({ maxW: 160, maxH: 120 });

    await src.draw(30, 3); // inside the quad: shots 0..2 resident
    expect([...resident.keys()].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(decodeSizes.get(5)).toEqual({ maxW: 160, maxH: 240 });

    await src.draw(80, 8); // last shot: shots 2..3 resident, quad released
    expect([...resident.keys()].sort()).toEqual([5, 6, 7]);
    const quadBitmaps = created.filter((b) => b.index >= 1 && b.index <= 4);
    expect(quadBitmaps.every((b) => b.closed)).toBe(true);

    src.dispose();
    await flush();
    expect(created.every((b) => b.closed)).toBe(true);
  });
});

describe('createMontageSource with a seamless loop (§4.9)', () => {
  it('every drawn frame has its photos resident and live, including the wrap back to photo 0', async () => {
    realEngine = true;
    for (const n of [1, 2, 3, 6]) {
      created.length = 0;
      resident.clear();
      drawn.length = 0;
      const src = createMontageSource();
      await src.init({} as OffscreenCanvas, request(n, true), () => undefined);
      const frames = 300; // 10 s @ 30 fps
      for (let i = 0; i < frames; i++) {
        await src.draw(i, i / 30);
        expect(resident.size).toBeLessThanOrEqual(3);
        const d = drawn.at(-1)!;
        for (const p of d.photos) {
          expect(d.resident).toContain(p);
          expect(resident.get(p)?.closed).toBe(false);
        }
      }
      // the final frames are a transition from the last photo into photo 0
      const tail = drawn.at(-1)!;
      expect(tail.photos).toEqual([n - 1, 0]);
      // the start of the video is a plain single frame of photo 0 and does not need the last photo
      expect(drawn[0]!.photos).toEqual([0]);
      // rewind (encoder retry) restarts cleanly
      await src.draw(0, 0);
      expect(resident.get(0)?.closed).toBe(false);
      src.dispose();
      await flush();
      expect(created.every((b) => b.closed)).toBe(true);
    }
  });
});
