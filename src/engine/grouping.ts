import { DEFAULT_SETTINGS, LAYOUT_CAPACITY, MAX_CELLS, MIXED_GROUP_PROBABILITY } from '../lib/constants';
import { deriveSeed, mulberry32 } from '../lib/rng';
import type { LayoutStyle, MontageSettings, MultiLayout, PhotoOverrides, PhotoSource } from '../types';

export type GroupablePhoto = Pick<PhotoSource, 'id' | 'naturalWidth' | 'naturalHeight'>;
export type GroupingSettings = Pick<
  MontageSettings,
  'width' | 'height' | 'grouping' | 'layoutPool' | 'selection' | 'seed'
>;

export interface ShotGroup {
  layout: LayoutStyle;
  photoIndices: number[];
}

/** Portrait photo in landscape output, or landscape photo in portrait output (§4.7.1). */
export function isMismatched(
  photo: Pick<PhotoSource, 'naturalWidth' | 'naturalHeight'>,
  width: number,
  height: number,
): boolean {
  if (!(height > 0) || !(photo.naturalHeight > 0)) return false;
  const outA = width / height;
  const photoA = photo.naturalWidth / photo.naturalHeight;
  return (outA >= 1.2 && photoA <= 0.85) || (outA <= 0.83 && photoA >= 1.18);
}

const BY_COUNT: Record<number, LayoutStyle> = { 1: 'single', 2: 'duo', 3: 'trio', 4: 'quad' };

/** Photos a layout takes when `available` photos are free (polaroid shrinks to 2). 0 = doesn't fit. */
function capacityFor(layout: MultiLayout, available: number): number {
  const cap = LAYOUT_CAPACITY[layout];
  if (available >= cap) return cap;
  if (layout === 'polaroid' && available >= 2) return 2;
  return 0;
}

/**
 * Split photos (in order) into shots (§4.7.1). Pure and cheap; never reorders.
 * `grouping: 'off'` always yields one `single` shot per photo (group overrides are ignored).
 */
export function groupPhotos(
  photos: readonly GroupablePhoto[],
  overrides: Record<string, PhotoOverrides>,
  settings: GroupingSettings,
): ShotGroup[] {
  const n = photos.length;
  const out: ShotGroup[] = [];
  if (settings.grouping === 'off') {
    for (let i = 0; i < n; i++) out.push({ layout: 'single', photoIndices: [i] });
    return out;
  }
  const group = (i: number): PhotoOverrides['group'] => {
    const p = photos[i];
    return p ? overrides[p.id]?.group : undefined;
  };
  const mismatched = photos.map((p) => isMismatched(p, settings.width, settings.height));
  const pool = Array.from(
    new Set(settings.layoutPool.length ? settings.layoutPool : DEFAULT_SETTINGS.layoutPool),
  );
  let mixedCount = 0;
  let prevMixed: MultiLayout | undefined;

  let i = 0;
  while (i < n) {
    const g = group(i);
    // 1. solo
    if (g === 'solo') {
      out.push({ layout: 'single', photoIndices: [i] });
      i++;
      continue;
    }
    // 2. joinNext chain: up to MAX_CELLS photos, stopping before a solo photo.
    if (g === 'joinNext') {
      const members = [i];
      let j = i;
      while (members.length < MAX_CELLS && group(j) === 'joinNext' && j + 1 < n && group(j + 1) !== 'solo') {
        j++;
        members.push(j);
      }
      out.push({ layout: BY_COUNT[members.length] as LayoutStyle, photoIndices: members });
      i = j + 1;
      continue;
    }
    // 3. auto pairing of two consecutive mismatched photos (the second must be free to join).
    if (i + 1 < n && mismatched[i] && mismatched[i + 1] && group(i + 1) === undefined) {
      out.push({ layout: 'duo', photoIndices: [i, i + 1] });
      i += 2;
      continue;
    }
    // 4. mixed: seeded multi-photo shot; first and last photo stay solo.
    if (settings.grouping === 'mixed' && i > 0 && i < n - 1) {
      const rng = mulberry32(deriveSeed(settings.seed, 'grouping', i));
      if (rng() < MIXED_GROUP_PROBABILITY) {
        let available = 1;
        while (available < MAX_CELLS && i + available < n - 1 && group(i + available) === undefined)
          available++;
        let layout: MultiLayout;
        if (settings.selection === 'sequence') {
          layout = pool[mixedCount % pool.length] as MultiLayout;
        } else {
          const candidates = pool.length > 1 ? pool.filter((l) => l !== prevMixed) : pool;
          layout = candidates[Math.floor(rng() * candidates.length)] as MultiLayout;
        }
        let take = capacityFor(layout, available);
        if (take === 0) {
          // Largest layout from the pool that fits (pool order breaks ties), avoiding a repeat when possible.
          const nonRepeat = pool.length > 1 ? pool.filter((l) => l !== prevMixed) : pool;
          for (const options of [nonRepeat, pool]) {
            for (const l of options) {
              const c = capacityFor(l, available);
              if (c > take) {
                take = c;
                layout = l;
              }
            }
            if (take > 0) break;
          }
        }
        if (take >= 2) {
          const members = Array.from({ length: take }, (_, k) => i + k);
          out.push({ layout, photoIndices: members });
          mixedCount++;
          prevMixed = layout;
          i += take;
          continue;
        }
      }
    }
    // 5. single
    out.push({ layout: 'single', photoIndices: [i] });
    i++;
  }
  return out;
}
