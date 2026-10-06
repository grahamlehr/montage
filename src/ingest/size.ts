import { MAX_ZOOM_DELTA, PREVIEW_CAP_FACTOR, THUMB_LONG_EDGE } from '../lib/constants';

export interface Size {
  width: number;
  height: number;
}

/** Absolute ceiling on a decoded bitmap's long edge (keeps extreme panoramas texture-safe). */
export const MAX_DECODE_LONG_EDGE = 8192;

/**
 * Box to pass as `decodePhoto`'s maxW/maxH for an output frame (PLAN §4.6 preview/export rule).
 *
 * The photo must still cover the output at maximum zoom, so the target is output × (1 + MAX_ZOOM_DELTA),
 * each side capped at output long edge × PREVIEW_CAP_FACTOR. Because `decodePhoto` fits *inside* the box,
 * the box is grown to the photo's cover scale (a 6000×1200 panorama into a portrait output keeps its width
 * instead of being squashed to 1404 px wide). Never upscales beyond the natural size; long edge ≤ 8192.
 */
export function decodeSizeFor(output: Size, natural: Size): { maxW: number; maxH: number } {
  const nw = Math.max(1, natural.width);
  const nh = Math.max(1, natural.height);
  const cap = Math.max(output.width, output.height) * PREVIEW_CAP_FACTOR;
  const tw = Math.min(output.width * (1 + MAX_ZOOM_DELTA), cap);
  const th = Math.min(output.height * (1 + MAX_ZOOM_DELTA), cap);
  let s = Math.max(tw / nw, th / nh); // cover scale
  s = Math.min(s, 1, MAX_DECODE_LONG_EDGE / Math.max(nw, nh));
  return { maxW: Math.max(1, Math.ceil(nw * s)), maxH: Math.max(1, Math.ceil(nh * s)) };
}

/** Size after fitting inside maxW×maxH, preserving aspect, never upscaling. */
export function fitWithin(natural: Size, maxW: number, maxH: number): Size {
  const s = Math.min(1, maxW / natural.width, maxH / natural.height);
  if (s >= 1) return { width: natural.width, height: natural.height };
  return { width: Math.max(1, Math.round(natural.width * s)), height: Math.max(1, Math.round(natural.height * s)) };
}

export const THUMB_BOX = { maxW: THUMB_LONG_EDGE, maxH: THUMB_LONG_EDGE } as const;
