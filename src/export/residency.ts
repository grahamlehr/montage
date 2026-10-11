import { decodeSizeFor } from '../ingest';
import type { Timeline } from '../types';
import { cellPixelSize, photosOf } from '../engine';

/**
 * Photo residency by shot (PLAN.md §4.7.6), shared by the export source and the preview engine.
 * Windows are chosen in SEGMENT (shot) indices and then expanded to the photos those shots show;
 * each photo is decoded at the size of the cell it occupies, not the whole output.
 */

export interface Size {
  width: number;
  height: number;
}

/** One photo to keep resident and the bounds to decode it within. */
export interface PhotoDecode {
  photoIndex: number;
  maxW: number;
  maxH: number;
}

/** Index of the segment whose start is the latest one ≤ t (0 before the first start). */
export function segmentIndexAt(timeline: Timeline, t: number): number {
  const segs = timeline.segments;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((segs[mid]?.start ?? Infinity) <= t) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/**
 * Segment indices around `current`: current first, then `behind` previous and `ahead` next ones
 * (wrapping around the timeline when `loop`). Deduplicated, in priority order.
 */
export function segmentWindow(
  count: number,
  current: number,
  behind: number,
  ahead: number,
  loop = false,
): number[] {
  const out: number[] = [];
  const push = (i: number) => {
    const k = loop && count > 0 ? ((i % count) + count) % count : i;
    if (k >= 0 && k < count && !out.includes(k)) out.push(k);
  };
  push(current);
  for (let d = 1; d <= behind; d++) push(current - d);
  for (let d = 1; d <= ahead; d++) push(current + d);
  return out;
}

/**
 * Photos shown by the given segments (union of `photosOf(seg)`, plus the backdrop should it ever not be
 * one of the cells), each with its decode bounds `decodeSizeFor(cellPixelSize(seg, photo, out), natural)`.
 * Order follows `segments`, then cell order; duplicates keep their first occurrence.
 */
export function photosForSegments(
  timeline: Timeline,
  segments: readonly number[],
  out: Size,
  naturals: readonly (Size | undefined)[],
): PhotoDecode[] {
  const result: PhotoDecode[] = [];
  const seen = new Set<number>();
  for (const si of segments) {
    const seg = timeline.segments[si];
    if (!seg) continue;
    const indices = photosOf(seg);
    if (seg.backdrop !== null && !indices.includes(seg.backdrop)) indices.push(seg.backdrop);
    for (const photoIndex of indices) {
      const natural = naturals[photoIndex];
      if (seen.has(photoIndex) || !natural) continue;
      seen.add(photoIndex);
      const { maxW, maxH } = decodeSizeFor(cellPixelSize(seg, photoIndex, out), natural);
      result.push({ photoIndex, maxW, maxH });
    }
  }
  return result;
}
