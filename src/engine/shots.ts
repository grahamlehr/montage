import type { Segment } from '../types';

/** Photo indices shown in a segment (shot), in draw order. */
export function photosOf(segment: Pick<Segment, 'cells'>): number[] {
  return segment.cells.map((c) => c.photoIndex);
}

/**
 * Pixel size of the cell holding `photoIndex` in a `width`×`height` output: rect × output, rounded, ≥ 1.
 * Falls back to the full output size when the photo isn't in the segment.
 */
export function cellPixelSize(
  segment: Pick<Segment, 'cells'>,
  photoIndex: number,
  out: { width: number; height: number },
): { width: number; height: number } {
  const cell = segment.cells.find((c) => c.photoIndex === photoIndex);
  const w = cell ? cell.rect.w : 1;
  const h = cell ? cell.rect.h : 1;
  return { width: Math.max(1, Math.round(w * out.width)), height: Math.max(1, Math.round(h * out.height)) };
}
