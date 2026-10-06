import { MAX_PAN, MAX_ZOOM_DELTA } from '../lib/constants';
import { mulberry32, type Rng } from '../lib/rng';
import type { MotionStyle, Transform } from '../types';
import { clamp, lerp } from './easing';

const z = (n: number): number => n + 0; // normalise -0 to 0

function tf(scale: number, tx: number, ty: number): Transform {
  return { scale, tx: z(tx), ty: z(ty) };
}

export function zoomDelta(intensity: number): number {
  return lerp(0, MAX_ZOOM_DELTA, clamp(intensity, 0, 1));
}
export function panTravel(intensity: number): number {
  return lerp(0, MAX_PAN, clamp(intensity, 0, 1));
}

/**
 * Start/end transforms for a motion style (§4.2). scale 1 = fitted, tx/ty = fractions of the output
 * frame (+x right, +y down). Pans use a base zoom of 1 + travel so cover crops have room to move.
 * `rng` is only consumed by kenBurns (pass a stream derived per photo).
 */
export function motionTransforms(
  motion: MotionStyle,
  intensity: number,
  focus: { x: number; y: number },
  rng: Rng = mulberry32(1),
): { from: Transform; to: Transform } {
  const zd = zoomDelta(intensity);
  const pan = panTravel(intensity);
  const h = pan / 2;
  const base = 1 + pan;
  switch (motion) {
    case 'none':
      return { from: tf(1, 0, 0), to: tf(1, 0, 0) };
    case 'zoomIn':
      return { from: tf(1, 0, 0), to: tf(1 + zd, 0, 0) };
    case 'zoomOut':
      return { from: tf(1 + zd, 0, 0), to: tf(1, 0, 0) };
    case 'panLeft':
      return { from: tf(base, h, 0), to: tf(base, -h, 0) };
    case 'panRight':
      return { from: tf(base, -h, 0), to: tf(base, h, 0) };
    case 'panUp':
      return { from: tf(base, 0, h), to: tf(base, 0, -h) };
    case 'panDown':
      return { from: tf(base, 0, -h), to: tf(base, 0, h) };
    case 'kenBurns': {
      // Draw everything up front so the stream consumption is constant.
      const zoomIn = rng() < 0.5;
      const toward = rng() < 0.5;
      const angle = rng() * 2 * Math.PI;
      let ux = 0.5 - focus.x;
      let uy = 0.5 - focus.y;
      const len = Math.hypot(ux, uy);
      if (len < 0.05) {
        ux = Math.cos(angle);
        uy = Math.sin(angle);
      } else {
        ux /= len;
        uy /= len;
      }
      const sign = toward ? 1 : -1; // toward: content drifts so the focus point nears the centre
      const lo = base;
      const hi = 1 + Math.max(zd, pan);
      const a = tf(zoomIn ? lo : hi, -sign * ux * h, -sign * uy * h);
      const b = tf(zoomIn ? hi : lo, sign * ux * h, sign * uy * h);
      return { from: a, to: b };
    }
  }
}
