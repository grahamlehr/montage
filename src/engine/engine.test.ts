import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MAX_PAN, MAX_ZOOM_DELTA, TRANSITION_FAST, TRANSITION_SLOW } from '../lib/constants';
import type { MontageSettings, PhotoOverrides, Timeline } from '../types';
import {
  buildTimeline,
  frameAt,
  motionTransforms,
  pacingWeights,
  resolveStyles,
  timingSummary,
  transitionDuration,
} from './index';

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const S = (o: Partial<MontageSettings> = {}): MontageSettings => ({ ...DEFAULT_SETTINGS, ...o });
function build(n: number, o: Partial<MontageSettings> = {}, ov: Record<string, PhotoOverrides> = {}): Timeline {
  const r = buildTimeline(photos(n), ov, S(o));
  if (!r.ok) throw new Error(r.error);
  return r.timeline;
}

describe('transitionDuration', () => {
  it('maps endpoints and is monotonic', () => {
    expect(transitionDuration(0)).toBeCloseTo(TRANSITION_SLOW, 10);
    expect(transitionDuration(1)).toBeCloseTo(TRANSITION_FAST, 10);
    expect(transitionDuration(0.5)).toBeCloseTo(0.8, 1);
    expect(transitionDuration(0.3)).toBeGreaterThan(transitionDuration(0.6));
  });
});

