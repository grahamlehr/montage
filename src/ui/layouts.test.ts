import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, GUTTER_MAX } from '../lib/constants';
import type { MontageSettings, PhotoOverrides } from '../types';
import { groupPhotos, timingSummary } from './engineShim';
import { applySettingsPatch, shotMembership, shotSummaryText, togglePool } from './logic';

const S = (o: Partial<MontageSettings> = {}): MontageSettings => ({ ...DEFAULT_SETTINGS, width: 1920, height: 1080, ...o });
/** 'P' = portrait 3:4, 'L' = landscape 3:2, 'S' = square. */
const photos = (spec: string) =>
  [...spec].map((c, i) => ({
    id: `p${i}`,
    naturalWidth: c === 'P' ? 3000 : c === 'L' ? 3000 : 2000,
    naturalHeight: c === 'P' ? 4000 : c === 'L' ? 2000 : 2000,
  }));
const shape = (g: { layout: string; photoIndices: number[] }[]) => g.map((x) => `${x.layout}:${x.photoIndices.join(',')}`);

describe('layout settings patch', () => {
  it('validates grouping, layoutPool, gutter and reveal', () => {
    const s = applySettingsPatch(DEFAULT_SETTINGS, { grouping: 'mixed', gutter: 1, reveal: 'stagger', layoutPool: ['pip', 'duo'] }, false);
    expect(s).toMatchObject({ grouping: 'mixed', gutter: GUTTER_MAX, reveal: 'stagger', layoutPool: ['duo', 'pip'] });
    const bad = applySettingsPatch(s, { grouping: 'nope' as never, gutter: -1, reveal: 'x' as never, layoutPool: [] }, false);
    expect(bad).toMatchObject({ grouping: 'mixed', gutter: 0, reveal: 'stagger', layoutPool: ['duo', 'pip'] });
  });
  it('layout pool keeps at least one entry', () => {
    expect(togglePool(['duo'], 'duo')).toEqual(['duo']);
  });
});

describe('groupPhotos shim', () => {
  it("'off' is one photo per shot, overrides ignored", () => {
    const ov: Record<string, PhotoOverrides> = { p0: { group: 'joinNext' } };
    expect(shape(groupPhotos(photos('PPL'), ov, S()))).toEqual(['single:0', 'single:1', 'single:2']);
  });
  it('auto pairs consecutive mismatched photos', () => {
    expect(shape(groupPhotos(photos('PPPLPP'), {}, S({ grouping: 'auto' })))).toEqual(['duo:0,1', 'single:2', 'single:3', 'duo:4,5']);
    // portrait output: landscapes pair, portraits don't
    expect(shape(groupPhotos(photos('LLP'), {}, S({ grouping: 'auto', width: 1080, height: 1920 })))).toEqual(['duo:0,1', 'single:2']);
    // square output never mismatches
    expect(shape(groupPhotos(photos('PP'), {}, S({ grouping: 'auto', width: 1080, height: 1080 })))).toEqual(['single:0', 'single:1']);
  });
  it('solo blocks pairing, joinNext chains up to 4', () => {
    const g = S({ grouping: 'auto' });
    expect(shape(groupPhotos(photos('PPP'), { p1: { group: 'solo' } }, g))).toEqual(['single:0', 'single:1', 'single:2']);
    const chain: Record<string, PhotoOverrides> = { p0: { group: 'joinNext' }, p1: { group: 'joinNext' }, p2: { group: 'joinNext' }, p3: { group: 'joinNext' } };
    expect(shape(groupPhotos(photos('LLLLLL'), chain, g))).toEqual(['quad:0,1,2,3', 'single:4', 'single:5']);
    expect(shape(groupPhotos(photos('LLL'), { p0: { group: 'joinNext' }, p1: { group: 'joinNext' } }, g))).toEqual(['trio:0,1,2']);
    expect(shape(groupPhotos(photos('LLL'), { p0: { group: 'joinNext' }, p1: { group: 'solo' } }, g))).toEqual(['single:0', 'single:1', 'single:2']);
    // joinNext on the last photo is ignored
    expect(shape(groupPhotos(photos('LL'), { p1: { group: 'joinNext' } }, g))).toEqual(['single:0', 'single:1']);
  });
  it('covers every photo once, in order', () => {
    const g = groupPhotos(photos('PPLPPPSLPP'), { p2: { group: 'joinNext' } }, S({ grouping: 'mixed' }));
    expect(g.flatMap((x) => x.photoIndices)).toEqual([...Array(10).keys()]);
  });
});

describe('timing summary + membership', () => {
  it('counts shots', () => {
    const t = timingSummary(photos('PPPP'), S({ grouping: 'auto', totalDuration: 10 }));
    expect(t.shots).toBe(2);
    expect(t.ok).toBe(true);
    expect(shotSummaryText(t)).toMatch(/^2 shots · avg \d+\.\d s$/);
    expect(shotSummaryText({ shots: 1, avgShot: 2.44 })).toBe('1 shot · avg 2.4 s');
    expect(timingSummary([], S()).ok).toBe(false);
  });
  it('membership marks position, size and alternating tone', () => {
    const m = shotMembership(
      [{ layout: 'duo', photoIndices: [0, 1] }, { layout: 'single', photoIndices: [2] }, { layout: 'trio', photoIndices: [3, 4, 5] }],
      6,
    );
    expect(m.map((x) => `${x.shotIndex}${x.layout[0]}${x.position}/${x.size}t${x.tone}`)).toEqual([
      '0d0/2t0', '0d1/2t0', '1s0/1t0', '2t0/3t1', '2t1/3t1', '2t2/3t1',
    ]);
  });
});
