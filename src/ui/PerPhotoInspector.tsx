import type { KeyboardEvent, MouseEvent } from 'react';
import { FIT_MODES, MOTION_STYLES, STYLE_LABELS, TRANSITION_STYLES } from './logic';
import { useMontageStore } from './store';
import type { FitMode, MotionStyle, TransitionStyle } from '../types';
import './ui.css';

const DEFAULT = '';

export function PerPhotoInspector() {
  const selectedId = useMontageStore((s) => s.selectedId);
  const photos = useMontageStore((s) => s.photos);
  const override = useMontageStore((s) => (s.selectedId ? s.overrides[s.selectedId] : undefined));
  const setOverride = useMontageStore((s) => s.setOverride);
  const clearOverride = useMontageStore((s) => s.clearOverride);

  const index = photos.findIndex((p) => p.source.id === selectedId);
  const photo = index >= 0 ? photos[index] : undefined;
  if (!photo || !selectedId) {
    return (
      <section className="mt-inspector" aria-label="Photo inspector">
        <h2>Selected photo</h2>
        <p className="mt-muted">Select a photo in the tray to override its motion, transition, fit and focus point.</p>
      </section>
    );
  }
  const id = selectedId;
  const focus = override?.focus;

  const setFocusFrom = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    setOverride(id, { focus: { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height } });
  };
  const onFocusKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const delta = d[e.key];
    if (!delta) return;
    e.preventDefault();
    const cur = focus ?? { x: 0.5, y: 0.5 };
    setOverride(id, { focus: { x: cur.x + delta[0], y: cur.y + delta[1] } });
  };

  return (
    <section className="mt-inspector" aria-label="Photo inspector">
      <h2>Photo {index + 1}</h2>
      <p className="mt-muted" title={photo.source.name} style={{ margin: '0 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {photo.source.name} · {photo.source.naturalWidth}×{photo.source.naturalHeight}
      </p>

      <div className="mt-field">
        <label htmlFor="insp-motion">Motion</label>
        <select id="insp-motion" className="mt-select" value={override?.motion ?? DEFAULT}
          onChange={(e) => setOverride(id, { motion: (e.target.value || undefined) as MotionStyle | undefined })}>
          <option value={DEFAULT}>Use default</option>
          {MOTION_STYLES.map((m) => <option key={m} value={m}>{STYLE_LABELS[m]}</option>)}
        </select>
      </div>
      <div className="mt-field">
        <label htmlFor="insp-transition">Transition in{index === 0 ? ' (not used for the first photo)' : ''}</label>
        <select id="insp-transition" className="mt-select" disabled={index === 0} value={index === 0 ? DEFAULT : (override?.transitionIn ?? DEFAULT)}
          onChange={(e) => setOverride(id, { transitionIn: (e.target.value || undefined) as TransitionStyle | undefined })}>
          <option value={DEFAULT}>Use default</option>
          {TRANSITION_STYLES.map((m) => <option key={m} value={m}>{STYLE_LABELS[m]}</option>)}
        </select>
      </div>
      <div className="mt-field">
        <label htmlFor="insp-fit">Fit</label>
        <select id="insp-fit" className="mt-select" value={override?.fit ?? DEFAULT}
          onChange={(e) => setOverride(id, { fit: (e.target.value || undefined) as FitMode | undefined })}>
          <option value={DEFAULT}>Use default</option>
          {FIT_MODES.map((m) => <option key={m} value={m}>{m === 'blur' ? 'Blurred background' : STYLE_LABELS[m]}</option>)}
        </select>
      </div>

      <div className="mt-field">
        <span className="mt-label" id="insp-focus-label">
          Focus point {focus ? <span className="mt-value">({focus.x.toFixed(2)}, {focus.y.toFixed(2)})</span> : <span>(automatic)</span>}
        </span>
        <button type="button" className="mt-focus" aria-labelledby="insp-focus-label"
          aria-describedby="insp-focus-help" data-testid="focus-picker"
          onClick={setFocusFrom} onKeyDown={onFocusKey}>
          {photo.thumbUrl ? <img src={photo.thumbUrl} alt="" draggable={false} /> : <span style={{ display: 'block', width: 160, height: 120 }} />}
          <span className={focus ? 'mt-focus-dot' : 'mt-focus-dot mt-auto'}
            style={{ left: `${(focus?.x ?? 0.5) * 100}%`, top: `${(focus?.y ?? 0.5) * 100}%` }} />
        </button>
        <span id="insp-focus-help" className="mt-muted" style={{ fontSize: 11 }}>
          Click the image (or use arrow keys) to set where cropping and motion centre.
        </span>
        <div className="mt-row">
          <button type="button" className="mt-btn" disabled={!focus} onClick={() => setOverride(id, { focus: undefined })}>Clear focus</button>
          <button type="button" className="mt-btn" disabled={!override} onClick={() => clearOverride(id)}>Clear all overrides</button>
        </div>
      </div>
    </section>
  );
}
