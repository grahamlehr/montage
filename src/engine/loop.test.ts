import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants';
import type { FrameDescriptor, Layer, MontageSettings, PhotoOverrides, Segment, Shot, Timeline, TransitionStyle } from '../types';
import { buildTimeline, frameAt, resolveStyles, timingSummary } from './index';
import { GOLDEN_CONFIGS } from './golden-configs';
import golden from './golden-noloop.json';

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, naturalWidth: 1600, naturalHeight: 1200 }));
/** Photo 0's layer in a shot (single-cell shots unless the test groups photos). */
const cell0 = (shot: Shot): Layer => shot.cells[0]!;

/** v1 shapes, for comparing grouping-off output against the pre-#25 golden (captured before contract v2). */
const v1Layer = (l: Layer) => ({ photoIndex: l.photoIndex, fit: l.fit, focus: l.focus, transform: l.transform });
function v1Frame(f: FrameDescriptor): unknown {
  return f.kind === 'single'
    ? { kind: 'single', layer: v1Layer(cell0(f.shot)) }
    : { kind: 'transition', style: f.style, progress: f.progress, from: v1Layer(cell0(f.from)), to: v1Layer(cell0(f.to)) };
}
function v1Timeline(tl: Timeline): unknown {
  const seg = (s: Segment) => {
    const c = s.cells[0]!;
    return { photoIndex: c.photoIndex, start: s.start, end: s.end, motion: c.motion, motionFrom: c.motionFrom, motionTo: c.motionTo, fit: c.fit, focus: c.focus, transitionIn: s.transitionIn };
  };
  return { duration: tl.duration, fps: tl.fps, frameCount: tl.frameCount, segments: tl.segments.map(seg) };
}
const S = (o: Partial<MontageSettings> = {}): MontageSettings => ({ ...DEFAULT_SETTINGS, grouping: 'off', loop: true, ...o });
function build(n: number, o: Partial<MontageSettings> = {}, ov: Record<string, PhotoOverrides> = {}): Timeline {
  const r = buildTimeline(photos(n), ov, S(o));
  if (!r.ok) throw new Error(r.error);
  return r.timeline;
}
const wrapOf = (tl: Timeline) => tl.segments[0]!.transitionIn!;
const ALL: TransitionStyle[] = ['cut', 'crossfade', 'dipToBlack', 'slideLeft', 'slideRight', 'slideUp', 'slideDown', 'push', 'wipe', 'zoom', 'blur'];

describe('loop=false is unchanged (golden captured before #25)', () => {
  GOLDEN_CONFIGS.forEach((c, k) => {
    it(`config ${k}`, () => {
      const r = buildTimeline(photos(c.n), c.ov ?? {}, { ...DEFAULT_SETTINGS, grouping: 'off', loop: false, ...c.s });
      const g = golden[k] as unknown as { timeline: Record<string, unknown>; frames: unknown[] };
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const tl = r.timeline;
      expect(tl.loop).toBe(false);
      expect(tl.segments.every((sg) => sg.cells.length === 1)).toBe(true);
      expect(JSON.parse(JSON.stringify(v1Timeline(tl)))).toEqual(g.timeline);
      const frames: FrameDescriptor[] = [];
      for (let i = 0; i <= 40; i++) frames.push(frameAt(tl, (tl.duration * i) / 40));
      expect(JSON.parse(JSON.stringify(frames.map(v1Frame)))).toEqual(g.frames);
    });
  });
});

