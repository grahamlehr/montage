import { describe, expect, it } from 'vitest';
import { deriveSeed, int, mulberry32, shuffle } from './rng';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it('differs across seeds and stays in [0,1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let same = 0;
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      if (x === b()) same++;
    }
    expect(same).toBeLessThan(5);
  });
  it('deriveSeed is stable and salt-sensitive', () => {
    expect(deriveSeed(7, 'pacing', 3)).toBe(deriveSeed(7, 'pacing', 3));
    expect(deriveSeed(7, 'pacing', 3)).not.toBe(deriveSeed(7, 'pacing', 4));
  });
  it('int and shuffle stay in range / preserve elements', () => {
    const r = mulberry32(9);
    for (let i = 0; i < 100; i++) expect(int(r, 5)).toBeLessThan(5);
    expect(shuffle(r, [1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
