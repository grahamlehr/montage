import type { CellBorder, FitMode, Rect, Transform } from '../types';

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

/**
 * Placement of the blurred backdrop (a frame-sized, cover-at-scale-1 image) for `blur` fit. It follows the
 * layer's transform like a cover photo: zoom about `focus`, translate by tx/ty, clamped so it always covers
 * the frame (never reveals the background colour).
 */
export function backdropPlacement(
  frameW: number,
  frameH: number,
  focus: { x: number; y: number },
  t: Transform,
): Placement {
  return placePhoto(frameW, frameH, frameW, frameH, 'cover', focus, t);
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

// ---------------------------------------------------------------------------------------------------------
// Multi-photo shots (PLAN.md §4.10 / proposal §4.7.5): cell geometry for the composite pass.

/** Integer pixel rectangle, origin top-left. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The parts of a CellLayer that decide where and how it is composited. */
export interface CellPlacementInput {
  rect: Rect;
  rotation: number;
  border: CellBorder;
  reveal: number;
}

/** Polaroid frame: side/top border and bottom border as fractions of the card's short side. */
export const POLAROID_SIDE = 0.04;
export const POLAROID_BOTTOM = 0.14;
/** Drop shadow of a polaroid card, as fractions of the card's short side. */
export const SHADOW_BLUR = 0.045;
export const SHADOW_OFFSET = 0.018;
export const SHADOW_OPACITY = 0.45;
/** Reveal animation (renderer-defined): y offset at r=0 as a fraction of cell height, scale at r=0, extra polaroid tilt. */
export const REVEAL_OFFSET = 0.06;
export const REVEAL_SCALE = 0.96;
export const REVEAL_TILT = 0.12;

/** Snap a fractional rect to whole output pixels (edges rounded independently so neighbours tile exactly). */
export function cellPixelRect(rect: Rect, frameW: number, frameH: number): PixelRect {
  const x0 = Math.round(clamp(rect.x, 0, 1) * frameW);
  const y0 = Math.round(clamp(rect.y, 0, 1) * frameH);
  const x1 = Math.round(clamp(rect.x + rect.w, 0, 1) * frameW);
  const y1 = Math.round(clamp(rect.y + rect.h, 0, 1) * frameH);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * True for a cell that covers the whole frame unrotated, unbordered and fully revealed: the renderer draws it
 * with the v1 single-layer code, which is what keeps `grouping: 'off'` output identical to v1.
 */
export function isFullFrameCell(c: CellPlacementInput): boolean {
  return (
    c.rect.x === 0 &&
    c.rect.y === 0 &&
    c.rect.w === 1 &&
    c.rect.h === 1 &&
    c.rotation === 0 &&
    c.border === 'none' &&
    c.reveal >= 1
  );
}

/**
 * Everything the composite pass needs, in output pixels (origin top-left, +y down). The card is the cell
 * rect (for a polaroid the white frame is inside the rect); the photo area is the card minus the border.
 * Local coordinates are relative to the card centre, unrotated and already scaled by the reveal.
 */
export interface CellGeometry {
  /** Card centre in the output frame, after the reveal's y offset. */
  cx: number;
  cy: number;
  /** Half extents of the card (reveal scale applied). */
  cardHalfW: number;
  cardHalfH: number;
  /** Centre offset and half extents of the photo area inside the card (local, reveal scale applied). */
  photoOffX: number;
  photoOffY: number;
  photoHalfW: number;
  photoHalfH: number;
  /** Pixel size the cell content is rendered at (unscaled photo area, whole pixels). */
  contentW: number;
  contentH: number;
  /** Radians, positive = clockwise on screen (y down). */
  rotation: number;
  alpha: number;
  /** Drop shadow (0 opacity = none), in pixels. */
  shadowBlur: number;
  shadowOffset: number;
  shadowOpacity: number;
  /** Half extents of the quad that must be rasterised (card + shadow reach + 1px for anti-aliasing). */
  quadHalfW: number;
  quadHalfH: number;
}

export function cellGeometry(c: CellPlacementInput, frameW: number, frameH: number): CellGeometry {
  const px = cellPixelRect(c.rect, frameW, frameH);
  const r = clamp(c.reveal, 0, 1);
  const s = REVEAL_SCALE + (1 - REVEAL_SCALE) * r;
  const polaroid = c.border === 'polaroid';
  const short = Math.min(px.w, px.h);
  const side = polaroid ? POLAROID_SIDE * short : 0;
  const bottom = polaroid ? POLAROID_BOTTOM * short : 0;
  const contentW = Math.max(1, Math.round(px.w - 2 * side));
  const contentH = Math.max(1, Math.round(px.h - side - bottom));
  const shadowBlur = polaroid ? SHADOW_BLUR * short * s : 0;
  const shadowOffset = polaroid ? SHADOW_OFFSET * short * s : 0;
  const reach = polaroid ? shadowBlur + shadowOffset : 0;
  const cardHalfW = (px.w / 2) * s;
  const cardHalfH = (px.h / 2) * s;
  return {
    cx: px.x + px.w / 2,
    cy: px.y + px.h / 2 + (1 - r) * REVEAL_OFFSET * px.h,
    cardHalfW,
    cardHalfH,
    photoOffX: 0,
    photoOffY: ((side - bottom) / 2) * s,
    photoHalfW: (contentW / 2) * s,
    photoHalfH: (contentH / 2) * s,
    contentW,
    contentH,
    rotation: c.rotation + (polaroid ? REVEAL_TILT * (1 - r) : 0),
    alpha: r,
    shadowBlur,
    shadowOffset,
    shadowOpacity: polaroid ? SHADOW_OPACITY : 0,
    quadHalfW: cardHalfW + reach + 1,
    quadHalfH: cardHalfH + reach + 1,
  };
}

/** Output-pixel position of a local (card-centred, unrotated) point; mirrors the composite vertex shader. */
export function localToFrame(g: CellGeometry, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(g.rotation);
  const s = Math.sin(g.rotation);
  return { x: g.cx + c * lx - s * ly, y: g.cy + s * lx + c * ly };
}

/** Blur-fit cache key: one blurred cover per photo per (cell) frame size. */
export function blurKey(frameW: number, frameH: number): string {
  return `${frameW}x${frameH}`;
}
