import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants';
import { effectiveSettings, hasPendingChanges } from './staging';

describe('staged settings', () => {
  const base = { ...DEFAULT_SETTINGS };

  it('identical settings have no pending changes', () => {
    expect(hasPendingChanges(base, base)).toBe(false);
    expect(hasPendingChanges(base, { ...base, motionPool: [...base.motionPool] })).toBe(false);
  });

  it('scalar and pool edits are pending', () => {
    expect(hasPendingChanges(base, { ...base, width: base.width + 2 })).toBe(true);
    expect(hasPendingChanges(base, { ...base, seed: base.seed + 1 })).toBe(true);
    expect(hasPendingChanges(base, { ...base, transitionPool: base.transitionPool.slice(1) })).toBe(true);
  });

  it('loop applies immediately and never counts as pending', () => {
    const toggled = { ...base, loop: !base.loop };
    expect(hasPendingChanges(base, toggled)).toBe(false);
    expect(effectiveSettings(base, toggled).loop).toBe(toggled.loop);
    expect(effectiveSettings(base, base)).toBe(base);
  });
});
