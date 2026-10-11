import { describe, expect, it } from 'vitest';
import type { TransitionStyle } from '../../types';
import { transitionPrograms } from './index';

const ALL: TransitionStyle[] = [
  'cut',
  'crossfade',
  'dipToBlack',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'push',
  'wipe',
  'zoom',
  'blur',
  'whip',
  'zoomPunch',
  'flash',
  'lightLeak',
  'glitch',
  'iris',
];

describe('transitionPrograms', () => {
  it('defines a program for all 17 styles', () => {
    expect(Object.keys(transitionPrograms).sort()).toEqual([...ALL].sort());
    for (const s of ALL) expect(transitionPrograms[s], s).toBeDefined();
  });

  it('every fragment defines transition(vec2, float) and does not redeclare header symbols', () => {
    for (const s of ALL) {
      const f = transitionPrograms[s]!.fragment;
      expect(f, s).toMatch(/vec4\s+transition\s*\(\s*vec2\s+\w+\s*,\s*float\s+\w+\s*\)/);
      expect(f, s).not.toMatch(/#version|uniform\s+sampler2D|\bout\s+vec4/);
    }
  });

  it('every non-cut program early-outs to pure from at 0 and pure to at 1 (or is an exact mix)', () => {
    for (const s of ALL) {
      if (s === 'cut' || s === 'crossfade') continue;
      const f = transitionPrograms[s]!.fragment;
      expect(f, s).toMatch(/p\s*<=\s*0\.0\)\s*return texFrom\(uv\)/);
      expect(f, s).toMatch(/p\s*>=\s*1\.0\)\s*return texTo\(uv\)/);
    }
  });

  it('slide directions: incoming layer travels along DIR', () => {
    expect(transitionPrograms.slideLeft!.fragment).toContain('vec2(-1.0, 0.0)');
    expect(transitionPrograms.slideRight!.fragment).toContain('vec2(1.0, 0.0)');
    expect(transitionPrograms.slideUp!.fragment).toContain('vec2(0.0, -1.0)');
    expect(transitionPrograms.slideDown!.fragment).toContain('vec2(0.0, 1.0)');
  });

  it('new styles: whip blurs with 12 taps, iris is aspect-correct, flash peaks at white', () => {
    expect(transitionPrograms.whip!.fragment).toMatch(/TAPS = 12/);
    expect(transitionPrograms.whip!.fragment).toMatch(/sin\(3\.14159265 \* p\)/);
    expect(transitionPrograms.zoomPunch!.fragment).toMatch(/TAPS = 12/);
    expect(transitionPrograms.iris!.fragment).toContain('uRes');
    expect(transitionPrograms.flash!.fragment).toContain('vec4(1.0)');
  });

  it('procedural styles are deterministic: noise is a hash of uv/quantised progress, no time input', () => {
    for (const s of ['glitch', 'lightLeak'] as const) {
      const f = transitionPrograms[s]!.fragment;
      expect(f, s).toContain('float hash12(vec2 p)');
      expect(f, s).not.toMatch(/uTime|gl_FragCoord|uniform\s/);
    }
    expect(transitionPrograms.glitch!.fragment).toMatch(/floor\(p \* STEPS\)/);
  });
});
