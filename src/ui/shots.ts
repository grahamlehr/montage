import { useMemo } from 'react';
import { groupPhotos } from './engineShim';
import { shotMembership } from './logic';
import type { ShotMembership } from './logic';
import { useMontageStore } from './store';

/** How the current photos group into shots (per `groupPhotos()`); entry i describes photo i. */
export function useShots(): ShotMembership[] {
  const photos = useMontageStore((s) => s.photos);
  const overrides = useMontageStore((s) => s.overrides);
  const settings = useMontageStore((s) => s.settings);
  return useMemo(() => {
    const sources = photos.map((p) => p.source);
    return shotMembership(groupPhotos(sources, overrides, settings), sources.length);
  }, [photos, overrides, settings]);
}
