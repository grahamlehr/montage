import { describe, expect, it } from 'vitest';
import { CELL_MOTION_SCALE, DEFAULT_SETTINGS, LAYOUT_CAPACITY } from '../lib/constants';
import { deriveSeed, mulberry32 } from '../lib/rng';
import type {
  FrameDescriptor,
  MontageSettings,
  PhotoOverrides,
  Rect,
  Segment,
  Shot,
  Timeline,
} from '../types';
import golden from './golden-v1.json';
import {
  buildTimeline,
  cellPixelSize,
  frameAt,
  groupPhotos,
  isMismatched,
  layoutCells,
  motionTransforms,
  photosOf,
  timingSummary,
  type GroupablePhoto,
} from './index';

const P = { naturalWidth: 1200, naturalHeight: 1600 }; // portrait 0.75
const L = { naturalWidth: 1600, naturalHeight: 1200 }; // landscape 1.33
const Q = { naturalWidth: 1000, naturalHeight: 1000 }; // square
const set = (spec: string): GroupablePhoto[] =>
  [...spec].map((c, i) => ({ id: `p${i}`, ...(c === 'P' ? P : c === 'L' ? L : Q) }));
const S = (o: Partial<MontageSettings> = {}): MontageSettings => ({ ...DEFAULT_SETTINGS, loop: false, ...o });
const LAND = { width: 1920, height: 1080 };
const PORT = { width: 1080, height: 1920 };
const SQUARE = { width: 1080, height: 1080 };

function build(
  ph: GroupablePhoto[],
  o: Partial<MontageSettings> = {},
  ov: Record<string, PhotoOverrides> = {},
): Timeline {
  const r = buildTimeline(ph, ov, S(o));
  if (!r.ok) throw new Error(r.error);
  return r.timeline;
}
const shape = (ph: GroupablePhoto[], o: Partial<MontageSettings>, ov: Record<string, PhotoOverrides> = {}) =>
  groupPhotos(ph, ov, S(o)).map((g) => `${g.layout}:${g.photoIndices.join(',')}`);
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function checkTimeline(tl: Timeline, n: number, L: number, fps = 30) {
  // Invariant 2: every photo exactly once, in order.
  expect(tl.segments.flatMap((s) => photosOf(s))).toEqual(Array.from({ length: n }, (_, i) => i));
  // Invariant 6: contiguous, ends at L, frameCount.
  expect(tl.segments[0]!.start).toBe(0);
  expect(tl.segments[0]!.transitionIn).toBeNull();
  expect(tl.segments.at(-1)!.end).toBe(L);
  expect(tl.frameCount).toBe(Math.round(L * fps));
  for (let i = 1; i < tl.segments.length; i++) {
    const prev = tl.segments[i - 1]!;
    const cur = tl.segments[i]!;
    const tr = cur.transitionIn!;
    expect(cur.start).toBeCloseTo(prev.end - tr.duration, 9);
    expect(tr.start).toBeCloseTo(cur.start, 9);
  }
  for (const s of tl.segments) {
    // Invariant 4 + 3.
    expect(s.cells.length).toBeGreaterThanOrEqual(1);
    expect(s.cells.length).toBeLessThanOrEqual(4);
    if (s.cells.length > 1)
      expect(LAYOUT_CAPACITY[s.layout as keyof typeof LAYOUT_CAPACITY]).toBeGreaterThanOrEqual(
        s.cells.length,
      );
    for (const c of s.cells) inUnit(c.rect);
  }
}
function inUnit(r: Rect) {
  const e = 1e-9;
  expect(r.x).toBeGreaterThanOrEqual(-e);
  expect(r.y).toBeGreaterThanOrEqual(-e);
  expect(r.w).toBeGreaterThan(0);
  expect(r.h).toBeGreaterThan(0);
  expect(r.x + r.w).toBeLessThanOrEqual(1 + e);
  expect(r.y + r.h).toBeLessThanOrEqual(1 + e);
}
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 1e-12 && h > 1e-12 ? w * h : 0;
}

