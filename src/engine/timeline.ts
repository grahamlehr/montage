import { MIN_PHOTO_DURATION } from '../lib/constants';
import { deriveSeed, mulberry32 } from '../lib/rng';
import type {
  BuildResult,
  MontageSettings,
  PhotoOverrides,
  PhotoSource,
  Segment,
} from '../types';
import { clamp } from './easing';
import { motionTransforms } from './motion';
import { minPossibleDuration, pacingWeights, solveTiming, transitionDuration } from './pacing';
import { resolveStyles } from './styles';

function tooMany(count: number, minWeight: number): string {
  const needed = Math.ceil((MIN_PHOTO_DURATION * count) / minWeight);
  return `Too many photos for this length — each photo would be shorter than ${MIN_PHOTO_DURATION} s. Use a longer video (at least ${needed} s), lower the pacing, or remove photos.`;
}

export function buildTimeline(
  photos: ReadonlyArray<Pick<PhotoSource, 'id'>>,
  overrides: Record<string, PhotoOverrides>,
  settings: MontageSettings,
): BuildResult {
  const n = photos.length;
  if (n === 0) return { ok: false, error: 'Add at least one photo to build a montage.' };
  const L = settings.totalDuration;
  if (!Number.isFinite(L) || L <= 0) return { ok: false, error: 'Total duration must be greater than 0 seconds.' };
  const fps = settings.fps;

  const weights = pacingWeights(n, settings.pacing, settings.seed);
  if (minPossibleDuration(weights, L) < MIN_PHOTO_DURATION - 1e-9) {
    return { ok: false, error: tooMany(n, Math.min(...weights)) };
  }

  const styles = resolveStyles(photos, overrides, settings);
  const nominalT = transitionDuration(settings.transitionSpeed);
  const nominal: number[] = [];
  for (let j = 0; j < n - 1; j++) nominal.push(styles.transitions[j + 1] === 'cut' ? 0 : nominalT);
  const { durations, transitions } = solveTiming(weights, L, nominal);

  const segments: Segment[] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const photo = photos[i] as Pick<PhotoSource, 'id'>;
    const ov = overrides[photo.id];
    const end = i === n - 1 ? L : start + (durations[i] as number);
    const focus = {
      x: clamp(ov?.focus?.x ?? 0.5, 0, 1),
      y: clamp(ov?.focus?.y ?? 0.5, 0, 1),
    };
    const motion = styles.motions[i]!;
    const { from, to } = motionTransforms(
      motion,
      settings.motionIntensity,
      focus,
      mulberry32(deriveSeed(settings.seed, 'kenBurns', i)),
    );
    const tStyle = styles.transitions[i];
    segments.push({
      photoIndex: i,
      start,
      end,
      motion,
      motionFrom: from,
      motionTo: to,
      fit: ov?.fit ?? settings.fit,
      focus,
      transitionIn: i === 0 || !tStyle ? null : { style: tStyle, start, duration: transitions[i - 1] as number },
    });
    if (i < n - 1) start = end - (transitions[i] as number);
  }
  return { ok: true, timeline: { duration: L, fps, frameCount: Math.round(L * fps), segments } };
}

/** Cheap summary for UI labels. `transition` is the nominal (unclamped) duration. */
export function timingSummary(
  photoCount: number,
  settings: MontageSettings,
): { transition: number; avgPhoto: number; minPhoto: number; ok: boolean } {
  const transition = transitionDuration(settings.transitionSpeed);
  if (photoCount <= 0) return { transition, avgPhoto: 0, minPhoto: 0, ok: false };
  const w = pacingWeights(photoCount, settings.pacing, settings.seed);
  const { durations } = solveTiming(w, settings.totalDuration, new Array<number>(photoCount - 1).fill(transition));
  const avgPhoto = durations.reduce((a, b) => a + b, 0) / photoCount;
  const minPhoto = Math.min(...durations);
  const ok = minPossibleDuration(w, settings.totalDuration) >= MIN_PHOTO_DURATION - 1e-9;
  return { transition, avgPhoto, minPhoto, ok };
}

