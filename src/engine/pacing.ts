import { TRANSITION_FAST, TRANSITION_SLOW } from '../lib/constants';
import { deriveSeed, mulberry32, range } from '../lib/rng';
import { clamp, lerp } from './easing';

/** A transition may take at most this fraction of the shorter adjacent photo (§4.1 step 4). */
export const MAX_TRANSITION_FRACTION = 0.45;
/** Per-photo random variation amplitude at pacing = 1 (±60%). */
const VARIATION = 0.6;
/** Arc amplitude at pacing = 1: lingers on first/last photo, quickens in the middle. */
const ARC = 0.4;
/** Weights never go below this (before normalisation). */
const MIN_WEIGHT = 0.15;

/** Transition duration in seconds: lerp(1.6, 0.15, curve(speed)). Mid-slider ≈ 0.8 s. */
export function transitionDuration(transitionSpeed: number): number {
  const s = clamp(Number.isFinite(transitionSpeed) ? transitionSpeed : 0.5, 0, 1);
  return lerp(TRANSITION_SLOW, TRANSITION_FAST, Math.pow(s, 0.85));
}

/**
 * Pacing weights, one per photo, normalised so they sum to `count`.
 * pacing = 0 → all exactly 1. The random variation uses its own derived stream so it
 * does not depend on any other setting except the seed.
 */
export function pacingWeights(count: number, pacing: number, seed: number): number[] {
  if (count <= 0) return [];
  const p = clamp(Number.isFinite(pacing) ? pacing : 0, 0, 1);
  const rng = mulberry32(deriveSeed(seed, 'pacing'));
  const raw: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = range(rng, -VARIATION, VARIATION); // always drawn, so the slider scales a fixed pattern
    const x = count > 1 ? i / (count - 1) : 0;
    const arc = count > 2 ? ARC * Math.cos(2 * Math.PI * x) : 0;
    raw.push(Math.max(MIN_WEIGHT, 1 + p * (v + arc)));
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => (p === 0 ? 1 : (w * count) / sum));
}

export interface SolvedTiming {
  /** Photo durations D_i (including overlaps). */
  durations: number[];
  /** Effective transition durations T_j between photo j and j+1 (after clamping). */
  transitions: number[];
}

/**
 * Solve D_i = w_i · (L + ΣT) / N with each T_j ≤ 0.45 · min(D_j, D_{j+1}) (§4.1 steps 3–4).
 * `nominal[j]` is the requested transition between photo j and j+1 (0 for cuts).
 */
export function solveTiming(weights: readonly number[], total: number, nominal: readonly number[]): SolvedTiming {
  const n = weights.length;
  const T = nominal.slice(0, Math.max(0, n - 1));
  const durationsFor = (): number[] => {
    const sumT = T.reduce((a, b) => a + b, 0);
    return weights.map((w) => (w * (total + sumT)) / n);
  };
  let D = durationsFor();
  for (let iter = 0; iter < 500; iter++) {
    let change = 0;
    for (let j = 0; j < T.length; j++) {
      const cap = MAX_TRANSITION_FRACTION * Math.min(D[j] as number, D[j + 1] as number);
      const cur = T[j] as number;
      if (cur > cap) {
        change = Math.max(change, cur - cap);
        T[j] = cap;
      }
    }
    D = durationsFor();
    if (change < 1e-12) break;
  }
  return { durations: D, transitions: T };
}

/** Shortest photo duration achievable (transition 0) – used for the "too many photos" check. */
export function minPossibleDuration(weights: readonly number[], total: number): number {
  if (weights.length === 0) return 0;
  return (Math.min(...weights) * total) / weights.length;
}