describe('invariant 1: grouping off reproduces v1 (golden)', () => {
  type GoldenCase = {
    n: number;
    s: Partial<MontageSettings>;
    ov: Record<string, PhotoOverrides>;
    timeline: unknown;
    frames: Array<{ t: number; frame: unknown }>;
  };
  type V1Seg = {
    photoIndex: number;
    start: number;
    end: number;
    motion: string;
    motionFrom: unknown;
    motionTo: unknown;
    fit: string;
    focus: unknown;
    transitionIn: unknown;
  };
  type V1Layer = { photoIndex: number; fit: string; focus: unknown; transform: unknown };
  type V1Frame =
    | { kind: 'single'; layer: V1Layer }
    | { kind: 'transition'; style: string; progress: number; from: V1Layer; to: V1Layer };
  const asV1 = (sh: Shot): V1Layer => {
    expect(sh.backdrop).toBeNull();
    expect(sh.cells).toHaveLength(1);
    const c = sh.cells[0]!;
    expect(c).toMatchObject({ rect: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0, border: 'none', reveal: 1 });
    return { photoIndex: c.photoIndex, fit: c.fit, focus: c.focus, transform: c.transform };
  };
  const frameV1 = (f: FrameDescriptor): V1Frame =>
    f.kind === 'single'
      ? { kind: 'single', layer: asV1(f.shot) }
      : { kind: 'transition', style: f.style, progress: f.progress, from: asV1(f.from), to: asV1(f.to) };

  // Mixed orientations so 'auto' would group — 'off' must not.
  const dims = [P, L, P, P, Q, L, L, P];
  for (const [k, c] of (golden as unknown as GoldenCase[]).entries()) {
    it(`case ${k} (n=${c.n})`, () => {
      const ph = Array.from({ length: c.n }, (_, i) => ({ id: `p${i}`, ...dims[i % dims.length]! }));
      const tl = build(ph, { ...c.s, grouping: 'off', reveal: 'stagger' }, c.ov);
      const segs = tl.segments.map((s: Segment): V1Seg => {
        expect(s.layout).toBe('single');
        expect(s.backdrop).toBeNull();
        expect(s.cells).toHaveLength(1);
        const cell = s.cells[0]!;
        expect(cell).toMatchObject({
          rect: { x: 0, y: 0, w: 1, h: 1 },
          rotation: 0,
          border: 'none',
          revealDuration: 0,
          revealStart: s.start,
        });
        return {
          photoIndex: cell.photoIndex,
          start: s.start,
          end: s.end,
          motion: cell.motion,
          motionFrom: cell.motionFrom,
          motionTo: cell.motionTo,
          fit: cell.fit,
          focus: cell.focus,
          transitionIn: s.transitionIn,
        };
      });
      expect(json({ ...tl, loop: undefined, segments: segs })).toEqual(c.timeline);
      for (const { t, frame } of c.frames) expect(json(frameV1(frameAt(tl, t)))).toEqual(frame);
    });
  }
});

describe('mismatch', () => {
  it('thresholds', () => {
    expect(isMismatched(P, 1920, 1080)).toBe(true);
    expect(isMismatched({ naturalWidth: 86, naturalHeight: 100 }, 1920, 1080)).toBe(false);
    expect(isMismatched({ naturalWidth: 85, naturalHeight: 100 }, 1920, 1080)).toBe(true);
    expect(isMismatched(L, 1080, 1920)).toBe(true);
    expect(isMismatched({ naturalWidth: 117, naturalHeight: 100 }, 1080, 1920)).toBe(false);
    expect(isMismatched(L, 1920, 1080)).toBe(false);
    expect(isMismatched(P, 1080, 1920)).toBe(false);
    expect(isMismatched(P, 1080, 1080)).toBe(false);
    expect(isMismatched(L, 1200, 1080)).toBe(false); // 1.11: square-ish output
  });
});

