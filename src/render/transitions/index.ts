import type { TransitionStyle } from '../../types';
import type { TransitionProgramSpec } from '../transitionSpec';

/**
 * STUB (T3). T5 owns this directory: add a `TransitionProgramSpec` per style here.
 * See ../transitionSpec.ts for the plug-in contract. Missing styles fall back to `crossfade`.
 */
export const transitionPrograms: Record<TransitionStyle, TransitionProgramSpec | undefined> = {
  cut: { fragment: `vec4 transition(vec2 uv, float p) { return p < 0.5 ? texFrom(uv) : texTo(uv); }` },
  crossfade: { fragment: `vec4 transition(vec2 uv, float p) { return mix(texFrom(uv), texTo(uv), p); }` },
  dipToBlack: undefined,
  slideLeft: undefined,
  slideRight: undefined,
  slideUp: undefined,
  slideDown: undefined,
  push: undefined,
  wipe: undefined,
  zoom: undefined,
  blur: undefined,
};