describe('loop timeline invariants (§4.1, §4.9)', () => {
  for (const [n, o] of [
    [1, {}],
    [2, {}],
    [3, { pacing: 0.5 }],
    [7, { pacing: 1 }],
    [50, { totalDuration: 60, pacing: 0.6, transitionSpeed: 0 }],
    [20, { totalDuration: 10, transitionSpeed: 0 }],
  ] as Array<[number, Partial<MontageSettings>]>) {
    it(`n=${n}`, () => {
      const tl = build(n, o);
      const L = o.totalDuration ?? 30;
      const segs = tl.segments;
      const w = wrapOf(tl);
      expect(tl.loop).toBe(true);
      expect(tl.duration).toBe(L);
      expect(tl.frameCount).toBe(Math.round(L * 30));
      expect(segs).toHaveLength(n);
      expect(segs[n - 1]!.end).toBe(L);
      expect(segs[0]!.start).toBeCloseTo(-w.duration, 9);
      expect(w.start).toBeCloseTo(L - w.duration, 9);
      expect(w.duration).toBeGreaterThan(0);
      let sumD = 0;
      let sumT = w.duration;
      for (let i = 0; i < n; i++) {
        const s = segs[i]!;
        sumD += s.end - s.start;
        expect(s.end - s.start).toBeGreaterThanOrEqual(0.25 - 1e-9);
        if (i > 0) {
          const tr = s.transitionIn!;
          sumT += tr.duration;
          expect(s.start).toBeCloseTo(segs[i - 1]!.end - tr.duration, 9);
          expect(tr.start).toBeCloseTo(s.start, 9);
        }
      }
      expect(sumD - sumT).toBeCloseTo(L, 7); // L = ΣD − ΣT with all N transitions
      // clamp covers every pair including (last, first)
      for (let i = 0; i < n; i++) {
        const tr = i === 0 ? w : segs[i]!.transitionIn!;
        const a = segs[(i + n - 1) % n]!;
        const b = segs[i]!;
        expect(tr.duration).toBeLessThanOrEqual(0.45 * Math.min(a.end - a.start, b.end - b.start) + 1e-6);
      }
    });
  }

  it('wrap is a cut (duration 0) when the style is cut; segment 0 starts at 0', () => {
    const tl = build(4, { transitionPool: ['cut'] });
    expect(wrapOf(tl)).toEqual({ style: 'cut', start: 30, duration: 0 });
    expect(tl.segments[0]!.start).toBe(0);
    expect(frameAt(tl, 30)).toEqual(frameAt(tl, 0));
    expect(frameAt(tl, 29.99).kind).toBe('single');
  });

  it('wrap style: sequence continues the pool; photo 0 override wins', () => {
    const pool: TransitionStyle[] = ['crossfade', 'slideLeft', 'zoom'];
    // transitions into photos 1..4 use pool[0..3 % 3]; wrap uses pool[4 % 3]
    const tl = build(5, { transitionPool: pool, selection: 'sequence' });
    expect(tl.segments.slice(1).map((s) => s.transitionIn!.style)).toEqual(['crossfade', 'slideLeft', 'zoom', 'crossfade']);
    expect(wrapOf(tl).style).toBe('slideLeft');
    const tl2 = build(5, { transitionPool: pool }, { p0: { transitionIn: 'wipe' } });
    expect(wrapOf(tl2).style).toBe('wipe');
    const tl3 = build(5, { transitionPool: pool }, { p0: { transitionIn: 'cut' } });
    expect(wrapOf(tl3)).toMatchObject({ style: 'cut', duration: 0 });
  });

  it('random selection: wrap differs from the last photo style when the pool has >1 entry, and is deterministic', () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = S({ selection: 'random', seed, transitionPool: ['crossfade', 'push', 'blur'] });
      const r = resolveStyles(photos(6), {}, s);
      expect(r.wrap).not.toBeNull();
      expect(r.wrap).not.toBe(r.transitions[5]);
      expect(resolveStyles(photos(6), {}, s)).toEqual(r);
    }
  });

  it('loop=false gives wrap null from resolveStyles', () => {
    expect(resolveStyles(photos(3), {}, S({ loop: false })).wrap).toBeNull();
  });

  it('n=1 loop: photo 0 transitions into itself', () => {
    const tl = build(1);
    const w = wrapOf(tl);
    expect(w.duration).toBeGreaterThan(0);
    expect(tl.segments[0]!.end).toBe(30);
    const f = frameAt(tl, 30 - w.duration / 2);
    expect(f.kind).toBe('transition');
    if (f.kind === 'transition') {
      expect(cell0(f.from).photoIndex).toBe(0);
      expect(cell0(f.to).photoIndex).toBe(0);
    }
    expect(frameAt(tl, 30)).toEqual(frameAt(tl, 0));
  });

  it('timingSummary accounts for N transitions', () => {
    const s = timingSummary(photos(10), S({ totalDuration: 30, transitionSpeed: 0.5 }));
    expect(s.avgShot).toBeCloseTo((30 + 10 * s.transition) / 10, 6);
    const tl = build(10, { transitionSpeed: 0.5 });
    const avg = tl.segments.reduce((a, g) => a + g.end - g.start, 0) / 10;
    expect(s.avgShot).toBeCloseTo(avg, 6);
  });

  it('is deterministic', () => {
    expect(build(9, { pacing: 0.8, selection: 'random', seed: 5, transitionPool: ALL })).toEqual(
      build(9, { pacing: 0.8, selection: 'random', seed: 5, transitionPool: ALL }),
    );
  });
});

