import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants';
import {
  applySettingsPatch, arrayMove, dimsForRatio, estimateTiming, formatBytes, formatRatio, lockedDims,
  mergeOverride, parseRatio, shuffleItems, togglePool,
} from './logic';

describe('parseRatio', () => {
  it('parses common forms', () => {
    expect(parseRatio('7:5')).toEqual({ w: 7, h: 5 });
    expect(parseRatio(' 16 / 9 ')).toEqual({ w: 16, h: 9 });
    expect(parseRatio('1.5')).toEqual({ w: 1.5, h: 1 });
  });
  it('rejects junk', () => {
    for (const t of ['', 'abc', '0:5', '5:0', '7:', '-1:2']) expect(parseRatio(t)).toBeNull();
  });
});

describe('dimensions', () => {
  it('rounds to even and clamps', () => {
    const s = applySettingsPatch(DEFAULT_SETTINGS, { width: 1081 }, false);
    expect(s.width).toBe(1082);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { height: 99999 }, false).height).toBe(4096);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { width: 3 }, false).width).toBe(128);
  });
  it('keeps ratio when locked', () => {
    const s = applySettingsPatch(DEFAULT_SETTINGS, { width: 540 }, true);
    expect(s).toMatchObject({ width: 540, height: 960 });
    const t = applySettingsPatch(DEFAULT_SETTINGS, { height: 960 }, true);
    expect(t).toMatchObject({ width: 540, height: 960 });
  });
  it('back-solves when the locked side would leave the range', () => {
    const d = lockedDims('width', 4096, 9 / 16);
    expect(d.height).toBeLessThanOrEqual(4096);
    expect(d.width % 2).toBe(0);
    expect(d.height % 2).toBe(0);
  });
  it('applies a ratio keeping width', () => {
    expect(dimsForRatio(1050, 7, 5)).toEqual({ width: 1050, height: 750 });
    const d = dimsForRatio(1080, 7, 5);
    expect(d.height % 2).toBe(0);
  });
  it('formats ratios', () => {
    expect(formatRatio(1080, 1920)).toBe('9:16');
    expect(formatRatio(1234, 778)).toContain(':1');
  });
});

describe('settings validation', () => {
  it('clamps ranges and rejects bad values', () => {
    const s = applySettingsPatch(DEFAULT_SETTINGS, {
      totalDuration: 9999, transitionSpeed: 2, pacing: -1, background: 'red', fps: 50 as 24,
    }, false);
    expect(s.totalDuration).toBe(600);
    expect(s.transitionSpeed).toBe(1);
    expect(s.pacing).toBe(0);
    expect(s.background).toBe(DEFAULT_SETTINGS.background);
    expect(s.fps).toBe(DEFAULT_SETTINGS.fps);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { totalDuration: 0 }, false).totalDuration).toBe(2);
  });
  it('enforces >=1 in pools', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { motionPool: [] }, false).motionPool).toEqual(['kenBurns']);
    expect(togglePool(['a'], 'a')).toEqual(['a']);
    expect(togglePool(['a'], 'b')).toEqual(['a', 'b']);
    expect(togglePool(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('reorder / shuffle', () => {
  it('moves items', () => {
    expect(arrayMove([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(arrayMove([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(arrayMove([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
  });
  it('shuffles deterministically per seed as a permutation', () => {
    const a = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffleItems(a, 7)).toEqual(shuffleItems(a, 7));
    expect(shuffleItems(a, 7)).not.toEqual(a);
    expect([...shuffleItems(a, 7)].sort((x, y) => x - y)).toEqual(a);
  });
});

describe('overrides', () => {
  it('merges, clamps focus, deletes', () => {
    let o = mergeOverride(undefined, { motion: 'zoomIn', focus: { x: 2, y: -1 } });
    expect(o).toEqual({ motion: 'zoomIn', focus: { x: 1, y: 0 } });
    o = mergeOverride(o, { motion: undefined });
    expect(o).toEqual({ focus: { x: 1, y: 0 } });
    expect(mergeOverride(o, { focus: undefined })).toBeUndefined();
  });
});

describe('estimates', () => {
  it('timing', () => {
    const t = estimateTiming({ ...DEFAULT_SETTINGS, totalDuration: 30, transitionSpeed: 0 }, 10);
    expect(t.transition).toBeCloseTo(1.6);
    expect(t.avgPhoto).toBeCloseTo((30 + 9 * 1.6) / 10);
    expect(estimateTiming(DEFAULT_SETTINGS, 1000).ok).toBe(false);
  });
  it('bytes', () => {
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

import { skippedFilesMessage } from './logic';

describe('skippedFilesMessage', () => {
  it('formats singular, plural and overflow', () => {
    expect(skippedFilesMessage([])).toBe('');
    expect(skippedFilesMessage(['a.txt'])).toBe('Skipped 1 file that isn’t a supported image: a.txt');
    expect(skippedFilesMessage(['a', 'b'])).toBe('Skipped 2 files that aren’t supported images: a, b');
    expect(skippedFilesMessage(['a', 'b', 'c', 'd', 'e'])).toBe('Skipped 5 files that aren’t supported images: a, b, c and 2 more');
  });
});
