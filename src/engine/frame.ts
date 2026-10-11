import type { Cell, CellLayer, FrameDescriptor, Layer, Segment, Shot, Timeline } from '../types';
import { clamp, easeInOut, easeOut, lerp } from './easing';

function layerAt(seg: Segment, cell: Cell, t: number): Layer {
  const span = seg.end - seg.start;
  const u = easeInOut(span > 0 ? (t - seg.start) / span : 1);
  const a = cell.motionFrom;
  const b = cell.motionTo;
  return {
    photoIndex: cell.photoIndex,
    fit: cell.fit,
    focus: { x: cell.focus.x, y: cell.focus.y },
    transform: { scale: lerp(a.scale, b.scale, u), tx: lerp(a.tx, b.tx, u), ty: lerp(a.ty, b.ty, u) },
  };
}

/** Eased reveal of a cell at time t: 0 before revealStart, 1 once revealDuration has elapsed (§4.7.3). */
export function revealAt(cell: Pick<Cell, 'revealStart' | 'revealDuration'>, t: number): number {
  if (!(cell.revealDuration > 0)) return 1;
  return easeOut((t - cell.revealStart) / cell.revealDuration);
}

/** Everything drawn for one segment (shot) at time t. */
export function shotAt(seg: Segment, t: number): Shot {
  const cells: CellLayer[] = seg.cells.map((cell) => ({
    ...layerAt(seg, cell, t),
    rect: { x: cell.rect.x, y: cell.rect.y, w: cell.rect.w, h: cell.rect.h },
    rotation: cell.rotation,
    border: cell.border,
    reveal: revealAt(cell, t),
  }));
  let backdrop: Layer | null = null;
  if (seg.backdrop !== null) {
    const src = seg.cells.find((c) => c.photoIndex === seg.backdrop);
    if (src) backdrop = { ...layerAt(seg, src, t), fit: 'cover' };
  }
  return { backdrop, cells };
}

/**
 * Pure description of the frame at time `t` (clamped to [0, duration]). On a looping timeline
 * `frameAt(duration)` is `frameAt(0)`, and the last `wrap` seconds transition from the last shot
 * (evaluated at t) into shot 0 (evaluated at t − duration) — see PLAN §4.9.
 */
export function frameAt(timeline: Timeline, t: number): FrameDescriptor {
  const segs = timeline.segments;
  let time = clamp(Number.isFinite(t) ? t : 0, 0, timeline.duration);
  if (timeline.loop && time >= timeline.duration) time = 0;
  const first = segs[0] as Segment;
  const wrap = timeline.loop ? first.transitionIn : null;
  if (wrap && wrap.duration > 0 && time >= wrap.start) {
    return {
      kind: 'transition',
      style: wrap.style,
      progress: easeInOut((time - wrap.start) / wrap.duration),
      from: shotAt(segs[segs.length - 1] as Segment, time),
      to: shotAt(first, time - timeline.duration),
    };
  }
  // Last segment that has started by `time`.
  let idx = 0;
  for (let i = segs.length - 1; i > 0; i--) {
    if ((segs[i] as Segment).start <= time) {
      idx = i;
      break;
    }
  }
  const seg = segs[idx] as Segment;
  // Segment 0's transitionIn is the wrap (handled above), never an intro transition.
  const tr = idx === 0 ? null : seg.transitionIn;
  if (tr && tr.duration > 0 && time < tr.start + tr.duration) {
    const prev = segs[idx - 1] as Segment;
    return {
      kind: 'transition',
      style: tr.style,
      progress: easeInOut((time - tr.start) / tr.duration),
      from: shotAt(prev, time),
      to: shotAt(seg, time),
    };
  }
  return { kind: 'single', shot: shotAt(seg, time) };
}
