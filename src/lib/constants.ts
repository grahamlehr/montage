import type { MontageSettings } from '../types';

/** Shared limits and defaults (PLAN.md §1, §3, §4). Orchestrator-owned. */
export const DIM_MIN = 128;
export const DIM_MAX = 4096;
export const DURATION_MIN = 2;
export const DURATION_MAX = 600;

/** Transition duration range in seconds: transitionSpeed 0 → SLOW, 1 → FAST (§4.1). */
export const TRANSITION_SLOW = 1.6;
export const TRANSITION_FAST = 0.15;
/** Maximum zoom delta and pan travel at motionIntensity = 1 (§4.2). */
export const MAX_ZOOM_DELTA = 0.3;
export const MAX_PAN = 0.12;
/** Minimum photo duration before the timeline is rejected (§4.1 step 4). */
export const MIN_PHOTO_DURATION = 0.25;

/** Decode sizes (§4.6). */
export const THUMB_LONG_EDGE = 256;
export const PREVIEW_CAP_FACTOR = 1.35;

/** Bits per pixel per frame for each quality (§4.5). */
export const QUALITY_BPP = { standard: 0.08, high: 0.12, max: 0.18 } as const;
export const KEYFRAME_INTERVAL_S = 2;

export const DEFAULT_SETTINGS: MontageSettings = {
  width: 1080,
  height: 1920,
  fps: 30,
  totalDuration: 30,
  transitionSpeed: 0.5,
  motionIntensity: 0.5,
  pacing: 0,
  motionPool: ['kenBurns'],
  transitionPool: ['crossfade'],
  selection: 'sequence',
  seed: 1,
  fit: 'blur',
  background: '#000000',
  quality: 'high',
};

/** Round to the nearest even integer within [DIM_MIN, DIM_MAX]. */
export function clampEvenDim(n: number): number {
  const v = Math.min(DIM_MAX, Math.max(DIM_MIN, Math.round(n)));
  return v % 2 === 0 ? v : v + 1 > DIM_MAX ? v - 1 : v + 1;
}

export function estimateBitrate(s: Pick<MontageSettings, 'width' | 'height' | 'fps' | 'quality'>): number {
  return Math.round(s.width * s.height * s.fps * QUALITY_BPP[s.quality]);
}

export function estimateFileBytes(
  s: Pick<MontageSettings, 'width' | 'height' | 'fps' | 'quality' | 'totalDuration'>,
): number {
  return Math.round((estimateBitrate(s) * s.totalDuration) / 8);
}
