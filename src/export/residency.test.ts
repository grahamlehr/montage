import { describe, expect, it } from 'vitest';
import { decodeSizeFor } from '../ingest';
import { photosForSegments, segmentIndexAt, segmentWindow } from './residency';
import { shotTimeline } from './shotFixtures';
import type { Timeline } from '../types';

const OUT = { width: 1920, height: 1080 };
const naturals = (n: number) => Array.from({ length: n }, () => ({ width: 4000, height: 3000 }));

/** Export window at time t: photos of prev / current / next shot. */
function exportResident(tl: Timeline, t: number, n: number): number[] {
  const cur = segmentIndexAt(tl, t);
  return photosForSegments(tl, [cur - 1, cur, cur + 1], OUT, naturals(n))
    .map((d) => d.photoIndex)
    .sort((a, b) => a - b);
}

/** Every segment visible at t (in a transition both are). */
function visibleSegments(tl: Timeline, t: number): number[] {
  return tl.segments.flatMap((s, i) => (s.start <= t && t < s.end ? [i] : []));
}

function frameTimes(tl: Timeline): number[] {
  return Array.from({ length: tl.frameCount }, (_, i) => i / tl.fps);
}

describe('segmentIndexAt / segmentWindow', () => {
  it('finds the latest segment started by t', () => {
    const tl = shotTimeline([1, 1, 1, 1]); // starts 0, 2.25, 4.75, 7.25
    expect(segmentIndexAt(tl, 0)).toBe(0);
    expect(segmentIndexAt(tl, 2.24)).toBe(0);
    expect(segmentIndexAt(tl, 2.25)).toBe(1);
    expect(segmentIndexAt(tl, 9.99)).toBe(3);
    expect(segmentIndexAt(tl, -1)).toBe(0);
  });

  it('builds clamped or wrapping windows', () => {
    expect(segmentWindow(5, 0, 1, 2)).toEqual([0, 1, 2]);
    expect(segmentWindow(5, 4, 1, 2)).toEqual([4, 3]);
    expect(segmentWindow(5, 4, 1, 2, true)).toEqual([4, 3, 0, 1]);
    expect(segmentWindow(2, 0, 1, 2, true)).toEqual([0, 1]);
    expect(segmentWindow(0, 0, 1, 2, true)).toEqual([]);
  });
});

describe('photosForSegments', () => {
  it('single-cell shots reproduce v1 residency (photo i == segment i, output-size decode)', () => {
    const n = 6;
    const tl = shotTimeline(Array.from({ length: n }, () => 1));
    for (const t of frameTimes(tl)) {
      const cur = segmentIndexAt(tl, t);
      const v1 = [cur - 1, cur, cur + 1].filter((i) => i >= 0 && i < n);
      expect(exportResident(tl, t, n)).toEqual(v1);
    }
    const [d] = photosForSegments(tl, [2], OUT, naturals(n));
    const full = decodeSizeFor(OUT, { width: 4000, height: 3000 });
    expect(d).toEqual({ photoIndex: 2, ...full });
  });

  it('keeps all four cells of a quad shot resident while it is visible, decoded at cell size', () => {
    const tl = shotTimeline([1, 4, 1, 1]); // photos 0 | 1 2 3 4 | 5 | 6
    const quad = tl.segments[1];
    if (!quad) throw new Error('fixture');
    for (const t of frameTimes(tl)) {
      if (t < quad.start || t >= quad.end) continue;
      const r = exportResident(tl, t, 7);
      for (const p of [1, 2, 3, 4]) expect(r).toContain(p);
    }
    const decodes = photosForSegments(tl, [1], OUT, naturals(7));
    expect(decodes.map((d) => d.photoIndex)).toEqual([1, 2, 3, 4]);
    const half = decodeSizeFor({ width: 960, height: 540 }, { width: 4000, height: 3000 });
    for (const d of decodes) expect({ maxW: d.maxW, maxH: d.maxH }).toEqual(half);
    const full = decodeSizeFor(OUT, { width: 4000, height: 3000 });
    expect(half.maxW).toBeLessThan(full.maxW);
  });

  it('keeps both shots’ photos during a transition between shots', () => {
    const tl = shotTimeline([2, 4, 3, 1, 2]);
    for (const t of frameTimes(tl)) {
      const r = exportResident(tl, t, 12);
      for (const si of visibleSegments(tl, t)) {
        const seg = tl.segments[si];
        for (const c of seg?.cells ?? []) expect(r).toContain(c.photoIndex);
      }
    }
  });

  it('includes a backdrop that is not one of the cells, decoded at full output size', () => {
    const tl = shotTimeline([2, 1]);
    const seg = tl.segments[0];
    if (!seg) throw new Error('fixture');
    seg.backdrop = 2;
    const d = photosForSegments(tl, [0], OUT, naturals(3));
    expect(d.map((x) => x.photoIndex)).toEqual([0, 1, 2]);
    expect(d[2]).toEqual({ photoIndex: 2, ...decodeSizeFor(OUT, { width: 4000, height: 3000 }) });
  });

  it('never needs a released photo again in forward order', () => {
    for (const sizes of [[1, 1, 1, 1, 1], [2, 4, 3, 1, 2, 1, 4], [4, 4, 4], [3]]) {
      const n = sizes.reduce((a, b) => a + b, 0);
      const tl = shotTimeline(sizes);
      const released = new Set<number>();
      let prev: number[] = [];
      for (const t of frameTimes(tl)) {
        const r = exportResident(tl, t, n);
        for (const p of r) expect(released.has(p)).toBe(false);
        for (const p of prev) if (!r.includes(p)) released.add(p);
        prev = r;
      }
      // three shots of at most four photos
      expect(Math.max(...frameTimes(tl).map((t) => exportResident(tl, t, n).length))).toBeLessThanOrEqual(12);
    }
  });
});
