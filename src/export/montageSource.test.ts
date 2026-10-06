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
const drawn: Array<{ t: number; resident: number[] }> = [];

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
    draw(frame: { time?: number }) {
      drawn.push({ t: frame.time ?? -1, resident: [...resident.keys()].sort((a, b) => a - b) });
    },
    dispose() {},
  }),
}));

const { createMontageSource } = await import('./montageSource');

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function request(n: number): ExportRequest {
  const photos: PhotoSource[] = Array.from({ length: n }, (_, i) => {
    const file = new File([''], `p${i}.jpg`);
    return { id: `p${i}`, file, name: file.name, naturalWidth: 400, naturalHeight: 300 };
  });
  return {
    files: photos.map((p) => p.file),
    photos,
    overrides: {},
    settings: { ...DEFAULT_SETTINGS, width: 320, height: 240, fps: 30, totalDuration: 10 },
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