describe('grouping table (§4.7.1)', () => {
  const rows: Array<[string, { width: number; height: number }, string, string[]]> = [
    ['16:9 portraits pair', LAND, 'PPLPPPL', ['duo:0,1', 'single:2', 'duo:3,4', 'single:5', 'single:6']],
    ['16:9 landscapes stay single', LAND, 'LLLQ', ['single:0', 'single:1', 'single:2', 'single:3']],
    ['16:9 lone portrait', LAND, 'LPLP', ['single:0', 'single:1', 'single:2', 'single:3']],
    ['9:16 landscapes pair', PORT, 'LLPLLL', ['duo:0,1', 'single:2', 'duo:3,4', 'single:5']],
    ['9:16 portraits stay single', PORT, 'PPPP', ['single:0', 'single:1', 'single:2', 'single:3']],
    [
      '1:1 never pairs',
      SQUARE,
      'PPLLPP',
      ['single:0', 'single:1', 'single:2', 'single:3', 'single:4', 'single:5'],
    ],
  ];
  for (const [name, out, spec, want] of rows) {
    it(`auto: ${name}`, () => expect(shape(set(spec), { ...out, grouping: 'auto' })).toEqual(want));
  }
  it('off: always single, overrides ignored', () => {
    const ov = { p0: { group: 'joinNext' as const } };
    expect(shape(set('PPPP'), { ...LAND, grouping: 'off' }, ov)).toEqual([
      'single:0',
      'single:1',
      'single:2',
      'single:3',
    ]);
  });
  it('solo is never grouped; pairing needs the second photo free', () => {
    expect(shape(set('PPP'), { ...LAND, grouping: 'auto' }, { p0: { group: 'solo' } })).toEqual([
      'single:0',
      'duo:1,2',
    ]);
    expect(shape(set('PPP'), { ...LAND, grouping: 'auto' }, { p1: { group: 'solo' } })).toEqual([
      'single:0',
      'single:1',
      'single:2',
    ]);
  });
  it('joinNext chains map count → layout, capped at 4, stop before solo', () => {
    const g = { group: 'joinNext' as const };
    for (const grouping of ['auto', 'mixed'] as const) {
      expect(shape(set('LLLLLLL'), { ...LAND, grouping }, { p0: g })).toEqual(
        grouping === 'auto'
          ? ['duo:0,1', 'single:2', 'single:3', 'single:4', 'single:5', 'single:6']
          : expect.arrayContaining(['duo:0,1']),
      );
    }
    expect(shape(set('LLLLL'), { ...LAND, grouping: 'auto' }, { p0: g, p1: g })).toEqual([
      'trio:0,1,2',
      'single:3',
      'single:4',
    ]);
    expect(
      shape(set('LLLLLL'), { ...LAND, grouping: 'auto' }, { p0: g, p1: g, p2: g, p3: g, p4: g }),
    ).toEqual(['quad:0,1,2,3', 'duo:4,5']);
    expect(shape(set('LLL'), { ...LAND, grouping: 'auto' }, { p0: g, p1: { group: 'solo' } })).toEqual([
      'single:0',
      'single:1',
      'single:2',
    ]);
    expect(shape(set('LL'), { ...LAND, grouping: 'auto' }, { p1: g })).toEqual(['single:0', 'single:1']); // last photo: nothing to join
    // A photo whose successor starts a chain is not auto-paired into it.
    expect(shape(set('PPP'), { ...LAND, grouping: 'auto' }, { p1: g })).toEqual(['single:0', 'duo:1,2']);
  });

  describe('mixed', () => {
    const many = set('LLLLLLLLLLLLLLLLLLLLLLLLLLLLLL');
    it('is seeded, keeps first/last solo, uses only pool layouts, and groups some photos', () => {
      let grouped = 0;
      let seen = 0;
      for (let seed = 0; seed < 40; seed++) {
        const o = {
          ...LAND,
          grouping: 'mixed' as const,
          seed,
          layoutPool: ['duo', 'trio', 'pip'] as MontageSettings['layoutPool'],
          selection: 'random' as const,
        };
        const g = groupPhotos(many, {}, S(o));
        expect(groupPhotos(many, {}, S(o))).toEqual(g);
        expect(g[0]).toEqual({ layout: 'single', photoIndices: [0] });
        expect(g.at(-1)).toEqual({ layout: 'single', photoIndices: [29] });
        expect(g.flatMap((x) => x.photoIndices)).toEqual(many.map((_, i) => i));
        const multi = g.filter((x) => x.layout !== 'single');
        for (const x of multi) expect(['duo', 'trio', 'pip']).toContain(x.layout);
        // No repeat, except a forced fallback right before the closing photo.
        for (let k = 1; k < multi.length; k++) {
          if (multi[k]!.photoIndices.at(-1) !== 28) expect(multi[k]!.layout).not.toBe(multi[k - 1]!.layout);
        }
        grouped += multi.reduce((a, x) => a + x.photoIndices.length, 0);
        seen += 28;
      }
      expect(grouped / seen).toBeGreaterThan(0.25);
      expect(grouped / seen).toBeLessThan(0.85);
      const a = shape(many, { ...LAND, grouping: 'mixed', seed: 1 });
      const b = shape(many, { ...LAND, grouping: 'mixed', seed: 2 });
      expect(a).not.toEqual(b);
    });
    it('draws from deriveSeed(seed, "grouping", i) with p = 0.35', () => {
      const seed = 11;
      const g = groupPhotos(many, {}, S({ ...LAND, grouping: 'mixed', seed, layoutPool: ['duo'] }));
      let i = 0;
      for (const x of g) {
        const fire = i > 0 && i < 28 && mulberry32(deriveSeed(seed, 'grouping', i))() < 0.35;
        expect(x.layout).toBe(fire ? 'duo' : 'single');
        i += x.photoIndices.length;
      }
    });
    it('sequence cycles the pool', () => {
      const g = groupPhotos(
        many,
        {},
        S({ ...LAND, grouping: 'mixed', seed: 3, layoutPool: ['duo', 'quad'], selection: 'sequence' }),
      );
      const multi = g.filter((x) => x.layout !== 'single').map((x) => x.layout);
      expect(multi.length).toBeGreaterThan(2);
      multi.forEach((l, k) => expect(l).toBe(k % 2 === 0 ? 'duo' : 'quad'));
    });
    it('falls back to the largest pool layout that fits before a solo photo or the end', () => {
      // Every photo after 1 is solo except 2 → at most 2 photos available from position 1.
      const ov: Record<string, PhotoOverrides> = {};
      for (let i = 3; i < 30; i++) ov[`p${i}`] = { group: 'solo' };
      for (let seed = 0; seed < 200; seed++) {
        const g = groupPhotos(
          many,
          ov,
          S({ ...LAND, grouping: 'mixed', seed, layoutPool: ['quad', 'polaroid', 'trio'] }),
        );
        const x = g.find((y) => y.layout !== 'single');
        if (!x) continue;
        expect(x).toEqual({ layout: 'polaroid', photoIndices: [1, 2] });
        return;
      }
      throw new Error('no seed grouped position 1');
    });
    it('auto pairing still applies in mixed', () => {
      expect(shape(set('PPL'), { ...LAND, grouping: 'mixed' })[0]).toBe('duo:0,1');
    });
  });
});

