import { describe, expect, it } from 'vitest';
import { decodeSizeFor, fitWithin } from './size';

describe('decodeSizeFor', () => {
  it('downscales big photos to output x 1.3 (portrait output)', () => {
    const r = decodeSizeFor({ width: 1080, height: 1920 }, { width: 4000, height: 3000 });
    // cover scale: max(1404/4000, 2496/3000) = 0.832
    expect(r.maxH).toBe(2496);
    expect(r.maxW).toBe(Math.ceil(4000 * (2496 / 3000)));
  });
  it('never upscales', () => {
    expect(decodeSizeFor({ width: 1920, height: 1080 }, { width: 64, height: 48 })).toEqual({ maxW: 64, maxH: 48 });
  });
  it('keeps panorama resolution so it still covers a portrait output', () => {
    const r = decodeSizeFor({ width: 1080, height: 1920 }, { width: 6000, height: 1200 });
    expect(r.maxH).toBe(1200);
    expect(r.maxW).toBe(6000);
  });
  it('caps by output long edge x 1.35', () => {
    const r = decodeSizeFor({ width: 4096, height: 128 }, { width: 8000, height: 8000 });
    // th = min(166.4, 5529.6) ; tw = min(5324.8, 5529.6) -> cover scale 5324.8/8000
    expect(r.maxW).toBeLessThanOrEqual(5530);
  });
  it('caps long edge at 8192', () => {
    const r = decodeSizeFor({ width: 4096, height: 4096 }, { width: 20000, height: 10000 });
    expect(Math.max(r.maxW, r.maxH)).toBeLessThanOrEqual(8192);
  });
});

describe('fitWithin', () => {
  it('fits preserving aspect and never upscales', () => {
    expect(fitWithin({ width: 4000, height: 2000 }, 1000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitWithin({ width: 100, height: 50 }, 1000, 1000)).toEqual({ width: 100, height: 50 });
  });
});
