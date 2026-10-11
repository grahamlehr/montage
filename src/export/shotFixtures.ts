import type { Cell, LayoutStyle, Rect, Segment, Timeline } from '../types';

/** Test-only: hand-built timelines of shots, independent of the engine. */

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
const RECTS: Record<number, Rect[]> = {
  1: [FULL],
  2: [
    { x: 0, y: 0, w: 0.5, h: 1 },
    { x: 0.5, y: 0, w: 0.5, h: 1 },
  ],
  3: [
    { x: 0, y: 0, w: 0.5, h: 1 },
    { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  ],
  4: [
    { x: 0, y: 0, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  ],
};
const LAYOUTS: Record<number, LayoutStyle> = { 1: 'single', 2: 'duo', 3: 'trio', 4: 'quad' };

function cell(photoIndex: number, rect: Rect, start: number): Cell {
  const id = { scale: 1, tx: 0, ty: 0 };
  return {
    photoIndex,
    rect,
    rotation: 0,
    border: 'none',
    motion: 'none',
    motionFrom: id,
    motionTo: id,
    fit: 'cover',
    focus: { x: 0.5, y: 0.5 },
    revealStart: start,
    revealDuration: 0,
  };
}

/**
 * `shotSizes` = photos per shot, in order (photo indices consecutive). Shots share `duration` evenly
 * with a `transition`-second crossfade between neighbours, like the engine's layout of time.
 */
export function shotTimeline(shotSizes: number[], duration = 10, transition = 0.5, fps = 30): Timeline {
  const n = shotSizes.length;
  const slot = duration / n;
  let photo = 0;
  const segments: Segment[] = shotSizes.map((size, i) => {
    const start = i === 0 ? 0 : i * slot - transition / 2;
    const end = i === n - 1 ? duration : (i + 1) * slot + transition / 2;
    const rects = RECTS[size] ?? [FULL];
    const cells = rects.map((r) => cell(photo++, r, start));
    return {
      layout: LAYOUTS[size] ?? 'single',
      cells,
      backdrop: size > 1 ? (cells[0]?.photoIndex ?? null) : null,
      start,
      end,
      transitionIn: i === 0 ? null : { style: 'crossfade', start, duration: transition },
    };
  });
  return { duration, fps, frameCount: Math.round(duration * fps), loop: false, segments };
}
