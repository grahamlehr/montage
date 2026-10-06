/** Cubic ease-in-out on [0, 1]; input is clamped. */
export function easeInOut(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