describe('timeline invariants (§4.1)', () => {
  for (const [n, o] of [
    [1, {}],
    [2, {}],
    [7, { pacing: 1 }],
    [50, { totalDuration: 60, pacing: 0.6, transitionSpeed: 0 }],
    [20, { totalDuration: 10, transitionSpeed: 0 }],
  ] as Array<[number, Partial<MontageSettings>]>) {
    it(`contiguous, exact end, frameCount (n=${n})`, () => {
      const tl = build(n, o);
      const L = o.totalDuration ?? 30;
      expect(tl.segments).toHaveLength(n);
      expect(tl.segments[0]!.start).toBe(0);
      expect(tl.segments[0]!.transitionIn).toBeNull();
      expect(tl.segments[n - 1]!.end).toBe(L);
      expect(tl.duration).toBe(L);
      expect(tl.frameCount).toBe(Math.round(L * 30));
      for (let i = 1; i < n; i++) {
        const prev = tl.segments[i - 1]!;
        const cur = tl.segments[i]!;
        const tr = cur.transitionIn!;
        expect(cur.start).toBeCloseTo(prev.end - tr.duration, 9);
        expect(tr.start).toBeCloseTo(cur.start, 9);
        expect(tr.start + tr.duration).toBeCloseTo(prev.end, 9);
        const dPrev = prev.end - prev.start;
        const dCur = cur.end - cur.start;
        expect(tr.duration).toBeLessThanOrEqual(0.45 * Math.min(dPrev, dCur) + 1e-6);
      }
    });
  }

  it('frameCount rounds duration*fps', () => {
    expect(build(3, { totalDuration: 10.02, fps: 25 }).frameCount).toBe(Math.round(10.02 * 25));
    expect(build(3, { totalDuration: 5, fps: 60 }).frameCount).toBe(300);
  });

  it('single photo: one segment spanning L, no transitions, frameAt is single', () => {
    const tl = build(1);
    expect(tl.segments[0]).toMatchObject({ start: 0, end: 30, transitionIn: null });
    for (const t of [0, 10, 30]) expect(frameAt(tl, t).kind).toBe('single');
  });

  it('errors for 0 photos', () => {
    const r = buildTimeline([], {}, S());
    expect(r.ok).toBe(false);
  });

  it('errors with a user-facing message when too many photos', () => {
    const r = buildTimeline(photos(50), {}, S({ totalDuration: 10 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Too many photos for this length/);
    expect(buildTimeline(photos(40), {}, S({ totalDuration: 10 })).ok).toBe(true); // exactly 0.25 s
  });

  it('pacing can make an otherwise-valid timeline invalid', () => {
    expect(buildTimeline(photos(30), {}, S({ totalDuration: 8, pacing: 0 })).ok).toBe(true);
    expect(buildTimeline(photos(30), {}, S({ totalDuration: 8, pacing: 1 })).ok).toBe(false);
  });
});

describe('pacing', () => {
  it('pacing 0 gives equal durations', () => {
    expect(pacingWeights(5, 0, 7)).toEqual([1, 1, 1, 1, 1]);
    const tl = build(5, { pacing: 0, transitionSpeed: 1 });
    const d = tl.segments.map((s) => s.end - s.start);
    for (const x of d) expect(x).toBeCloseTo(d[0]!, 9);
  });

  it('pacing 1 is varied, normalised, within bounds, and lingers on ends', () => {
    const w = pacingWeights(12, 1, 3);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(12, 9);
    expect(Math.max(...w) - Math.min(...w)).toBeGreaterThan(0.3);
    expect(Math.min(...w)).toBeGreaterThan(0);
    // arc only (average across seeds): first/last > middle
    let ends = 0;
    let mid = 0;
    for (let seed = 0; seed < 200; seed++) {
      const x = pacingWeights(9, 1, seed);
      ends += x[0]! + x[8]!;
      mid += x[4]! * 2;
    }
    expect(ends).toBeGreaterThan(mid);
  });

  it('weights are independent of totalDuration and speed; variation scales with pacing', () => {
    const a = pacingWeights(6, 0.5, 9);
    const b = pacingWeights(6, 1, 9);
    expect(a).not.toEqual(b);
    expect(pacingWeights(6, 0.5, 9)).toEqual(a);
  });

  it('clamp: slow transitions on short photos are reduced; durations recomputed to sum to L', () => {
    const tl = build(20, { totalDuration: 10, transitionSpeed: 0 });
    const tr = tl.segments[1]!.transitionIn!;
    expect(tr.duration).toBeLessThan(TRANSITION_SLOW);
    expect(tr.duration).toBeGreaterThan(0.2);
    const sumD = tl.segments.reduce((a, s) => a + (s.end - s.start), 0);
    const sumT = tl.segments.reduce((a, s) => a + (s.transitionIn?.duration ?? 0), 0);
    expect(sumD - sumT).toBeCloseTo(10, 6);
  });

  it('unclamped transitions keep nominal length', () => {
    const tl = build(3, { totalDuration: 60, transitionSpeed: 0.5 });
    expect(tl.segments[1]!.transitionIn!.duration).toBeCloseTo(transitionDuration(0.5), 9);
  });
});

describe('style assignment (§4.3)', () => {
  const pool = { motionPool: ['zoomIn', 'zoomOut', 'panLeft'] as const, transitionPool: ['crossfade', 'push', 'wipe'] as const };
  const base = { motionPool: [...pool.motionPool], transitionPool: [...pool.transitionPool], seed: 5 };

  it('sequence cycles through the pools', () => {
    const r = resolveStyles(photos(7), {}, { ...base, selection: 'sequence' });
    expect(r.motions).toEqual(['zoomIn', 'zoomOut', 'panLeft', 'zoomIn', 'zoomOut', 'panLeft', 'zoomIn']);
    expect(r.transitions).toEqual([null, 'crossfade', 'push', 'wipe', 'crossfade', 'push', 'wipe']);
  });

  it('random never repeats the previous style and is seeded', () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = resolveStyles(photos(40), {}, { ...base, seed, selection: 'random' });
      for (let i = 1; i < 40; i++) {
        expect(r.motions[i]).not.toBe(r.motions[i - 1]);
        if (i > 1) expect(r.transitions[i]).not.toBe(r.transitions[i - 1]);
      }
    }
    const a = resolveStyles(photos(20), {}, { ...base, seed: 1, selection: 'random' });
    const b = resolveStyles(photos(20), {}, { ...base, seed: 2, selection: 'random' });
    expect(a).not.toEqual(b);
    expect(new Set(a.motions).size).toBeGreaterThan(1);
  });

  it('single-entry pool repeats', () => {
    const r = resolveStyles(photos(4), {}, { ...base, motionPool: ['zoomIn'], selection: 'random' });
    expect(r.motions).toEqual(['zoomIn', 'zoomIn', 'zoomIn', 'zoomIn']);
  });

  it('overrides win over pools (sequence and random)', () => {
    const ov: Record<string, PhotoOverrides> = {
      p1: { motion: 'none', transitionIn: 'cut' },
      p0: { transitionIn: 'zoom', motion: 'panDown' },
    };
    for (const selection of ['sequence', 'random'] as const) {
      const r = resolveStyles(photos(4), ov, { ...base, selection });
      expect(r.motions[0]).toBe('panDown');
      expect(r.motions[1]).toBe('none');
      expect(r.transitions[0]).toBeNull(); // ignored for photo 0
      expect(r.transitions[1]).toBe('cut');
    }
  });

  it('overrides for fit and focus reach the segment; default focus is centred', () => {
    const tl = build(2, {}, { p1: { fit: 'contain', focus: { x: 0.2, y: 0.9 } } });
    expect(tl.segments[0]).toMatchObject({ fit: 'blur', focus: { x: 0.5, y: 0.5 } });
    expect(tl.segments[1]).toMatchObject({ fit: 'contain', focus: { x: 0.2, y: 0.9 } });
  });

  it('changing the transition pool does not reshuffle motion choices', () => {
    const s = { ...base, selection: 'random' as const };
    const a = resolveStyles(photos(15), {}, s);
    const b = resolveStyles(photos(15), {}, { ...s, transitionPool: ['crossfade', 'blur'] });
    expect(b.motions).toEqual(a.motions);
  });
});

