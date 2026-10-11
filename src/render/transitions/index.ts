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

/** Deterministic GPU hash (no randomness): same inputs -> same value on every frame and every run. */
const HASH = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

const whip: TransitionProgramSpec = {
  // Push (incoming from the right) with an extra ease and a 12-tap motion blur along the travel axis.
  // The blur length follows sin(pi p), so it peaks mid-transition and vanishes at both ends.
  fragment: `
const int TAPS = 12;
const float MAX_BLUR = 0.22; // fraction of frame width
vec4 strip(float s, float y) { return s < 1.0 ? texFrom(vec2(s, y)) : texTo(vec2(s - 1.0, y)); }
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  float pos = p * p * (3.0 - 2.0 * p);
  float len = MAX_BLUR * sin(3.14159265 * p);
  float s0 = uv.x + pos; // 0..1 = from, 1..2 = to
  vec4 acc = vec4(0.0);
  for (int i = 0; i < TAPS; i++) {
    float t = float(i) / float(TAPS - 1) - 0.5;
    acc += strip(clamp(s0 + t * len, 0.0, 2.0), uv.y);
  }
  return acc / float(TAPS);
}`,
};

const zoomPunch: TransitionProgramSpec = {
  // Radial zoom blur toward the centre: outgoing punches in and smears, incoming settles from zoomed-in.
  fragment: `
const int TAPS = 12;
vec2 zoomAt(vec2 uv, float s) { return (uv - 0.5) / s + 0.5; }
vec4 radial(vec2 uv, float strength, bool isFrom) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < TAPS; i++) {
    float k = 1.0 - strength * float(i) / float(TAPS - 1);
    vec2 q = 0.5 + (uv - 0.5) * k;
    acc += isFrom ? texFrom(q) : texTo(q);
  }
  return acc / float(TAPS);
}
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  float strength = 0.35 * sin(3.14159265 * p);
  float m = smoothstep(0.4, 0.6, p);
  vec4 a = m < 1.0 ? radial(zoomAt(uv, 1.0 + 1.2 * p * p), strength, true) : vec4(0.0);
  vec4 b = m > 0.0 ? radial(zoomAt(uv, 1.0 + 0.6 * (1.0 - p) * (1.0 - p)), strength, false) : vec4(0.0);
  return mix(a, b, m);
}`,
};

const flash: TransitionProgramSpec = {
  // Dip to white: pure white at p = 0.5, photo swaps there.
  fragment: `
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  float w = 1.0 - abs(2.0 * p - 1.0);
  w = w * w * (3.0 - 2.0 * w);
  return mix(p < 0.5 ? texFrom(uv) : texTo(uv), vec4(1.0), w);
}`,
};

const lightLeak: TransitionProgramSpec = {
  // Procedural warm film-burn sweep (in the spirit of gl-transitions "FilmBurn", MIT; own implementation).
  // A diagonal band of orange/amber light sweeps left -> right, added on top of a soft crossfade.
  fragment: `${HASH}
float vnoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  float aspect = uRes.x / uRes.y;
  vec2 a = vec2(uv.x * aspect, uv.y);
  float centre = mix(-0.6, aspect + 0.6, p);
  float wobble = 0.25 * (vnoise(vec2(uv.y * 3.0, p * 2.0)) - 0.5);
  float d = a.x - centre + 0.35 * (uv.y - 0.5) + wobble;
  float band = exp(-d * d / 0.18);
  float grain = 0.75 + 0.5 * vnoise(a * 4.0 + vec2(p * 3.0, 0.0));
  float intensity = sin(3.14159265 * p);
  vec3 hot = vec3(1.0, 0.85, 0.55);
  vec3 warm = vec3(1.0, 0.38, 0.08);
  vec3 leak = mix(warm, hot, band) * band * grain * intensity * 1.4;
  vec4 base = mix(texFrom(uv), texTo(uv), smoothstep(0.25, 0.75, p));
  return vec4(clamp(base.rgb + leak, 0.0, 1.0), 1.0);
}`,
};

const glitch: TransitionProgramSpec = {
  // RGB split + coarse horizontal block displacement. Noise = hash of (block row, quantised progress),
  // so it is deterministic and only changes ~14 times per transition (keeps H.264 bitrate sane).
  fragment: `${HASH}
const float STEPS = 14.0;
vec4 pick(vec2 uv, bool useTo) { return useTo ? texTo(uv) : texFrom(uv); }
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  float q = floor(p * STEPS);
  float amp = sin(3.14159265 * p);
  float rows = 6.0 + floor(hash12(vec2(q, 7.0)) * 10.0);
  float row = floor(uv.y * rows);
  float h = hash12(vec2(row, q));
  float shift = h > 0.55 ? (hash12(vec2(row + 31.0, q)) - 0.5) * 0.25 * amp : 0.0;
  bool useTo = hash12(vec2(row + 97.0, q)) < smoothstep(0.25, 0.75, p);
  vec2 d = vec2(uv.x + shift, uv.y);
  float split = 0.025 * amp * (0.5 + h);
  float r = pick(d + vec2(split, 0.0), useTo).r;
  float g = pick(d, useTo).g;
  float b = pick(d - vec2(split, 0.0), useTo).b;
  return vec4(r, g, b, 1.0);
}`,
};

const iris: TransitionProgramSpec = {
  // Soft-edged circle opening from the centre; distance is aspect-correct (pixels) and normalised so
  // radius 1 reaches the frame corners.
  fragment: `
const float FEATHER = 0.05;
vec4 transition(vec2 uv, float p) {
  if (p <= 0.0) return texFrom(uv);
  if (p >= 1.0) return texTo(uv);
  float d = length((uv - 0.5) * uRes) / (0.5 * length(uRes));
  float r = p * (1.0 + FEATHER);
  float m = 1.0 - smoothstep(r - FEATHER, r, d);
  return mix(texFrom(uv), texTo(uv), m);
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
  whip,
  zoomPunch,
  flash,
  lightLeak,
  glitch,
  iris,
};
