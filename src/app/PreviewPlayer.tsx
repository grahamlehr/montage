import { useEffect, useRef, useState } from 'react';
import type { MontageSettings, PhotoSource, Timeline } from '../types';
import { PreviewEngine } from './previewEngine';
import type { PreviewStats } from './previewEngine';
import { formatClock } from './formatClock';

export interface PreviewPlayerProps {
  timeline: Timeline | null;
  photos: PhotoSource[];
  settings: MontageSettings;
  /** True while exporting: playback is paused and controls disabled. */
  suspended: boolean;
  statsRef?: { current: (() => PreviewStats | null) | null };
}

export function PreviewPlayer({ timeline, photos, settings, suspended, statsRef }: PreviewPlayerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);

  useEffect(() => {
    // A disposed renderer loses its GL context for good, so every engine gets a fresh canvas
    // (React StrictMode mounts effects twice).
    const stage = stageRef.current;
    if (!stage) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'app-canvas';
    canvas.setAttribute('data-testid', 'preview-canvas');
    stage.prepend(canvas);
    canvasRef.current = canvas;
    const engine = new PreviewEngine(canvas, {
      onTime: setTime,
      onEnded: () => setPlaying(false),
    });
    engineRef.current = engine;
    if (statsRef) statsRef.current = () => engine.stats();
    return () => {
      engine.dispose();
      canvas.remove();
      canvasRef.current = null;
      engineRef.current = null;
      if (statsRef) statsRef.current = null;
    };
  }, [statsRef]);

  useEffect(() => {
    engineRef.current?.update(timeline, photos, settings);
  }, [timeline, photos, settings.width, settings.height, settings.background]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    engineRef.current?.setLoop(loop);
  }, [loop]);

  useEffect(() => {
    if (suspended && engineRef.current?.isPlaying) {
      engineRef.current.pause();
      setPlaying(false);
    }
  }, [suspended]);

  const duration = timeline?.duration ?? 0;
  const toggle = () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPlaying) {
      engine.pause();
      setPlaying(false);
    } else {
      engine.play();
      setPlaying(engine.isPlaying);
    }
  };

  return (
    <section className="app-preview" aria-label="Preview">
      <div className="app-stage" ref={stageRef}>
        {!timeline && <div className="app-stage-empty">Add photos to see a preview</div>}
      </div>
      <div className="app-controls">
        <button
          type="button"
          className="app-btn"
          data-testid="play-button"
          aria-pressed={playing}
          disabled={!timeline || suspended}
          onClick={toggle}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          className="app-scrubber"
          data-testid="preview-scrubber"
          aria-label="Preview position (seconds)"
          min={0}
          max={duration}
          step={0.01}
          value={Math.min(time, duration)}
          disabled={!timeline}
          onChange={(e) => engineRef.current?.seek(Number(e.target.value))}
        />
        <span className="app-time" data-testid="preview-time">
          {formatClock(time)} / {formatClock(duration)}
        </span>
        <label className="app-loop">
          <input
            type="checkbox"
            data-testid="loop-toggle"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
          />{' '}
          Loop
        </label>
      </div>
    </section>
  );
}
