/**
 * Seeded PRNG (mulberry32). The only source of randomness allowed in src/engine and src/render.
 * Same seed ⇒ same sequence, on every platform.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent stream from a base seed and a salt (e.g. photo index, purpose tag). */
export function deriveSeed(seed: number, ...salt: Array<number | string>): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const s of salt) {
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x85ebca6b);
      h ^= h >>> 13;
    }
    h = Math.imul(h ^ 0x2c, 0xc2b2ae35) >>> 0;
  }
  h ^= h >>> 16;
  return h >>> 0;
}

/** Float in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Integer in [0, n). */
export function int(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() on empty array');
  return items[int(rng, items.length)] as T;
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(rng, i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** A fresh random seed for the UI "Randomise" button. Not for use in engine/render. */
export function newSeed(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0] ?? 1) >>> 0;
}