describe('loop frames', () => {
  it('frameAt(L) deep-equals frameAt(0) across seeds, styles, pacing and N', () => {
    for (const n of [1, 2, 3, 7, 50]) {
      for (const seed of [1, 2, 3, 99]) {
        for (const pacing of [0, 0.5, 1]) {
          for (const style of ALL) {
            const o: Partial<MontageSettings> = {
              seed,
              pacing,
              transitionPool: [style],
              motionPool: ['kenBurns', 'zoomIn', 'panLeft'],
              totalDuration: n === 50 ? 60 : 12,
              transitionSpeed: (seed % 3) / 2,
            };
            const r = buildTimeline(photos(n), {}, S(o));
            if (!r.ok) continue; // pacing 1 can be invalid for tiny photos; covered elsewhere
            const tl = r.timeline;
            expect(frameAt(tl, tl.duration)).toEqual(frameAt(tl, 0));
            expect(frameAt(tl, tl.duration + 5)).toEqual(frameAt(tl, 0));
            expect(frameAt(tl, 0).kind).toBe('single');
          }
        }
      }
    }
  });

  it('wrap frames: from = last photo at t, to = photo 0 at t − L', () => {
    const tl = build(4, { transitionPool: ['crossfade'], motionPool: ['zoomIn'], motionIntensity: 1 });
    const w = wrapOf(tl);
    const t = tl.duration - w.duration / 2;
    const f = frameAt(tl, t);
    expect(f.kind).toBe('transition');
    if (f.kind !== 'transition') return;
    expect(f.progress).toBeCloseTo(0.5, 9);
    expect(cell0(f.from).photoIndex).toBe(3);
    expect(cell0(f.to).photoIndex).toBe(0);
    // Photo 0's motion is already underway (started at −T_wrap) and matches frameAt just after the seam.
    const s0 = tl.segments[0]!;
    const u = (t - tl.duration - s0.start) / (s0.end - s0.start);
    expect(u).toBeGreaterThan(0);
    const f0 = frameAt(tl, 0);
    expect(cell0(f.to).transform.scale).toBeGreaterThan(s0.cells[0]!.motionFrom.scale);
    expect(cell0(f.to).transform.scale).toBeLessThan(f0.kind === 'single' ? cell0(f0.shot).transform.scale : 0);
  });

  it('continuity across the seam: progress → 1 and photo 0 transform → its t=0 value', () => {
    for (const n of [1, 2, 5, 12]) {
      for (const style of ALL.filter((s) => s !== 'cut')) {
        const tl = build(n, { transitionPool: [style], motionPool: ['kenBurns'], motionIntensity: 1, fps: 60 });
        const eps = 1e-4;
        const before = frameAt(tl, tl.duration - eps);
        const at0 = frameAt(tl, 0);
        expect(at0.kind).toBe('single');
        expect(before.kind).toBe('transition');
        if (before.kind !== 'transition' || at0.kind !== 'single') continue;
        expect(before.progress).toBeGreaterThan(0.999);
        expect(cell0(before.to).photoIndex).toBe(0);
        const a = cell0(before.to).transform;
        const b = cell0(at0.shot).transform;
        expect(Math.abs(a.scale - b.scale)).toBeLessThan(1e-3);
        expect(Math.abs(a.tx - b.tx)).toBeLessThan(1e-3);
        expect(Math.abs(a.ty - b.ty)).toBeLessThan(1e-3);
      }
    }
  });

  it('clamps t to [0, L]', () => {
    const tl = build(3);
    expect(frameAt(tl, -5)).toEqual(frameAt(tl, 0));
    expect(frameAt(tl, NaN)).toEqual(frameAt(tl, 0));
  });
});

