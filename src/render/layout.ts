import type { FitMode, Transform } from '../types';

/** Where a photo lands in the output frame: centre + size in output pixels (origin top-left, +y down). */
export interface Placement {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Clamp the centre coordinate of a span of `size` so it fully covers [0, frame] (size >= frame). */
function clampCover(c: number, size: number, frame: number): number {
  return clamp(c, frame - size / 2, size / 2);
}

/**
 * Pure placement math (unit-tested).
 *
 * - cover: fills the frame, cropped around `focus` (focus point of the photo stays at focus*frame when
 *   zooming). tx/ty are added to the centre then CLAMPED so the photo always covers the frame.
 * - contain / blur(foreground): fitted inside the frame, scaled around the frame centre, translated by tx/ty
 *   (fractions of the frame). Not clamped.
 */
export function placePhoto(
  photoW: number,
  photoH: number,
  frameW: number,
  frameH: number,
  fit: FitMode,
  focus: { x: number; y: number },
  t: Transform,
): Placement {
  const scale = Math.max(t.scale, 1e-4);
  if (fit === 'cover') {
    const base = Math.max(frameW / photoW, frameH / photoH);
    const w = photoW * base * Math.max(scale, 1); // never zoom below cover
    const h = photoH * base * Math.max(scale, 1);
    const fx = clamp(focus.x, 0, 1);
    const fy = clamp(focus.y, 0, 1);
    const left = fx * (frameW - w);
    const top = fy * (frameH - h);
    return {
      cx: clampCover(left + w / 2 + t.tx * frameW, w, frameW),
      cy: clampCover(top + h / 2 + t.ty * frameH, h, frameH),
      w,
      h,
    };
  }
  const base = Math.min(frameW / photoW, frameH / photoH);
  return {
    cx: frameW / 2 + t.tx * frameW,
    cy: frameH / 2 + t.ty * frameH,
    w: photoW * base * scale,
    h: photoH * base * scale,
  };
}

/** True if the placement covers the whole frame (used by tests). */
export function coversFrame(p: Placement, frameW: number, frameH: number, eps = 1e-6): boolean {
  return (
    p.cx - p.w / 2 <= eps &&
    p.cx + p.w / 2 >= frameW - eps &&
    p.cy - p.h / 2 <= eps &&
    p.cy + p.h / 2 >= frameH - eps
  );
}

/** Reduced resolution for the cached blurred background. */
export function blurSize(frameW: number, frameH: number, divisor = 4): { w: number; h: number } {
  return { w: Math.max(16, Math.round(frameW / divisor)), h: Math.max(16, Math.round(frameH / divisor)) };
}

/** Parse "#rgb" / "#rrggbb" into 0..1 floats; falls back to black. */
export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
