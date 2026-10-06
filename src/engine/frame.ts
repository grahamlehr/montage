import type { FrameDescriptor, Layer, Segment, Timeline } from '../types';
import { clamp, easeInOut, lerp } from './easing';

function layerAt(seg: Segment, t: number): Layer {
  const span = seg.end - seg.start;
  const u = easeInOut(span > 0 ? (t - seg.start) / span : 1);
  const a = seg.motionFrom;
  const b = seg.motionTo;
  return {
    photoIndex: seg.photoIndex,
    fit: seg.fit,
    focus: { x: seg.focus.x, y: seg.focus.y },
    transform: { scale: lerp(a.scale, b.scale, u), tx: lerp(a.tx, b.tx, u), ty: lerp(a.ty, b.ty, u) },
  };
}

/** Pure description of the frame at time `t` (clamped to [0, duration]). */
export function frameAt(timeline: Timeline, t: number): FrameDescriptor {
  const segs = timeline.segments;
  const time = clamp(Number.isFinite(t) ? t : 0, 0, timeline.duration);
  // Last segment that has started by `time`.
  let idx = 0;
  for (let i = segs.length - 1; i > 0; i--) {
    if ((segs[i] as Segment).start <= time) {
      idx = i;
      break;
    }
  }
  const seg = segs[idx] as Segment;
  const tr = seg.transitionIn;
  if (tr && tr.duration > 0 && time < tr.start + tr.duration) {
    const prev = segs[idx - 1] as Segment;
    return {
      kind: 'transition',
      style: tr.style,
      progress: easeInOut((time - tr.start) / tr.duration),
      from: layerAt(prev, time),
      to: layerAt(seg, time),
    };
  }
  return { kind: 'single', layer: layerAt(seg, time) };
}
