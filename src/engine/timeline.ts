import { CELL_MOTION_SCALE, MIN_PHOTO_DURATION } from '../lib/constants';
import { deriveSeed, mulberry32 } from '../lib/rng';
import type { BuildResult, Cell, MontageSettings, PhotoOverrides, Segment } from '../types';
import { clamp } from './easing';
import { groupPhotos, type GroupablePhoto, type ShotGroup } from './grouping';
import { layoutCells } from './layouts';
import { motionTransforms } from './motion';
import { minPossibleDuration, pacingWeights, solveTiming, transitionDuration } from './pacing';
import { resolveStyles } from './styles';

/** Stagger limits (§4.7.3). */
const STAGGER_STEP_MAX = 0.3;
const STAGGER_STEP_FRACTION = 0.12;
const STAGGER_DURATION_MAX = 0.35;
const STAGGER_DURATION_FACTOR = 1.2;
const STAGGER_HOLD_FRACTION = 0.5;

function tooMany(count: number, minWeight: number): string {
  const needed = Math.ceil((MIN_PHOTO_DURATION * count) / minWeight);
  return `Too many photos for this length — each photo would be shorter than ${MIN_PHOTO_DURATION} s. Use a longer video (at least ${needed} s), lower the pacing, or remove photos.`;
}

/** Extra screen time for a shot of k photos (§4.7.3). */
export function shotWeight(k: number): number {
  return 1 + 0.5 * (k - 1);
}

/** Pacing weights per shot × shotWeight, renormalised to sum to the shot count. Untouched when all shots are single. */
export function shotWeights(groups: readonly ShotGroup[], pacing: number, seed: number): number[] {
  const S = groups.length;
  const base = pacingWeights(S, pacing, seed);
  if (groups.every((g) => g.photoIndices.length === 1)) return base;
  const raw = base.map((w, s) => w * shotWeight(groups[s]?.photoIndices.length ?? 1));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => (w * S) / sum);
}

/**
 * Nominal transition into each shot (index 0 = null) — first photo's override, else the pool at shot index —
 * plus the loop wrap (last shot → shot 0; photo 0's override wins) when `settings.loop`.
 */
function shotTransitions(
  photos: readonly GroupablePhoto[],
  groups: readonly ShotGroup[],
  overrides: Record<string, PhotoOverrides>,
  settings: MontageSettings,
): Pick<ReturnType<typeof resolveStyles>, 'transitions' | 'wrap'> {
  const firsts = groups.map((g) => photos[g.photoIndices[0] as number] as GroupablePhoto);
  return resolveStyles(firsts, overrides, settings);
}

