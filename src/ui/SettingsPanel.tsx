import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { DURATION_MAX, DURATION_MIN, GUTTER_MAX, estimateFileBytes } from '../lib/constants';
import { timingSummary } from '../engine';
import {
  DIMENSION_PRESETS, FIT_MODES, FPS_OPTIONS, GROUPINGS, GROUPING_HINTS, GROUPING_LABELS, LAYOUT_LABELS, MOTION_STYLES,
  MULTI_LAYOUTS, QUALITIES, STYLE_LABELS, TRANSITION_STYLES, estimateTiming, formatBytes, formatRatio, formatSeconds,
  shotSummaryText,
} from './logic';
import type { TimingEstimate } from './logic';
import { useMontageStore } from './store';
import type { MontageSettings } from '../types';
import './ui.css';

export interface SettingsPanelProps {
  /** Derived timing from the engine's `timingSummary()`; computed locally when absent. */
  timing?: TimingEstimate | null;
  validationError?: string | null;
}

/** Numeric input committing on blur/Enter, so typing "1081" doesn't round mid-keystroke. */
function NumberField({ id, label, value, min, max, step = 1, onCommit }: {
  id: string; label: string; value: number; min: number; max: number; step?: number; onCommit(v: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const n = Number(draft);
      if (draft.trim() !== '' && Number.isFinite(n)) onCommit(n);
      setDraft(null);
    }
  };
  return (
    <input
      id={id} aria-label={label} className="mt-input" type="number" inputMode="numeric"
      min={min} max={max} step={step}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(null); }}
    />
  );
}

function RatioField() {
  const width = useMontageStore((s) => s.settings.width);
  const height = useMontageStore((s) => s.settings.height);
  const setRatio = useMontageStore((s) => s.setRatio);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft === null) return;
    if (draft.trim() === '') { setDraft(null); setInvalid(false); return; }
    const ok = setRatio(draft);
    setInvalid(!ok);
    if (ok) setDraft(null);
  };
  return (
    <input
      id="set-ratio" className="mt-input" type="text" aria-label="Aspect ratio (e.g. 7:5)" placeholder="e.g. 7:5"
      aria-invalid={invalid} title="Type a ratio such as 7:5 and press Enter (keeps the width)"
      value={draft ?? formatRatio(width, height)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
      onBlur={() => { commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(null); setInvalid(false); } }}
    />
  );
}

function Slider({ label, valueText, name, value, onChange, lowLabel, highLabel, min = 0, max = 1, step = 0.01, disabled }: {
  label: string; valueText: string; name: string; value: number; onChange(v: number): void; lowLabel: string; highLabel: string;
  min?: number; max?: number; step?: number; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="mt-field" data-disabled={disabled || undefined}>
      <label htmlFor={id}>{label}: <span className="mt-value" data-testid={`${name}-value`}>{valueText}</span></label>
      <input id={id} className="mt-slider" type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        data-testid={`${name}-slider`} aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.target.value))} />
      <div className="mt-slider-ends" aria-hidden="true"><span>{lowLabel}</span><span>{highLabel}</span></div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div role="group" aria-label={label}>{children}</div>;
}

/** Lucide `lock` / `lock-open` (ISC), inline on currentColor. */
function LockIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" />
      <path d={open ? 'M7 11V7a5 5 0 0 1 9.9-1' : 'M7 11V7a5 5 0 0 1 10 0v4'} />
    </svg>
  );
}

