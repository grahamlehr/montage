// TODO(T12-merge): delete, import from ../engine
// Temporary stand-ins for the engine's `photosOf` / `cellPixelSize` (PLAN.md §4.7.6) so export + preview
// residency can be built and tested before T12 lands. Same semantics as the engine API.
import type { Segment } from '../types';

export function photosOf(segment: Pick<Segment, 'cells'>): number[] {
  return segment.cells.map((c) => c.photoIndex);
}

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