describe('motion transforms (§4.2)', () => {
  const c = { x: 0.5, y: 0.5 };
  it('none is identity; intensity 0 is identity for everything', () => {
    expect(motionTransforms('none', 1, c)).toEqual({
      from: { scale: 1, tx: 0, ty: 0 },
      to: { scale: 1, tx: 0, ty: 0 },
    });
    for (const m of ['kenBurns', 'zoomIn', 'zoomOut', 'panLeft', 'panRight', 'panUp', 'panDown'] as const) {
      const r = motionTransforms(m, 0, c);
      expect(r.from).toEqual({ scale: 1, tx: 0, ty: 0 });
      expect(r.to).toEqual({ scale: 1, tx: 0, ty: 0 });
    }
  });

  it('zoom directions and magnitude', () => {
    const zi = motionTransforms('zoomIn', 1, c);
    expect(zi.from.scale).toBe(1);
    expect(zi.to.scale).toBeCloseTo(1 + MAX_ZOOM_DELTA, 10);
    const zo = motionTransforms('zoomOut', 0.5, c);
    expect(zo.from.scale).toBeCloseTo(1.15, 10);
    expect(zo.to.scale).toBe(1);
  });

  it('pan directions and travel', () => {
    const l = motionTransforms('panLeft', 1, c);
    expect(l.to.tx).toBeLessThan(l.from.tx);
    expect(l.from.tx - l.to.tx).toBeCloseTo(MAX_PAN, 10);
    expect(l.from.scale).toBeCloseTo(1 + MAX_PAN, 10);
    const r = motionTransforms('panRight', 1, c);
    expect(r.to.tx).toBeGreaterThan(r.from.tx);
    const u = motionTransforms('panUp', 1, c);
    expect(u.to.ty).toBeLessThan(u.from.ty);
    expect(u.to.tx).toBe(u.from.tx);
    const d = motionTransforms('panDown', 1, c);
    expect(d.to.ty).toBeGreaterThan(d.from.ty);
  });

  it('kenBurns pans toward/away from focus, bounded by MAX_PAN * intensity', () => {
    const focus = { x: 0.1, y: 0.5 }; // focus left of centre → content drifts right (+x) when "toward"
    let toward = 0;
    let away = 0;
    for (let s = 0; s < 100; s++) {
      const rng = (() => {
        let k = s;
        return () => ((k = (k * 16807 + 11) % 2147483647) / 2147483647);
      })();
      const { from, to } = motionTransforms('kenBurns', 0.7, focus, rng);
      const dx = to.tx - from.tx;
      expect(Math.abs(dx)).toBeLessThanOrEqual(MAX_PAN * 0.7 + 1e-9);
      expect(Math.abs(from.tx)).toBeLessThanOrEqual((MAX_PAN * 0.7) / 2 + 1e-9);
      expect(Math.abs(to.ty - from.ty)).toBeLessThan(1e-9);
      expect(from.scale).not.toBe(to.scale);
      expect(Math.max(from.scale, to.scale)).toBeLessThanOrEqual(1 + MAX_ZOOM_DELTA + 1e-9);
      if (dx > 0) toward++;
      else away++;
    }
    expect(toward).toBeGreaterThan(10);
    expect(away).toBeGreaterThan(10);
  });
});

describe('determinism', () => {
  it('same inputs + seed ⇒ deep-equal timeline; different seed differs', () => {
    const o = { pacing: 0.8, selection: 'random' as const, motionPool: ['kenBurns', 'zoomIn', 'panLeft'] as MontageSettings['motionPool'], transitionPool: ['crossfade', 'push', 'zoom'] as MontageSettings['transitionPool'] };
    const a = build(12, { ...o, seed: 42 });
    const b = build(12, { ...o, seed: 42 });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(build(12, { ...o, seed: 43 })).not.toEqual(a);
  });
});

