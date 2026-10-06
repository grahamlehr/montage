import { describe, expect, it } from 'vitest';
import { useMontageStore } from './store';

describe('store aspect lock', () => {
  it('keeps the exact ratio across cap/rounding (repro #23) and follows ratio changes while locked', () => {
    const st = () => useMontageStore.getState();
    st().setSettings({ width: 1920, height: 1080 });
    st().setAspectLocked(true);
    const dims = () => `${st().settings.width}x${st().settings.height}`;
    st().setSettings({ width: 4096 });
    expect(dims()).toBe('4096x2304');
    st().setSettings({ width: 2000 });
    expect(dims()).toBe('2000x1126');
    st().setSettings({ width: 4096 });
    expect(dims()).toBe('4096x2304');
    st().setRatio('1:1');
    st().setSettings({ width: 4096 });
    expect(dims()).toBe('3072x3072');
    st().setSettings({ width: 2000 });
    expect(dims()).toBe('2000x2000');
    st().applyPreset({ width: 1080, height: 1350 });
    st().setSettings({ height: 2700 });
    expect(dims()).toBe('2160x2700');
    st().setAspectLocked(false);
    expect(st().lockedRatio).toBeNull();
  });
});
