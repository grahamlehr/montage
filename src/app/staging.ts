import type { MontageSettings } from '../types';

/**
 * Settings changes are staged: the preview and export use the last *applied* settings until Rebuild.
 * `loop` is the exception: it's a playback toggle beside the player, so it always applies at once.
 */
export function effectiveSettings(applied: MontageSettings, current: MontageSettings): MontageSettings {
  return applied.loop === current.loop ? applied : { ...applied, loop: current.loop };
}

/** True when `current` differs from `applied` in anything Rebuild would change. */
export function hasPendingChanges(applied: MontageSettings, current: MontageSettings): boolean {
  if (applied === current) return false;
  for (const key of Object.keys(current) as (keyof MontageSettings)[]) {
    if (key === 'loop') continue;
    const a = applied[key];
    const b = current[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || a.some((v, i) => v !== b[i])) return true;
    } else if (a !== b) return true;
  }
  return false;
}