describe('layout rects (§4.7.2)', () => {
  const tiled: Array<[string, number]> = [
    ['duo', 2],
    ['trio', 3],
    ['quad', 4],
  ];
  for (const out of [LAND, PORT, SQUARE]) {
    for (const [layout, k] of tiled) {
      it(`${layout} ${out.width}x${out.height}: no overlap; gutter 0 tiles exactly`, () => {
        for (const gutter of [0, 0.012, 0.04]) {
          const { cells, backdropCell } = layoutCells(
            layout as 'duo',
            k,
            out.width,
            out.height,
            gutter,
            1,
            0,
          );
          expect(cells).toHaveLength(k);
          expect(backdropCell).toBeNull();
          for (const c of cells) {
            inUnit(c.rect);
            expect(c.rotation).toBe(0);
            expect(c.border).toBe('none');
          }
          for (let a = 0; a < k; a++)
            for (let b = a + 1; b < k; b++) expect(overlapArea(cells[a]!.rect, cells[b]!.rect)).toBe(0);
          const area = cells.reduce((s, c) => s + c.rect.w * c.rect.h, 0);
          if (gutter === 0) expect(area).toBeCloseTo(1, 12);
          else expect(area).toBeLessThan(1);
        }
      });
    }
  }
  it('orientation follows the output; gutter is g = gutter·min(W,H) px between cells and at the edge', () => {
    const g = 0.02 * 1080;
    const land = layoutCells('duo', 2, 1920, 1080, 0.02, 1, 0).cells.map((c) => c.rect);
    expect(land[0]!.x * 1920).toBeCloseTo(g, 9);
    expect(land[0]!.y * 1080).toBeCloseTo(g, 9);
    expect((land[1]!.x - land[0]!.x - land[0]!.w) * 1920).toBeCloseTo(g, 9);
    expect((1 - land[1]!.x - land[1]!.w) * 1920).toBeCloseTo(g, 9);
    expect(land[0]!.y).toBe(land[1]!.y); // columns
    const port = layoutCells('duo', 2, 1080, 1920, 0.02, 1, 0).cells.map((c) => c.rect);
    expect(port[0]!.x).toBe(port[1]!.x); // rows
    expect((port[1]!.y - port[0]!.y - port[0]!.h) * 1920).toBeCloseTo(g, 9);
    const trio = layoutCells('trio', 3, 1920, 1080, 0, 1, 0).cells.map((c) => c.rect);
    expect(trio[0]).toEqual({ x: 0, y: 0, w: 0.58, h: 1 });
    const trioP = layoutCells('trio', 3, 1080, 1920, 0, 1, 0).cells.map((c) => c.rect);
    expect(trioP[0]).toEqual({ x: 0, y: 0, w: 1, h: 0.58 });
  });
  it('single is the full frame', () => {
    expect(layoutCells('single', 1, 1920, 1080, 0.04, 1, 0).cells).toEqual([
      { rect: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0, border: 'none' },
    ]);
  });
  it('pip: full-frame base plus a polaroid-bordered inset in a seeded corner', () => {
    const corners = new Set<string>();
    for (let key = 0; key < 40; key++) {
      for (const out of [LAND, PORT]) {
        const { cells } = layoutCells('pip', 2, out.width, out.height, 0.04, 9, key);
        expect(cells[0]).toEqual({ rect: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0, border: 'none' });
        const r = cells[1]!.rect;
        inUnit(r);
        expect(cells[1]!.border).toBe('polaroid');
        expect(Math.min(r.w * out.width, r.h * out.height)).toBeCloseTo(0.34 * 1080, 9);
        const m = 0.04 * 1080;
        expect(Math.min(r.x * out.width, (1 - r.x - r.w) * out.width)).toBeCloseTo(m, 9);
        expect(Math.min(r.y * out.height, (1 - r.y - r.h) * out.height)).toBeCloseTo(m, 9);
        corners.add(`${r.x < 0.5}${r.y < 0.5}`);
      }
    }
    expect(corners.size).toBe(4);
    expect(layoutCells('pip', 2, 1920, 1080, 0, 9, 3)).toEqual(layoutCells('pip', 2, 1920, 1080, 0, 9, 3));
  });
  it('polaroid: 2–3 square cards ≈58% of the short side, tilted within ±8°, backdrop = first', () => {
    for (const out of [LAND, PORT, SQUARE]) {
      for (const k of [2, 3]) {
        for (let key = 0; key < 20; key++) {
          const { cells, backdropCell } = layoutCells('polaroid', k, out.width, out.height, 0.04, 5, key);
          expect(cells).toHaveLength(k);
          expect(backdropCell).toBe(0);
          for (const c of cells) {
            inUnit(c.rect);
            expect(c.border).toBe('polaroid');
            expect(Math.abs(c.rotation)).toBeLessThanOrEqual((8 * Math.PI) / 180 + 1e-12);
            expect(c.rect.w * out.width).toBeCloseTo(0.58 * Math.min(out.width, out.height), 9);
            expect(c.rect.h * out.height).toBeCloseTo(0.58 * Math.min(out.width, out.height), 9);
          }
        }
      }
    }
  });
});

