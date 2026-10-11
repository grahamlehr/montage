import type { MontageSettings, PhotoOverrides } from '../types';

/** Configs whose loop=false output is pinned in golden-noloop.json (captured before #25). */
export const GOLDEN_CONFIGS: Array<{ n: number; s?: Partial<MontageSettings>; ov?: Record<string, PhotoOverrides> }> = [
  { n: 1 },
  { n: 2, s: { totalDuration: 6 } },
  { n: 5, s: { pacing: 0.7, seed: 42, transitionPool: ['crossfade', 'slideLeft', 'zoom'] } },
  { n: 8, s: { totalDuration: 20, selection: 'random', seed: 7, transitionPool: ['wipe', 'push', 'blur', 'dipToBlack'], motionPool: ['kenBurns', 'zoomIn', 'panLeft'] } },
  { n: 12, s: { totalDuration: 12, transitionSpeed: 0, pacing: 1, transitionPool: ['cut', 'crossfade'] }, ov: { p3: { transitionIn: 'cut' }, p4: { motion: 'panUp' } } },
];
