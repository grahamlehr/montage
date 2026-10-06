import type { TransitionStyle } from '../../types';
import type { TransitionProgramSpec } from '../transitionSpec';

/**
 * All transition programs (T5). Every program is exactly pure `from` at progress 0 and pure `to` at
 * progress 1 (explicit early-outs, no residual blur/offset). Spec: ../transitionSpec.ts.
 * Direction convention: slideLeft = the incoming photo enters from the right, moving left, over the
 * outgoing photo, which stays put. slideRight/Up/Down mirror that.
 */

/** Incoming layer slides over a static outgoing layer. `dir` = direction of travel of the incoming layer. */
function slide(dir: [number, number]): TransitionProgramSpec {
  return {
    fragment: `
const vec2 DIR = vec2(${dir[0].toFixed(1)}, ${dir[1].toFixed(1)});
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  // The incoming layer starts one frame away (opposite DIR) and travels along DIR.
  vec2 q = uv + DIR * (1.0 - p);
  if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
    return texTo(q);
  }
  return texFrom(uv);
}`,
  };
}

const dipToBlack: TransitionProgramSpec = {
  fragment: `
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  return p < 0.5 ? texFrom(uv) * (1.0 - p * 2.0) : texTo(uv) * ((p - 0.5) * 2.0);
}`,
};

const push: TransitionProgramSpec = {
  // New photo enters from the right pushing the old one out to the left.
  fragment: `
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  float edge = 1.0 - p;
  return uv.x < edge ? texFrom(vec2(uv.x + p, uv.y)) : texTo(vec2(uv.x - edge, uv.y));
}`,
};

const wipe: TransitionProgramSpec = {
  // Left -> right with a small soft feather.
  fragment: `
const float FEATHER = 0.04;
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  float e = p * (1.0 + FEATHER);
  float m = 1.0 - smoothstep(e - FEATHER, e, uv.x);
  return mix(texFrom(uv), texTo(uv), m);
}`,
};

const zoom: TransitionProgramSpec = {
  // Outgoing zooms in while fading out; incoming settles from slightly zoomed.
  fragment: `
vec2 zoomAt(vec2 uv, float s) { return (uv - 0.5) / s + 0.5; }
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  vec4 a = texFrom(zoomAt(uv, 1.0 + 0.35 * p));
  vec4 b = texTo(zoomAt(uv, 1.0 + 0.15 * (1.0 - p)));
  return mix(a, b, smoothstep(0.0, 1.0, p));
}`,
};

const blur: TransitionProgramSpec = {
  // Vogel-disk blur, radius scaled by sin(pi p); outgoing blurs out while incoming blurs in.
  fragment: `
const int TAPS = 16;
const float MAX_RADIUS = 0.03; // fraction of the larger frame side
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  float rpx = MAX_RADIUS * max(uRes.x, uRes.y) * sin(3.14159265 * p);
  if (rpx < 0.25) return mix(texFrom(uv), texTo(uv), p);
  vec2 stepUv = vec2(rpx) / uRes;
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  vec4 a = vec4(0.0);
  vec4 b = vec4(0.0);
  for (int i = 0; i < TAPS; i++) {
    float f = (float(i) + 0.5) / float(TAPS);
    float r = sqrt(f);
    float ang = float(i) * 2.39996323 + rot;
    vec2 o = vec2(cos(ang), sin(ang)) * r * stepUv;
    a += texFrom(clamp(uv + o, 0.0, 1.0));
    b += texTo(clamp(uv + o, 0.0, 1.0));
  }
  return mix(a, b, p) / float(TAPS);
}`,
};

export const transitionPrograms: Record<TransitionStyle, TransitionProgramSpec | undefined> = {
  cut: { fragment: `vec4 transition(vec2 uv, float p) { return p < 0.5 ? texFrom(uv) : texTo(uv); }` },
  crossfade: { fragment: `vec4 transition(vec2 uv, float p) { return mix(texFrom(uv), texTo(uv), p); }` },
  dipToBlack,
  slideLeft: slide([-1, 0]),
  slideRight: slide([1, 0]),
  slideUp: slide([0, -1]),
  slideDown: slide([0, 1]),
  push,
  wipe,
  zoom,
  blur,
};
