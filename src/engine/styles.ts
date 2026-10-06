import { DEFAULT_SETTINGS } from '../lib/constants';
import { deriveSeed, mulberry32 } from '../lib/rng';
import type { MontageSettings, MotionStyle, PhotoOverrides, PhotoSource, TransitionStyle } from '../types';

export interface ResolvedStyles {
  motions: MotionStyle[];
  /** Transition INTO photo i; index 0 is always null. */
  transitions: Array<TransitionStyle | null>;
}

function dedupe<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

/**
 * Choose a style per photo. Overrides win over pools. `sequence`: motion i → pool[i % len],
 * transition into photo i → pool[(i-1) % len]. `random`: seeded pick from a stream derived per
 * purpose + photo index, never repeating the previous resolved style when the pool has >1 entry.
 */
export function resolveStyles(
  photos: ReadonlyArray<Pick<PhotoSource, 'id'>>,
  overrides: Record<string, PhotoOverrides>,
  settings: Pick<MontageSettings, 'motionPool' | 'transitionPool' | 'selection' | 'seed'>,
): ResolvedStyles {
  const motionPool = dedupe(settings.motionPool.length ? settings.motionPool : DEFAULT_SETTINGS.motionPool);
  const transPool = dedupe(
    settings.transitionPool.length ? settings.transitionPool : DEFAULT_SETTINGS.transitionPool,
  );
  const motions: MotionStyle[] = [];
  const transitions: Array<TransitionStyle | null> = [];
  photos.forEach((photo, i) => {
    const ov = overrides[photo.id];
    motions.push(
      ov?.motion ?? choose(motionPool, i, i, motions[i - 1], settings, 'motion'),
    );
    transitions.push(
      i === 0 ? null : (ov?.transitionIn ?? choose(transPool, i - 1, i, transitions[i - 1] ?? undefined, settings, 'transition')),
    );
  });
  return { motions, transitions };
}

function choose<T extends string>(
  pool: readonly T[],
  seqIndex: number,
  photoIndex: number,
  previous: T | undefined,
  settings: Pick<MontageSettings, 'selection' | 'seed'>,
  purpose: string,
): T {
  if (settings.selection === 'sequence') return pool[seqIndex % pool.length] as T;
  const candidates = pool.length > 1 ? pool.filter((s) => s !== previous) : pool;
  const rng = mulberry32(deriveSeed(settings.seed, purpose, photoIndex));
  return candidates[Math.floor(rng() * candidates.length)] as T;
}
