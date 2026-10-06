import { describe, expect, it } from 'vitest';
import { clampEvenDim, estimateBitrate } from './constants';

describe('constants', () => {
  it('clampEvenDim rounds to even within range', () => {
    expect(clampEvenDim(1081)).toBe(1082);
    expect(clampEvenDim(1080.4)).toBe(1080);
    expect(clampEvenDim(5)).toBe(128);
    expect(clampEvenDim(5000)).toBe(4096);
    expect(clampEvenDim(777)).toBe(778);
  });
  it('estimateBitrate follows w·h·fps·bpp', () => {
    expect(estimateBitrate({ width: 1080, height: 1920, fps: 30, quality: 'standard' })).toBe(4976640);
  });
});

describe('encoder area cap', () => {
  it('matches Chrome H.264 limits', async () => {
    const { fitsEncoderArea, maxEvenHeightFor } = await import('./constants');
    expect(fitsEncoderArea(4096, 2304)).toBe(true);
    expect(fitsEncoderArea(3072, 3072)).toBe(true);
    expect(fitsEncoderArea(3072, 3088)).toBe(false);
    expect(fitsEncoderArea(4096, 2560)).toBe(false);
    expect(fitsEncoderArea(128, 4096)).toBe(true);
    expect(maxEvenHeightFor(4096)).toBe(2304);
    expect(maxEvenHeightFor(3072)).toBe(3072);
    expect(maxEvenHeightFor(1234)).toBe(4096);
    expect(maxEvenHeightFor(4096, 1080)).toBe(1080);
    for (const w of [128, 1000, 1234, 2049, 3000, 4096])
      expect(fitsEncoderArea(w, maxEvenHeightFor(w))).toBe(true);
  });
});
