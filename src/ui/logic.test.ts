import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, fitsEncoderArea } from '../lib/constants';
import {
  DIMENSION_PRESETS, applySettingsPatch, applySettingsPatchDetailed, areaNoteText, atCapNote, arrayMove, dimsForRatio, estimateTiming, formatBytes, formatRatio, lockedDims,
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

describe('encoder area cap', () => {
  const sq = { ...DEFAULT_SETTINGS, width: 4096, height: 4096 };
  it('clamps the other side when editing one (unlocked)', () => {
    const w = applySettingsPatch({ ...DEFAULT_SETTINGS, width: 1080, height: 4096 }, { width: 4096 }, false);
    expect(w).toMatchObject({ width: 4096, height: 2304 });
    const h = applySettingsPatch({ ...DEFAULT_SETTINGS, width: 4096, height: 1080 }, { height: 4096 }, false);
    expect(h).toMatchObject({ width: 2304, height: 4096 });
    expect(applySettingsPatch(DEFAULT_SETTINGS, { width: 4096, height: 4096 }, false)).toMatchObject({ width: 4096, height: 2304 });
    expect(sq.width).toBe(4096);
  });
  it('reports which side was limited', () => {
    const r = applySettingsPatchDetailed({ ...DEFAULT_SETTINGS, width: 1080, height: 4096 }, { width: 4096 }, false);
    expect(r.areaClamp).toBe('height');
    expect(areaNoteText(r.areaClamp, r.settings.width, r.settings.height)).toContain('height limited to 2304');
    expect(applySettingsPatchDetailed(DEFAULT_SETTINGS, { width: 540 }, false).areaClamp).toBe('none');
  });
  it('scales both sides when aspect-locked', () => {
    const prev = { ...DEFAULT_SETTINGS, width: 1080, height: 1080 };
    expect(applySettingsPatch(prev, { width: 4096 }, true)).toMatchObject({ width: 3072, height: 3072 });
    expect(applySettingsPatch(prev, { height: 4096 }, true)).toMatchObject({ width: 3072, height: 3072 });
  });
  it('ratio 16:9 at width 4096 gives 4096x2304; ratios never exceed the cap', () => {
    expect(dimsForRatio(4096, 16, 9)).toEqual({ width: 4096, height: 2304 });
    for (const [rw, rh] of [[1, 1], [4, 3], [3, 4], [21, 9], [2, 3], [9, 16]] as const) {
      for (const w of [2048, 3000, 4096]) {
        const d = dimsForRatio(w, rw, rh);
        expect(fitsEncoderArea(d.width, d.height)).toBe(true);
        expect(d.width % 2 + d.height % 2).toBe(0);
      }
    }
  });
  it('presets are unchanged and every patch result fits', () => {
    for (const p of DIMENSION_PRESETS) {
      expect(applySettingsPatch(DEFAULT_SETTINGS, { width: p.width, height: p.height }, false)).toMatchObject({
        width: p.width, height: p.height,
      });
    }
    for (const lock of [false, true]) {
      for (const v of [128, 1000, 2304, 3000, 4096, 99999]) {
        for (const key of ['width', 'height'] as const) {
          const r = applySettingsPatch({ ...DEFAULT_SETTINGS, width: 4096, height: 4096 - 2000 }, { [key]: v }, lock);
          expect(fitsEncoderArea(r.width, r.height)).toBe(true);
        }
      }
    }
  });
  it('notes when exactly at the cap', () => {
    expect(atCapNote(4096, 2304)).toContain('limit');
    expect(atCapNote(1080, 1920)).toBeNull();
  });
});

describe('locked ratio does not drift', () => {
  it('repro: 16:9 lock, 4096 -> 2000 -> 4096 returns to 4096x2304', () => {
    const ratio = 16 / 9;
    let s = { ...DEFAULT_SETTINGS, width: 1920, height: 1080 };
    const seq = [4096, 2000, 4096].map((w) => (s = applySettingsPatch(s, { width: w }, true, ratio)));
    expect(seq[0]).toMatchObject({ width: 4096, height: 2304 });
    expect(seq[1]).toMatchObject({ width: 2000, height: 1126 });
    expect(seq[2]).toMatchObject({ width: 4096, height: 2304 });
  });
  it('long edit sequences stay within one even step of the exact ratio and fit the cap', () => {
    for (const [rw, rh] of [[16, 9], [7, 5], [21, 9], [1, 1]] as const) {
      const ratio = rw / rh;
      let s = { ...DEFAULT_SETTINGS, ...dimsForRatio(1080, rw, rh) };
      const edits = [4096, 2000, 4096, 1000, 3333, 4096, 128, 4096, 2500, 777, 4096];
      edits.forEach((v, i) => {
        s = applySettingsPatch(s, i % 3 === 2 ? { height: v } : { width: v }, true, ratio);
        expect(fitsEncoderArea(s.width, s.height)).toBe(true);
        // the derived side is within one even step (2 px) of the exact partner, unless pinned by range/cap
        const edited = i % 3 === 2 ? 'height' : 'width';
        const exact = edited === 'width' ? s.width / ratio : s.height * ratio;
        const got = edited === 'width' ? s.height : s.width;
        const capped = !fitsEncoderArea(edited === 'width' ? s.width : Math.round(exact), edited === 'width' ? Math.round(exact) : s.height);
        if (exact >= 128 && exact <= 4096 && !capped) expect(Math.abs(got - exact)).toBeLessThanOrEqual(2);
      });
    }
  });
  it('1:1 at 4096 still gives 3072x3072', () => {
    expect(applySettingsPatch({ ...DEFAULT_SETTINGS, width: 1080, height: 1080 }, { width: 4096 }, true, 1)).toMatchObject({
      width: 3072, height: 3072,
    });
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