describe('loop with multi-photo shots (§4.9 × §4.10)', () => {
  // Portraits in landscape output: `auto` pairs them into duos.
  const portraits = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, naturalWidth: 1200, naturalHeight: 1600 }));
  const buildShots = (n: number, o: Partial<MontageSettings>): Timeline => {
    const r = buildTimeline(portraits(n), {}, S({ width: 1920, height: 1080, ...o }));
    if (!r.ok) throw new Error(r.error);
    return r.timeline;
  };
  const photosIn = (shot: Shot) => shot.cells.map((c) => c.photoIndex);

  for (const reveal of ['together', 'stagger'] as const) {
    for (const grouping of ['auto', 'mixed'] as const) {
      it(`${grouping} + ${reveal}: wrap goes last shot → shot 0 and the seam is continuous`, () => {
        for (const n of [2, 5, 9]) {
          const tl = buildShots(n, { grouping, reveal, layoutPool: ['duo', 'trio', 'quad', 'pip', 'polaroid'], seed: n, motionIntensity: 1 });
          const segs = tl.segments;
          const w = wrapOf(tl);
          expect(segs[0]!.start).toBeCloseTo(-w.duration, 9);
          expect(segs.at(-1)!.end).toBe(tl.duration);
          expect(frameAt(tl, tl.duration)).toEqual(frameAt(tl, 0));
          const mid = frameAt(tl, tl.duration - w.duration / 2);
          expect(mid.kind).toBe('transition');
          if (mid.kind !== 'transition') continue;
          expect(photosIn(mid.from)).toEqual(segs.at(-1)!.cells.map((c) => c.photoIndex));
          expect(photosIn(mid.to)).toEqual(segs[0]!.cells.map((c) => c.photoIndex));
          const before = frameAt(tl, tl.duration - 1e-4);
          const at0 = frameAt(tl, 0);
          if (before.kind !== 'transition' || at0.kind !== 'single') throw new Error('expected wrap then single');
          before.to.cells.forEach((c, k) => {
            const d = at0.shot.cells[k]!;
            expect(Math.abs(c.transform.scale - d.transform.scale)).toBeLessThan(1e-3);
            expect(Math.abs(c.reveal - d.reveal)).toBeLessThan(1e-3);
          });
        }
      });
    }
  }

  it('stagger in shot 0 starts after the seam, never during the wrap', () => {
    const tl = buildShots(4, { grouping: 'auto', reveal: 'stagger' });
    const s0 = tl.segments[0]!;
    expect(s0.cells.length).toBe(2);
    expect(s0.cells[0]!.revealDuration).toBe(0);
    expect(s0.cells[1]!.revealStart).toBeGreaterThanOrEqual(0);
    const wrapMid = frameAt(tl, tl.duration - wrapOf(tl).duration / 2);
    if (wrapMid.kind !== 'transition') throw new Error('expected wrap');
    expect(wrapMid.to.cells[1]!.reveal).toBe(0);
  });
});
