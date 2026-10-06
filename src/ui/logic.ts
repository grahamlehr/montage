import {
  DIM_MAX, DIM_MIN, DURATION_MAX, DURATION_MIN, MAX_MACROBLOCKS, TRANSITION_FAST, TRANSITION_SLOW, clampEvenDim,
  fitsEncoderArea, macroblocks, maxEvenHeightFor,
} from '../lib/constants';
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

/** Largest even width (>= DIM_MIN) that fits the macroblock cap for a given height (symmetric to maxEvenHeightFor). */
export function maxEvenWidthFor(height: number, width = DIM_MAX): number {
  return maxEvenHeightFor(height, width);
}

export type AreaClamp = 'none' | 'width' | 'height' | 'both';

/** Human text for the area-cap note (the "9.4 MP" figure is MAX_MACROBLOCKS * 256 px). */
export const AREA_CAP_LABEL = `${((MAX_MACROBLOCKS * 256) / 1e6).toFixed(1)} MP`;

export function areaNoteText(clamp: AreaClamp, width: number, height: number): string {
  const head = `Max ${AREA_CAP_LABEL} for H.264 in Chrome`;
  if (clamp === 'height') return `${head} — height limited to ${height}`;
  if (clamp === 'width') return `${head} — width limited to ${width}`;
  if (clamp === 'both') return `${head} — size reduced to ${width}×${height}`;
  return `${head} — this size is at the limit`;
}

/** Note to show for a settled size: null unless the size sits exactly at the cap. */
export function atCapNote(width: number, height: number): string | null {
  return macroblocks(width, height) >= MAX_MACROBLOCKS ? areaNoteText('none', width, height) : null;
}

/** Aspect-locked: shrink the pair (keeping the edited side as large as possible) until it fits the area cap. */
function shrinkLocked(
  changed: 'width' | 'height',
  edited: number,
  ratio: number,
): { width: number; height: number } {
  for (let v = edited; v >= DIM_MIN; v -= 2) {
    const other = clampEvenDim(changed === 'width' ? v / ratio : v * ratio);
    const dims = changed === 'width' ? { width: v, height: other } : { width: other, height: v };
    if (fitsEncoderArea(dims.width, dims.height)) return dims;
  }
  return { width: DIM_MIN, height: DIM_MIN };
}

/** Dimensions after changing one side while keeping aspect `ratio` (= width / height), before the area cap. */
function lockedDimsUncapped(
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

/** Like lockedDims, also reporting whether the area cap shrank the result. */
export function lockedDimsCapped(
  changed: 'width' | 'height',
  value: number,
  ratio: number,
): { width: number; height: number; clamped: boolean } {
  const raw = lockedDimsUncapped(changed, value, ratio);
  if (fitsEncoderArea(raw.width, raw.height)) return { ...raw, clamped: false };
  return { ...shrinkLocked(changed, changed === 'width' ? raw.width : raw.height, ratio), clamped: true };
}

/** Dimensions after changing one side while keeping aspect `ratio` (= width / height); satisfies the area cap. */
export function lockedDims(
  changed: 'width' | 'height',
  value: number,
  ratio: number,
): { width: number; height: number } {
  const { width, height } = lockedDimsCapped(changed, value, ratio);
  return { width, height };
}

/** Fit a ratio rw:rh by keeping the width (adjusting it only if the height would be out of range or too big). */
export function dimsForRatio(width: number, rw: number, rh: number): { width: number; height: number } {
  return lockedDims('width', width, rw / rh);
}

export function dimsForRatioCapped(
  width: number,
  rw: number,
  rh: number,
): { width: number; height: number; clamped: boolean } {
  return lockedDimsCapped('width', width, rw / rh);
}

/** Unlocked: keep the edited side, clamp the other to the area cap. */
export function capKeeping(
  keep: 'width' | 'height',
  width: number,
  height: number,
): { width: number; height: number; clamped: boolean } {
  if (fitsEncoderArea(width, height)) return { width, height, clamped: false };
  return keep === 'width'
    ? { width, height: maxEvenHeightFor(width, height), clamped: true }
    : { width: maxEvenWidthFor(height, width), height, clamped: true };
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
  return applySettingsPatchDetailed(prev, patch, aspectLocked).settings;
}

/** applySettingsPatch plus which dimension (if any) the encoder area cap forced down. */
export function applySettingsPatchDetailed(
  prev: MontageSettings,
  patch: Partial<MontageSettings>,
  aspectLocked: boolean,
): { settings: MontageSettings; areaClamp: AreaClamp } {
  const next: MontageSettings = { ...prev };
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  let areaClamp: AreaClamp = 'none';

  const hasW = finite(patch.width);
  const hasH = finite(patch.height);
  if (hasW && hasH) {
    const r = capKeeping('width', clampEvenDim(patch.width as number), clampEvenDim(patch.height as number));
    next.width = r.width;
    next.height = r.height;
    if (r.clamped) areaClamp = 'height';
  } else if (hasW || hasH) {
    const changed = hasW ? 'width' : 'height';
    const value = (hasW ? patch.width : patch.height) as number;
    if (aspectLocked) {
      const r = lockedDimsCapped(changed, value, prev.width / prev.height);
      next.width = r.width;
      next.height = r.height;
      if (r.clamped) areaClamp = 'both';
    } else {
      const v = clampEvenDim(value);
      const r = capKeeping(changed, hasW ? v : prev.width, hasH ? v : prev.height);
      next.width = r.width;
      next.height = r.height;
      if (r.clamped) areaClamp = changed === 'width' ? 'height' : 'width';
    }
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
  return { settings: next, areaClamp };
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

/** Notice text for files the tray refused (not images). Lists up to 3 names. */
export function skippedFilesMessage(names: readonly string[]): string {
  const n = names.length;
  if (n === 0) return '';
  const shown = names.slice(0, 3).join(', ');
  const more = n > 3 ? ` and ${n - 3} more` : '';
  return `Skipped ${n} ${n === 1 ? 'file that isn’t a supported image' : 'files that aren’t supported images'}: ${shown}${more}`;
}
