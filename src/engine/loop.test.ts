import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants';
import type { FrameDescriptor, MontageSettings, PhotoOverrides, Timeline, TransitionStyle } from '../types';
import { buildTimeline, frameAt, resolveStyles, timingSummary } from './index';
import { GOLDEN_CONFIGS } from './golden-configs';
import golden from './golden-noloop.json';

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const S = (o: Partial<MontageSettings> = {}): MontageSettings => ({ ...DEFAULT_SETTINGS, loop: true, ...o });
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
      const r = buildTimeline(photos(c.n), c.ov ?? {}, { ...DEFAULT_SETTINGS, loop: false, ...c.s });
      const g = golden[k] as unknown as { timeline: Record<string, unknown>; frames: unknown[] };
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const tl = r.timeline;
      expect(tl.loop).toBe(false);
      expect(JSON.parse(JSON.stringify({ ...tl, loop: undefined }))).toEqual(g.timeline);
      const frames: FrameDescriptor[] = [];
      for (let i = 0; i <= 40; i++) frames.push(frameAt(tl, (tl.duration * i) / 40));
      expect(JSON.parse(JSON.stringify(frames))).toEqual(g.frames);
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
      expect(f.from.photoIndex).toBe(0);
      expect(f.to.photoIndex).toBe(0);
    }
    expect(frameAt(tl, 30)).toEqual(frameAt(tl, 0));
  });

  it('timingSummary accounts for N transitions', () => {
    const s = timingSummary(10, S({ totalDuration: 30, transitionSpeed: 0.5 }));
    expect(s.avgPhoto).toBeCloseTo((30 + 10 * s.transition) / 10, 6);
    const tl = build(10, { transitionSpeed: 0.5 });
    const avg = tl.segments.reduce((a, g) => a + g.end - g.start, 0) / 10;
    expect(s.avgPhoto).toBeCloseTo(avg, 6);
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
    expect(f.from.photoIndex).toBe(3);
    expect(f.to.photoIndex).toBe(0);
    // Photo 0's motion is already underway (started at −T_wrap) and matches frameAt just after the seam.
    const s0 = tl.segments[0]!;
    const u = (t - tl.duration - s0.start) / (s0.end - s0.start);
    expect(u).toBeGreaterThan(0);
    expect(f.to.transform.scale).toBeGreaterThan(s0.motionFrom.scale);
    expect(f.to.transform.scale).toBeLessThan(frameAt(tl, 0).kind === 'single' ? (frameAt(tl, 0) as { layer: { transform: { scale: number } } }).layer.transform.scale : 0);
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
        expect(before.to.photoIndex).toBe(0);
        const a = before.to.transform;
        const b = at0.layer.transform;
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
