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