describe('frameAt', () => {
  const tl = build(4, { totalDuration: 20, transitionSpeed: 0.5 });
  const seg1 = tl.segments[1]!;
  const tr = seg1.transitionIn!;

  it('t=0 is single photo 0 at motionFrom', () => {
    const f = frameAt(tl, 0);
    expect(f.kind).toBe('single');
    if (f.kind === 'single') {
      expect(f.layer.photoIndex).toBe(0);
      expect(f.layer.transform).toEqual(tl.segments[0]!.motionFrom);
    }
  });

  it('clamps t below 0 and above L', () => {
    expect(frameAt(tl, -5)).toEqual(frameAt(tl, 0));
    expect(frameAt(tl, 999)).toEqual(frameAt(tl, tl.duration));
    expect(frameAt(tl, NaN)).toEqual(frameAt(tl, 0));
  });

  it('t=L is the last photo at motionTo', () => {
    const f = frameAt(tl, tl.duration);
    expect(f.kind).toBe('single');
    if (f.kind === 'single') {
      expect(f.layer.photoIndex).toBe(3);
      expect(f.layer.transform.scale).toBeCloseTo(tl.segments[3]!.motionTo.scale, 12);
      expect(f.layer.transform.tx).toBeCloseTo(tl.segments[3]!.motionTo.tx, 12);
    }
  });

  it('mid-transition returns eased progress and both layers', () => {
    const f = frameAt(tl, tr.start + tr.duration / 2);
    expect(f.kind).toBe('transition');
    if (f.kind === 'transition') {
      expect(f.style).toBe(tr.style);
      expect(f.progress).toBeCloseTo(0.5, 9);
      expect(f.from.photoIndex).toBe(0);
      expect(f.to.photoIndex).toBe(1);
    }
    const early = frameAt(tl, tr.start + tr.duration * 0.25);
    if (early.kind === 'transition') {
      expect(early.progress).toBeLessThan(0.25); // ease-in
      expect(early.progress).toBeGreaterThan(0);
    }
  });

  it('transition start is progress 0 and its end is a pure single of the next photo', () => {
    const f0 = frameAt(tl, tr.start);
    expect(f0.kind === 'transition' && f0.progress).toBe(0);
    const f1 = frameAt(tl, tr.start + tr.duration);
    expect(f1.kind).toBe('single');
    if (f1.kind === 'single') expect(f1.layer.photoIndex).toBe(1);
  });

  it('progress is monotonic across the transition', () => {
    let last = -1;
    for (let k = 0; k < 20; k++) {
      const f = frameAt(tl, tr.start + (tr.duration * k) / 20);
      expect(f.kind).toBe('transition');
      if (f.kind === 'transition') {
        expect(f.progress).toBeGreaterThanOrEqual(last);
        last = f.progress;
      }
    }
  });

  it('layer transform is eased across the whole segment, continuous through a transition', () => {
    const t = build(3, { totalDuration: 12, motionPool: ['zoomIn'], motionIntensity: 1 });
    const s = t.segments[0]!;
    const mid = frameAt(t, (s.start + s.end) / 2);
    expect(mid.kind).toBe('single');
    if (mid.kind === 'single') expect(mid.layer.transform.scale).toBeCloseTo(1 + MAX_ZOOM_DELTA / 2, 9);
    const tr1 = t.segments[1]!.transitionIn!;
    const f = frameAt(t, tr1.start + 0.01);
    if (f.kind === 'transition') {
      expect(f.from.transform.scale).toBeGreaterThan(1.2); // outgoing photo is still moving
      expect(f.to.transform.scale).toBeCloseTo(1, 2); // incoming starts at its motionFrom
    }
  });

  it('cut transitions have zero duration and never produce a transition frame', () => {
    const t = build(5, { totalDuration: 10, transitionPool: ['cut'] });
    for (const s of t.segments.slice(1)) {
      expect(s.transitionIn).toMatchObject({ style: 'cut', duration: 0 });
      expect(s.start).toBe(t.segments[s.photoIndex - 1]!.end);
    }
    for (let k = 0; k <= 400; k++) expect(frameAt(t, (10 * k) / 400).kind).toBe('single');
    const cutAt = t.segments[2]!.start;
    const before = frameAt(t, cutAt - 1e-6);
    const at = frameAt(t, cutAt);
    expect(before.kind === 'single' && before.layer.photoIndex).toBe(1);
    expect(at.kind === 'single' && at.layer.photoIndex).toBe(2);
  });

  it('sweeping every frame always yields valid descriptors', () => {
    for (let i = 0; i < tl.frameCount; i++) {
      const f = frameAt(tl, i / tl.fps);
      const l = f.kind === 'single' ? f.layer : f.to;
      expect(l.photoIndex).toBeGreaterThanOrEqual(0);
      expect(l.photoIndex).toBeLessThan(4);
    }
  });
});

describe('timingSummary', () => {
  it('reports transition, avg photo, min photo and ok', () => {
    const s = timingSummary(10, S({ totalDuration: 30, transitionSpeed: 0.5 }));
    expect(s.transition).toBeCloseTo(0.8, 1);
    expect(s.avgPhoto).toBeCloseTo((30 + 9 * s.transition) / 10, 6);
    expect(s.minPhoto).toBeCloseTo(s.avgPhoto, 6);
    expect(s.ok).toBe(true);
    expect(timingSummary(500, S({ totalDuration: 30 })).ok).toBe(false);
    expect(timingSummary(0, S()).ok).toBe(false);
  });
});