describe('multi-photo timelines', () => {
  const ph = set('PPLPPPPL');
  const base = { ...LAND, grouping: 'auto' as const, totalDuration: 20 };

  it('builds shots with cells, invariants 2–4 and 6 hold across settings', () => {
    for (const o of [
      base,
      { ...base, totalDuration: 40, reveal: 'stagger' as const, pacing: 1 },
      {
        ...base,
        grouping: 'mixed' as const,
        layoutPool: ['duo', 'trio', 'quad', 'pip', 'polaroid'] as MontageSettings['layoutPool'],
        selection: 'random' as const,
        fps: 25 as const,
      },
      {
        ...PORT,
        grouping: 'mixed' as const,
        totalDuration: 14,
        transitionSpeed: 0,
        reveal: 'stagger' as const,
      },
    ]) {
      for (let seed = 0; seed < 10; seed++) {
        const many = set('PPLPPLLLPPPPLPLPLLLP');
        const tl = build(many, { ...o, seed });
        checkTimeline(tl, many.length, o.totalDuration, 'fps' in o ? o.fps : 30);
        for (const s of tl.segments) {
          if (s.layout === 'duo' || s.layout === 'trio' || s.layout === 'quad') {
            for (let a = 0; a < s.cells.length; a++)
              for (let b = a + 1; b < s.cells.length; b++)
                expect(overlapArea(s.cells[a]!.rect, s.cells[b]!.rect)).toBe(0);
          }
        }
      }
    }
  });

  it('invariant 5: deterministic', () => {
    const o = {
      ...base,
      grouping: 'mixed' as const,
      reveal: 'stagger' as const,
      layoutPool: ['pip', 'polaroid', 'quad'] as MontageSettings['layoutPool'],
      seed: 77,
    };
    expect(json(build(set('PLPLPLPLPLPL'), o))).toEqual(json(build(set('PLPLPLPLPLPL'), o)));
  });

  it('shot weights: a duo gets 1.5× a single shot (pacing 0, cuts)', () => {
    const tl = build(set('LPPL'), { ...base, transitionPool: ['cut'] });
    const d = tl.segments.map((s) => s.end - s.start);
    expect(tl.segments.map((s) => s.layout)).toEqual(['single', 'duo', 'single']);
    expect(d[1]! / d[0]!).toBeCloseTo(1.5, 9);
    expect(d[2]!).toBeCloseTo(d[0]!, 9);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 9);
  });

  it('transition into a shot comes from its first photo; later photos are ignored', () => {
    const tl = build(
      set('LPPL'),
      { ...base, transitionPool: ['crossfade'] },
      {
        p1: { transitionIn: 'zoom' },
        p2: { transitionIn: 'wipe' },
        p3: { transitionIn: 'push' },
      },
    );
    expect(tl.segments.map((s) => s.transitionIn?.style ?? null)).toEqual([null, 'zoom', 'push']);
    const seq = build(set('LPPLL'), { ...base, transitionPool: ['crossfade', 'wipe', 'push'] });
    expect(seq.segments.map((s) => s.transitionIn?.style ?? null)).toEqual([
      null,
      'crossfade',
      'wipe',
      'push',
    ]);
  });

  it('cells: cover fit unless overridden; motion stream per photo, intensity × CELL_MOTION_SCALE', () => {
    const o = {
      ...base,
      fit: 'blur' as const,
      motionPool: ['kenBurns'] as MontageSettings['motionPool'],
      motionIntensity: 0.8,
      seed: 4,
    };
    const tl = build(set('LPPL'), o, { p2: { fit: 'contain', focus: { x: 0.1, y: 0.3 } } });
    const [s0, s1] = tl.segments;
    expect(s0!.cells[0]!.fit).toBe('blur');
    expect(s1!.cells.map((c) => c.fit)).toEqual(['cover', 'contain']);
    for (const c of s1!.cells) {
      const want = motionTransforms(
        'kenBurns',
        0.8 * CELL_MOTION_SCALE,
        c.focus,
        mulberry32(deriveSeed(4, 'kenBurns', c.photoIndex)),
      );
      expect(c.motionFrom).toEqual(want.from);
      expect(c.motionTo).toEqual(want.to);
    }
    const solo = motionTransforms(
      'kenBurns',
      0.8,
      s0!.cells[0]!.focus,
      mulberry32(deriveSeed(4, 'kenBurns', 0)),
    );
    expect(s0!.cells[0]!.motionFrom).toEqual(solo.from);
  });

  it('together: every cell present from the shot start', () => {
    const tl = build(ph, base);
    for (const s of tl.segments)
      for (const c of s.cells) expect(c).toMatchObject({ revealStart: s.start, revealDuration: 0 });
  });

  it('stagger: cell 0 from start; cells 1.. pop in after the transition, finishing by half the hold', () => {
    const g = { group: 'joinNext' as const };
    const tl = build(set('LLLLLL'), { ...base, reveal: 'stagger' }, { p1: g, p2: g, p3: g });
    const s = tl.segments[1]!;
    expect(s.layout).toBe('quad');
    const tInEnd = s.start + s.transitionIn!.duration;
    const hold = s.end - tl.segments[2]!.transitionIn!.duration - tInEnd;
    const step = Math.min(0.3, 0.12 * hold);
    expect(s.cells[0]).toMatchObject({ revealStart: s.start, revealDuration: 0 });
    s.cells.slice(1).forEach((c, k) => {
      expect(c.revealStart).toBeCloseTo(tInEnd + k * step, 12);
      expect(c.revealDuration).toBeCloseTo(Math.min(0.35, 1.2 * step), 12);
      expect(c.revealStart + c.revealDuration).toBeLessThanOrEqual(tInEnd + 0.5 * hold + 1e-9);
    });
    // frameAt reveal values
    const c2 = s.cells[2]!;
    const cellAt = (t: number) => {
      const f = frameAt(tl, t);
      return (f.kind === 'single' ? f.shot : f.to).cells[2]!;
    };
    expect(cellAt(c2.revealStart - 0.01).reveal).toBe(0);
    const mid = cellAt(c2.revealStart + c2.revealDuration / 2).reveal;
    expect(mid).toBeGreaterThan(0.5); // ease-out
    expect(mid).toBeLessThan(1);
    expect(cellAt(c2.revealStart + c2.revealDuration).reveal).toBe(1);
    expect(cellAt(s.start + 1e-6).reveal).toBe(0);
    const f = frameAt(tl, s.start + 1e-6);
    expect(f.kind === 'transition' && f.to.cells[0]!.reveal).toBe(1);
  });
});

