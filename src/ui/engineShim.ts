// TODO(T12-merge): delete, import from ../engine
// Temporary stand-in for the T12 engine API (docs/proposals/multi-photo-shots.md §2, §4.7.1) so the UI can be
// built and tested before the engine lands. All UI code imports groupPhotos/timingSummary through this module only;
// after T12 merges, replace this file's body with:
//   export { groupPhotos, timingSummary } from '../engine';
// Simplifications vs the real engine: `mixed` behaves like `auto` (no seeded layoutPool shots), and timing is an
// even split per shot (no pacing / shot weights).
import { MAX_CELLS } from '../lib/constants';
import type { LayoutStyle, MontageSettings, PhotoOverrides, PhotoSource } from '../types';
import { estimateTiming } from './logic';

type PhotoDims = Pick<PhotoSource, 'id' | 'naturalWidth' | 'naturalHeight'>;

const LAYOUT_FOR_COUNT: Record<number, LayoutStyle> = { 1: 'single', 2: 'duo', 3: 'trio', 4: 'quad' };

/** §4.7.1: a photo whose orientation fights the output (square-ish output never counts). */
function mismatched(p: PhotoDims, s: MontageSettings): boolean {
  const outA = s.width / s.height;
  const photoA = p.naturalWidth / Math.max(1, p.naturalHeight);
  return (outA >= 1.2 && photoA <= 0.85) || (outA <= 0.83 && photoA >= 1.18);
}

export function groupPhotos(
  photos: ReadonlyArray<PhotoDims>,
  overrides: Record<string, PhotoOverrides>,
  settings: MontageSettings,
): { layout: LayoutStyle; photoIndices: number[] }[] {
  const n = photos.length;
  if (settings.grouping === 'off') return photos.map((_, i) => ({ layout: 'single', photoIndices: [i] }));
  const group = (i: number) => {
    const p = photos[i];
    return p ? overrides[p.id]?.group : undefined;
  };
  const out: { layout: LayoutStyle; photoIndices: number[] }[] = [];
  let i = 0;
  while (i < n) {
    if (group(i) === 'joinNext') {
      const idx = [i];
      let j = i;
      while (group(j) === 'joinNext' && j + 1 < n && group(j + 1) !== 'solo' && idx.length < MAX_CELLS) idx.push(++j);
      out.push({ layout: LAYOUT_FOR_COUNT[idx.length] ?? 'single', photoIndices: idx });
      i = j + 1;
      continue;
    }
    const a = photos[i];
    const b = photos[i + 1];
    if (group(i) !== 'solo' && a && b && group(i + 1) !== 'solo' && mismatched(a, settings) && mismatched(b, settings)) {
      out.push({ layout: 'duo', photoIndices: [i, i + 1] });
      i += 2;
      continue;
    }
    out.push({ layout: 'single', photoIndices: [i] });
    i += 1;
  }
  return out;
}

export interface TimingSummary {
  transition: number;
  avgShot: number;
  minShot: number;
  shots: number;
  ok: boolean;
}

export function timingSummary(photos: ReadonlyArray<PhotoDims>, settings: MontageSettings): TimingSummary {
  if (photos.length === 0) return { ...estimateTiming(settings, 0), ok: false };
  return estimateTiming(settings, groupPhotos(photos, {}, settings).length);
}
