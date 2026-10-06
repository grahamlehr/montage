import { DIM_MAX, DIM_MIN, DURATION_MAX, DURATION_MIN, TRANSITION_FAST, TRANSITION_SLOW, clampEvenDim } from '../lib/constants';
import { mulberry32, shuffle } from '../lib/rng';
import type { FitMode, MontageSettings, MotionStyle, PhotoOverrides, TransitionStyle } from '../types';
import type { DimensionPreset } from './types';

/** PLAN.md §4.5 presets. */
export const DIMENSION_PRESETS: readonly DimensionPreset[] = [
  { label: '9:16', width: 1080, height: 1920 },
  { label: '16:9', width: 1920, height: 1080 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '4:5', width: 1080, height: 1350 },
  { label: '4:3', width: 1440, height: 1080 },
  { label: '3:4', width: 1080, height: 1440 },
  { label: '21:9', width: 2560, height: 1080 },
  { label: '2:3', width: 1080, height: 1620 },
];

export const FPS_OPTIONS = [24, 25, 30, 60] as const;
export const MOTION_STYLES: readonly MotionStyle[] = [
  'none', 'kenBurns', 'zoomIn', 'zoomOut', 'panLeft', 'panRight', 'panUp', 'panDown',
];
export const TRANSITION_STYLES: readonly TransitionStyle[] = [
  'cut', 'crossfade', 'dipToBlack', 'slideLeft', 'slideRight', 'slideUp', 'slideDown', 'push', 'wipe', 'zoom', 'blur',
];
export const FIT_MODES: readonly FitMode[] = ['cover', 'contain', 'blur'];
export const QUALITIES = ['standard', 'high', 'max'] as const;

