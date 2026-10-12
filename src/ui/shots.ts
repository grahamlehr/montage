import { useMemo } from 'react';
import { groupPhotos } from '../engine';
import { shotMembership } from './logic';
import type { ShotMembership } from './logic';
import type { PhotoItem } from './types';
import { useMontageStore } from './store';

/** A photo's shot membership plus the tray indices of its shot's first and last photo. */
export interface TrayShot extends ShotMembership {
  firstIndex: number;
  lastIndex: number;
}

/**
 * Groups only the `ready` photos, exactly like the app's timeline (loading / failed photos are not in the
 * video), and maps the result back onto tray indices. Entry i describes tray photo i; undefined when that
 * photo isn't ready.
 */
export function trayShots(
  photos: readonly PhotoItem[],
  overrides: Parameters<typeof groupPhotos>[1],
  settings: Parameters<typeof groupPhotos>[2],
): Array<TrayShot | undefined> {
  const trayIndex: number[] = [];
  photos.forEach((p, i) => {
    if (p.status === 'ready') trayIndex.push(i);
  });
  const sources = trayIndex.map((i) => (photos[i] as PhotoItem).source);
  const membership = shotMembership(groupPhotos(sources, overrides, settings), sources.length);
  const out: Array<TrayShot | undefined> = new Array<TrayShot | undefined>(photos.length).fill(undefined);
  membership.forEach((m, r) => {
    const first = trayIndex[r - m.position] as number;
    const last = trayIndex[r - m.position + m.size - 1] as number;
    out[trayIndex[r] as number] = { ...m, firstIndex: first, lastIndex: last };
  });
  return out;
}

/** How the current ready photos group into shots (per `groupPhotos()`); entry i describes tray photo i. */
export function useShots(): Array<TrayShot | undefined> {
  const photos = useMontageStore((s) => s.photos);
  const overrides = useMontageStore((s) => s.overrides);
  const settings = useMontageStore((s) => s.settings);
  return useMemo(() => trayShots(photos, overrides, settings), [photos, overrides, settings]);
}
