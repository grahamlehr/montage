import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants';
import type { ExportRequest, PhotoSource } from '../types';

interface FakeBitmap {
  index: number;
  closed: boolean;
  close(): void;
}

const created: FakeBitmap[] = [];
/** resident[i] = bitmap currently set on the fake renderer for photo i */
const resident = new Map<number, FakeBitmap>();
const drawn: Array<{ t: number; resident: number[]; photos: number[] }> = [];

vi.mock('../ingest', () => ({
  decodeSizeFor: () => ({ width: 8, height: 8 }),
  decodePhoto: async (file: File) => {
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
    draw(frame: { kind: string; layer?: { photoIndex: number }; from?: { photoIndex: number }; to?: { photoIndex: number } }) {
      const photos = frame.kind === 'single' ? [frame.layer!.photoIndex] : [frame.from!.photoIndex, frame.to!.photoIndex];
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
});

describe('createMontageSource with a seamless loop (§4.9)', () => {
  it('every drawn frame has its photos resident and live, including the wrap back to photo 0', async () => {
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