export const STYLE_LABELS: Record<string, string> = {
  none: 'None', kenBurns: 'Ken Burns', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
  panLeft: 'Pan left', panRight: 'Pan right', panUp: 'Pan up', panDown: 'Pan down',
  cut: 'Cut', crossfade: 'Crossfade', dipToBlack: 'Dip to black',
  slideLeft: 'Slide left', slideRight: 'Slide right', slideUp: 'Slide up', slideDown: 'Slide down',
  push: 'Push', wipe: 'Wipe', zoom: 'Zoom', blur: 'Blur',
  cover: 'Cover', contain: 'Contain',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Parse "7:5", "7/5", "7x5" or a decimal like "1.4" into a positive width/height pair. */
export function parseRatio(text: string): { w: number; h: number } | null {
  const t = text.trim().replace(/\s+/g, '');
  const m = /^(\d+(?:\.\d+)?)[:/xX](\d+(?:\.\d+)?)$/.exec(t);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    return w > 0 && h > 0 ? { w, h } : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(t)) {
    const r = Number(t);
    return r > 0 ? { w: r, h: 1 } : null;
  }
  return null;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Human ratio such as "9:16" for the current dimensions. */
export function formatRatio(width: number, height: number): string {
  const g = gcd(width, height) || 1;
  const w = width / g;
  const h = height / g;
  if (w > 40 || h > 40) return `${(width / height).toFixed(3)}:1`;
  return `${w}:${h}`;
}

/** Dimensions after changing one side while keeping aspect `ratio` (= width / height). */
export function lockedDims(
  changed: 'width' | 'height',
  value: number,
  ratio: number,
): { width: number; height: number } {
  const v = clampEvenDim(value);
  const other = changed === 'width' ? v / ratio : v * ratio;
  if (other >= DIM_MIN && other <= DIM_MAX) {
    const o = clampEvenDim(other);
    return changed === 'width' ? { width: v, height: o } : { width: o, height: v };
  }
  // the other side would leave the valid range: pin it and back-solve the changed side
  const o = clampEvenDim(other);
  const back = clampEvenDim(changed === 'width' ? o * ratio : o / ratio);
  return changed === 'width' ? { width: back, height: o } : { width: o, height: back };
}

/** Fit a ratio rw:rh by keeping the width (adjusting it only if the height would be out of range). */
export function dimsForRatio(width: number, rw: number, rh: number): { width: number; height: number } {
  const ratio = rw / rh;
  return lockedDims('width', width, ratio);
}

function isHexColour(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

/** Validate/clamp a settings patch against the current settings. Pure. */
export function applySettingsPatch(
  prev: MontageSettings,
  patch: Partial<MontageSettings>,
  aspectLocked: boolean,
): MontageSettings {
  const next: MontageSettings = { ...prev };
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

  const hasW = finite(patch.width);
  const hasH = finite(patch.height);
  if (hasW && hasH) {
    next.width = clampEvenDim(patch.width as number);
    next.height = clampEvenDim(patch.height as number);
  } else if (hasW) {
    if (aspectLocked) Object.assign(next, lockedDims('width', patch.width as number, prev.width / prev.height));
    else next.width = clampEvenDim(patch.width as number);
  } else if (hasH) {
    if (aspectLocked) Object.assign(next, lockedDims('height', patch.height as number, prev.width / prev.height));
    else next.height = clampEvenDim(patch.height as number);
  }

  if (patch.fps !== undefined && (FPS_OPTIONS as readonly number[]).includes(patch.fps)) next.fps = patch.fps;
  if (finite(patch.totalDuration)) next.totalDuration = clamp(Math.round(patch.totalDuration * 10) / 10, DURATION_MIN, DURATION_MAX);
  if (finite(patch.transitionSpeed)) next.transitionSpeed = clamp(patch.transitionSpeed, 0, 1);
  if (finite(patch.motionIntensity)) next.motionIntensity = clamp(patch.motionIntensity, 0, 1);
  if (finite(patch.pacing)) next.pacing = clamp(patch.pacing, 0, 1);
  if (patch.motionPool) {
    const pool = MOTION_STYLES.filter((s) => patch.motionPool?.includes(s));
    if (pool.length >= 1) next.motionPool = pool;
  }
  if (patch.transitionPool) {
    const pool = TRANSITION_STYLES.filter((s) => patch.transitionPool?.includes(s));
    if (pool.length >= 1) next.transitionPool = pool;
  }
  if (patch.selection === 'sequence' || patch.selection === 'random') next.selection = patch.selection;
  if (finite(patch.seed)) next.seed = Math.floor(patch.seed) >>> 0;
  if (patch.fit && FIT_MODES.includes(patch.fit)) next.fit = patch.fit;
  if (typeof patch.background === 'string' && isHexColour(patch.background)) next.background = patch.background.toLowerCase();
  if (patch.quality && (QUALITIES as readonly string[]).includes(patch.quality)) next.quality = patch.quality;
  return next;
}

/** Toggle a style in a pool; refuses to remove the last entry. */
export function togglePool<T extends string>(pool: readonly T[], style: T): T[] {
  if (pool.includes(style)) return pool.length > 1 ? pool.filter((s) => s !== style) : pool.slice();
  return [...pool, style];
}

export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const out = items.slice();
  if (from < 0 || from >= out.length) return out;
  const t = clamp(to, 0, out.length - 1);
  const [item] = out.splice(from, 1);
  out.splice(t, 0, item as T);
  return out;
}

/** Deterministic shuffle for a given seed. */
export function shuffleItems<T>(items: readonly T[], seed: number): T[] {
  return shuffle(mulberry32(seed), items);
}

/** Merge an override patch; `undefined` values delete keys; empty result returns undefined. */
export function mergeOverride(
  prev: PhotoOverrides | undefined,
  patch: Partial<Record<keyof PhotoOverrides, PhotoOverrides[keyof PhotoOverrides] | undefined>>,
): PhotoOverrides | undefined {
  const merged: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete merged[k];
    else if (k === 'focus') {
      const f = v as { x: number; y: number };
      merged[k] = { x: clamp(f.x, 0, 1), y: clamp(f.y, 0, 1) };
    } else merged[k] = v;
  }
  return Object.keys(merged).length ? (merged as PhotoOverrides) : undefined;
}

export interface TimingEstimate {
  transition: number;
  avgPhoto: number;
  minPhoto: number;
  ok: boolean;
}

/** Local fallback estimate (§4.1) used when the engine's timing isn't injected. */
export function estimateTiming(s: MontageSettings, photoCount: number): TimingEstimate {
  const n = Math.max(1, photoCount);
  let transition = n <= 1 ? 0 : TRANSITION_SLOW + (TRANSITION_FAST - TRANSITION_SLOW) * s.transitionSpeed;
  let avgPhoto = (s.totalDuration + (n - 1) * transition) / n;
  if (transition > 0.45 * avgPhoto) {
    // transitions are clamped to 45% of the photo duration (§4.1 step 4)
    avgPhoto = s.totalDuration / (n - 0.45 * (n - 1));
    transition = 0.45 * avgPhoto;
  }
  const minPhoto = avgPhoto * (1 - 0.6 * s.pacing);
  return { transition, avgPhoto, minPhoto, ok: avgPhoto >= 0.25 };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const formatSeconds = (s: number) => `${s.toFixed(1)} s`;
