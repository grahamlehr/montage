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
];

describe('transitionPrograms', () => {
  it('defines a program for all 11 styles', () => {
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
});