describe('frameAt with shots', () => {
  it('returns shots with cell layers; polaroid backdrop follows the first cell', () => {
    const tl = build(set('LLLLLLLLLLLL'), {
      ...LAND,
      grouping: 'mixed',
      layoutPool: ['polaroid'],
      totalDuration: 20,
      seed: 1,
    });
    const idx = tl.segments.findIndex((x) => x.layout === 'polaroid' && x.cells.length === 3);
    expect(idx).toBeGreaterThan(0);
    const first = tl.segments[idx]!.cells[0]!.photoIndex;
    const s = tl.segments[idx]!;
    expect(s.backdrop).toBe(first);
    const t = (s.start + s.end) / 2;
    const f = frameAt(tl, t);
    expect(f.kind).toBe('single');
    if (f.kind !== 'single') return;
    expect(f.shot.cells.map((c) => c.photoIndex)).toEqual([first, first + 1, first + 2]);
    expect(f.shot.backdrop).toMatchObject({
      photoIndex: first,
      transform: f.shot.cells[0]!.transform,
      focus: f.shot.cells[0]!.focus,
    });
    for (const [k, c] of f.shot.cells.entries()) {
      expect(c.rect).toEqual(s.cells[k]!.rect);
      expect(c.rotation).toBe(s.cells[k]!.rotation);
      expect(c.border).toBe('polaroid');
      expect(c.reveal).toBe(1);
    }
    const tr = s.transitionIn!;
    const ft = frameAt(tl, tr.start + tr.duration / 2);
    expect(ft.kind).toBe('transition');
    if (ft.kind === 'transition') {
      expect(ft.from.cells.map((c) => c.photoIndex)).toEqual(photosOf(tl.segments[idx - 1]!));
      expect(ft.to.cells.map((c) => c.photoIndex)).toEqual([first, first + 1, first + 2]);
    }
  });
});