export function SettingsPanel({ timing, validationError }: SettingsPanelProps = {}) {
  const s = useMontageStore((st) => st.settings);
  const aspectLocked = useMontageStore((st) => st.aspectLocked);
  const areaNote = useMontageStore((st) => st.areaNote);
  const photos = useMontageStore((st) => st.photos);
  const overrides = useMontageStore((st) => st.overrides);
  const setSettings = useMontageStore((st) => st.setSettings);
  const setAspectLocked = useMontageStore((st) => st.setAspectLocked);
  const applyPreset = useMontageStore((st) => st.applyPreset);
  const toggleMotion = useMontageStore((st) => st.toggleMotion);
  const toggleTransition = useMontageStore((st) => st.toggleTransition);
  const toggleLayout = useMontageStore((st) => st.toggleLayout);
  const randomiseSeed = useMontageStore((st) => st.randomiseSeed);

  const t = timing ?? (photos.length ? timingSummary(photos.map((p) => p.source), s, overrides) : estimateTiming(s, 0));
  const transitionText = formatSeconds(t.transition);
  const pacingText = shotSummaryText(t);
  const groupingOff = s.grouping === 'off';
  const motionText = `${Math.round(s.motionIntensity * 100)}%`;
  const bytes = estimateFileBytes(s);

  return (
    <section className="mt-settings" aria-label="Settings">
      <h2>Settings</h2>
      {validationError && <div className="mt-alert" role="alert">{validationError}</div>}
      {!validationError && !t.ok && <div className="mt-alert" role="alert">Too many photos for this length: each photo would be under 0.25 s.</div>}

      <h3>Dimensions</h3>
      <Group label="Dimension presets">
        <div className="mt-presets">
          {DIMENSION_PRESETS.map((p) => {
            const active = p.width === s.width && p.height === s.height;
            return (
              <button key={p.label} type="button" className="mt-chip" aria-pressed={active}
                title={`${p.width}×${p.height}`} onClick={() => applyPreset(p)}>{p.label}</button>
            );
          })}
        </div>
      </Group>
      <div className="mt-field">
        <span className="mt-label">Size (px, even, 128–4096, ≤ 9.4 MP)</span>
        <div className="mt-dims">
          <NumberField id="set-width" label="Width" value={s.width} min={128} max={4096} step={2} onCommit={(v) => setSettings({ width: v })} />
          <span aria-hidden="true">×</span>
          <NumberField id="set-height" label="Height" value={s.height} min={128} max={4096} step={2} onCommit={(v) => setSettings({ height: v })} />
          <button type="button" className="mt-btn mt-lock" aria-pressed={aspectLocked}
            aria-label="Lock aspect ratio" title={aspectLocked ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
            onClick={() => setAspectLocked(!aspectLocked)}><LockIcon open={!aspectLocked} /></button>
          <RatioField />
        </div>
        {areaNote && (
          <div className="mt-muted" data-testid="area-cap-note" role="status">{areaNote}</div>
        )}
      </div>

      <h3>Timing</h3>
      <div className="mt-row">
        <div className="mt-field" style={{ margin: 0 }}>
          <label htmlFor="set-fps">Frame rate</label>
          <select id="set-fps" className="mt-select" value={s.fps} onChange={(e) => setSettings({ fps: Number(e.target.value) as MontageSettings['fps'] })}>
            {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select>
        </div>
        <div className="mt-field" style={{ margin: 0 }}>
          <label htmlFor="set-duration">Total duration (s)</label>
          <NumberField id="set-duration" label="Total duration (seconds)" value={s.totalDuration} min={DURATION_MIN} max={DURATION_MAX} step={1}
            onCommit={(v) => setSettings({ totalDuration: v })} />
        </div>
      </div>

      <Slider name="transition" label="Transition speed" valueText={`Transitions: ${transitionText}`}
        value={s.transitionSpeed} onChange={(v) => setSettings({ transitionSpeed: v })} lowLabel="Slow" highLabel="Fast" />
      <Slider name="motion" label="Motion intensity" valueText={motionText}
        value={s.motionIntensity} onChange={(v) => setSettings({ motionIntensity: v })} lowLabel="Static" highLabel="Strong" />
      <Slider name="pacing" label="Pacing" valueText={pacingText}
        value={s.pacing} onChange={(v) => setSettings({ pacing: v })} lowLabel="Even" highLabel="Dynamic" />
      <div className="mt-muted" data-testid="timing-detail">Shortest shot about {formatSeconds(t.minShot)}</div>

      <h3>Motion styles (at least one)</h3>
      <Group label="Motion styles">
        <div className="mt-pool">
          {MOTION_STYLES.map((m) => (
            <button key={m} type="button" className="mt-chip" aria-pressed={s.motionPool.includes(m)}
              onClick={() => toggleMotion(m)}>{STYLE_LABELS[m]}</button>
          ))}
        </div>
      </Group>
      <h3>Transition styles (at least one)</h3>
      <Group label="Transition styles">
        <div className="mt-pool">
          {TRANSITION_STYLES.map((m) => (
            <button key={m} type="button" className="mt-chip" aria-pressed={s.transitionPool.includes(m)}
              onClick={() => toggleTransition(m)}>{STYLE_LABELS[m]}</button>
          ))}
        </div>
      </Group>

      <div className="mt-field">
        <span className="mt-label" id="set-selection-label">Style selection</span>
        <div className="mt-row">
          <div role="radiogroup" aria-labelledby="set-selection-label" className="mt-row">
            {(['sequence', 'random'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={s.selection === m} className="mt-chip"
                onClick={() => setSettings({ selection: m })}>{m === 'sequence' ? 'In sequence' : 'Random'}</button>
            ))}
          </div>
          <button type="button" className="mt-btn" onClick={randomiseSeed} title={`Seed ${s.seed}`}>Randomise</button>
          <span className="mt-muted" data-testid="seed-value">seed {s.seed}</span>
        </div>
      </div>

      <h3>Layouts</h3>
      <div className="mt-field">
        <span className="mt-label" id="set-grouping-label">Grouping</span>
        <div role="radiogroup" aria-labelledby="set-grouping-label" aria-describedby="set-grouping-hint" className="mt-segmented">
          {GROUPINGS.map((g) => (
            <button key={g} type="button" role="radio" aria-checked={s.grouping === g} className="mt-chip"
              title={GROUPING_HINTS[g]} data-testid={`grouping-${g}`}
              onClick={() => setSettings({ grouping: g })}>{GROUPING_LABELS[g]}</button>
          ))}
        </div>
        <span id="set-grouping-hint" className="mt-muted mt-hint" data-testid="grouping-hint">{GROUPING_HINTS[s.grouping]}</span>
      </div>
      {s.grouping === 'mixed' && (
        <div className="mt-field">
          <span className="mt-label">Layouts (at least one)</span>
          <Group label="Layouts">
            <div className="mt-pool">
              {MULTI_LAYOUTS.map((l) => (
                <button key={l} type="button" className="mt-chip" aria-pressed={s.layoutPool.includes(l)}
                  data-testid={`layout-${l}`} onClick={() => toggleLayout(l)}>{LAYOUT_LABELS[l]}</button>
              ))}
            </div>
          </Group>
        </div>
      )}
      <Slider name="gutter" label="Gutter" valueText={`${(s.gutter * 100).toFixed(1)}%`}
        value={s.gutter} min={0} max={GUTTER_MAX} step={0.001} disabled={groupingOff}
        onChange={(v) => setSettings({ gutter: v })} lowLabel="None" highLabel="Wide" />
      <div className="mt-field" data-disabled={groupingOff || undefined}>
        <span className="mt-label" id="set-reveal-label">Reveal</span>
        <div role="radiogroup" aria-labelledby="set-reveal-label" className="mt-segmented">
          {(['together', 'stagger'] as const).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={s.reveal === r} className="mt-chip"
              disabled={groupingOff} data-testid={`reveal-${r}`}
              title={r === 'together' ? 'All photos in a shot appear at once' : 'Photos in a shot pop in one after another'}
              onClick={() => setSettings({ reveal: r })}>{r === 'together' ? 'Together' : 'Stagger'}</button>
          ))}
        </div>
      </div>

      <h3>Look</h3>
      <div className="mt-field">
        <span className="mt-label" id="set-fit-label">Fit</span>
        <div role="radiogroup" aria-labelledby="set-fit-label" className="mt-row">
          {FIT_MODES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={s.fit === m} className="mt-chip"
              onClick={() => setSettings({ fit: m })}>{m === 'blur' ? 'Blur' : STYLE_LABELS[m]}</button>
          ))}
        </div>
      </div>
      <div className="mt-row">
        <div className="mt-field" style={{ margin: 0 }}>
          <label htmlFor="set-bg">Background</label>
          <input id="set-bg" type="color" className="mt-input" style={{ padding: 2, width: 48, height: 28 }}
            value={s.background} onChange={(e) => setSettings({ background: e.target.value })} />
        </div>
        <div className="mt-field" style={{ margin: 0 }}>
          <label htmlFor="set-quality">Quality</label>
          <select id="set-quality" className="mt-select" value={s.quality}
            onChange={(e) => setSettings({ quality: e.target.value as MontageSettings['quality'] })}>
            {QUALITIES.map((q) => <option key={q} value={q}>{q[0]?.toUpperCase()}{q.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <p className="mt-muted" style={{ marginBottom: 0 }}>
        Estimated file size: <span className="mt-size" data-testid="size-estimate">~{formatBytes(bytes)}</span>
      </p>
    </section>
  );
}