export function buildTimeline(
  photos: readonly GroupablePhoto[],
  overrides: Record<string, PhotoOverrides>,
  settings: MontageSettings,
): BuildResult {
  const n = photos.length;
  if (n === 0) return { ok: false, error: 'Add at least one photo to build a montage.' };
  const L = settings.totalDuration;
  if (!Number.isFinite(L) || L <= 0)
    return { ok: false, error: 'Total duration must be greater than 0 seconds.' };
  const fps = settings.fps;

  const groups = groupPhotos(photos, overrides, settings);
  const S = groups.length;
  const weights = shotWeights(groups, settings.pacing, settings.seed);
  if (minPossibleDuration(weights, L) < MIN_PHOTO_DURATION - 1e-9) {
    return { ok: false, error: tooMany(S, Math.min(...weights)) };
  }

  const motions = resolveStyles(photos, overrides, settings).motions;
  const shotTrans = shotTransitions(photos, groups, overrides, settings);
  const nominalT = transitionDuration(settings.transitionSpeed);
  const nominal: number[] = [];
  for (let j = 0; j < S - 1; j++) nominal.push(shotTrans.transitions[j + 1] === 'cut' ? 0 : nominalT);
  const loop = settings.loop === true;
  if (loop) nominal.push(shotTrans.wrap === 'cut' ? 0 : nominalT);
  const { durations, transitions } = solveTiming(weights, L, nominal, loop);
  const wrapT = loop ? (transitions[S - 1] as number) : 0;

  const segments: Segment[] = [];
  let start = 0 - wrapT; // shot 0 begins during the wrap so its motion is continuous across the loop point
  for (let s = 0; s < S; s++) {
    const group = groups[s] as ShotGroup;
    const end = s === S - 1 ? L : start + (durations[s] as number);
    const tStyle = shotTrans.transitions[s];
    const transitionIn =
      s === 0
        ? loop && shotTrans.wrap
          ? { style: shotTrans.wrap, start: L - wrapT, duration: wrapT }
          : null
        : !tStyle
          ? null
          : { style: tStyle, start, duration: transitions[s - 1] as number };
    // The wrap plays at the END of the video, but shot 0's own in-transition still spans [start, 0].
    const tInDuration = s === 0 ? wrapT : (transitionIn?.duration ?? 0);
    const multi = group.photoIndices.length > 1;
    const intensity = multi ? settings.motionIntensity * CELL_MOTION_SCALE : settings.motionIntensity;
    const plan = layoutCells(
      group.layout,
      group.photoIndices.length,
      settings.width,
      settings.height,
      settings.gutter,
      settings.seed,
      group.photoIndices[0] as number,
    );

    // Stagger (§4.7.3): cell 0 present from start; the rest pop in after the transition-in.
    const tInEnd = start + tInDuration;
    const outgoing = s < S - 1 ? (transitions[s] as number) : wrapT;
    const hold = end - outgoing - tInEnd;
    const step = Math.min(STAGGER_STEP_MAX, STAGGER_STEP_FRACTION * hold);
    const revealDur = Math.min(STAGGER_DURATION_MAX, STAGGER_DURATION_FACTOR * step);
    const k = group.photoIndices.length;
    const stagger =
      settings.reveal === 'stagger' &&
      multi &&
      hold > 0 &&
      step > 0 &&
      tInEnd + (k - 2) * step + revealDur <= tInEnd + STAGGER_HOLD_FRACTION * hold + 1e-9;

    const cells: Cell[] = group.photoIndices.map((i, c) => {
      const ov = overrides[(photos[i] as GroupablePhoto).id];
      const focus = {
        x: clamp(ov?.focus?.x ?? 0.5, 0, 1),
        y: clamp(ov?.focus?.y ?? 0.5, 0, 1),
      };
      const motion = motions[i]!;
      const { from, to } = motionTransforms(
        motion,
        intensity,
        focus,
        mulberry32(deriveSeed(settings.seed, 'kenBurns', i)),
      );
      const place = plan.cells[c] ?? plan.cells[0]!;
      return {
        photoIndex: i,
        rect: place.rect,
        rotation: place.rotation,
        border: place.border,
        motion,
        motionFrom: from,
        motionTo: to,
        fit: ov?.fit ?? (multi ? 'cover' : settings.fit),
        focus,
        revealStart: stagger && c > 0 ? tInEnd + (c - 1) * step : start,
        revealDuration: stagger && c > 0 ? revealDur : 0,
      };
    });

    segments.push({
      layout: group.layout,
      cells,
      backdrop: plan.backdropCell === null ? null : (group.photoIndices[plan.backdropCell] ?? null),
      start,
      end,
      transitionIn,
    });
    if (s < S - 1) start = end - (transitions[s] as number);
  }
  return { ok: true, timeline: { duration: L, fps, frameCount: Math.round(L * fps), loop, segments } };
}

/** Cheap summary for UI labels. `transition` is the nominal (unclamped) duration; durations are per shot. */
export function timingSummary(
  photos: readonly GroupablePhoto[],
  settings: MontageSettings,
  overrides: Record<string, PhotoOverrides> = {},
): { transition: number; avgShot: number; minShot: number; shots: number; ok: boolean } {
  const transition = transitionDuration(settings.transitionSpeed);
  if (photos.length === 0) return { transition, avgShot: 0, minShot: 0, shots: 0, ok: false };
  const groups = groupPhotos(photos, overrides, settings);
  const shots = groups.length;
  const w = shotWeights(groups, settings.pacing, settings.seed);
  const loop = settings.loop === true;
  const { durations } = solveTiming(
    w,
    settings.totalDuration,
    new Array<number>(loop ? shots : shots - 1).fill(transition),
    loop,
  );
  const avgShot = durations.reduce((a, b) => a + b, 0) / shots;
  const minShot = Math.min(...durations);
  const ok = minPossibleDuration(w, settings.totalDuration) >= MIN_PHOTO_DURATION - 1e-9;
  return { transition, avgShot, minShot, shots, ok };
}