describe('helpers', () => {
  it('photosOf and cellPixelSize', () => {
    const tl = build(set('LPPL'), { ...LAND, grouping: 'auto', gutter: 0 });
    const duo = tl.segments[1]!;
    expect(photosOf(duo)).toEqual([1, 2]);
    expect(cellPixelSize(duo, 2, { width: 1920, height: 1080 })).toEqual({ width: 960, height: 1080 });
    expect(cellPixelSize(tl.segments[0]!, 0, { width: 1920, height: 1080 })).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(cellPixelSize(duo, 2, { width: 1, height: 1 })).toEqual({ width: 1, height: 1 });
  });
  it('timingSummary counts shots', () => {
    const o = S({ ...LAND, grouping: 'auto', totalDuration: 30 });
    const s = timingSummary(set('LPPLPP'), o);
    expect(s.shots).toBe(4);
    expect(s.ok).toBe(true);
    expect(s.minShot).toBeLessThan(s.avgShot);
    expect(timingSummary(set('LPPLPP'), S({ ...o, grouping: 'off' })).shots).toBe(6);
    expect(timingSummary(set('LLL'), o, { p0: { group: 'joinNext' }, p1: { group: 'joinNext' } }).shots).toBe(
      1,
    );
    expect(timingSummary([], o)).toMatchObject({ shots: 0, ok: false });
  });
  it('too-many check uses shots', () => {
    const forty = set('L'.repeat(40));
    expect(buildTimeline(forty, {}, S({ totalDuration: 10 })).ok).toBe(true);
    const r = buildTimeline(set('L'.repeat(41)), {}, S({ totalDuration: 10 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Too many photos/);
    // 44 portraits in 16:9 → 22 duos: fits.
    expect(
      buildTimeline(set('P'.repeat(44)), {}, S({ ...LAND, grouping: 'auto', totalDuration: 10 })).ok,
    ).toBe(true);
  });
});
