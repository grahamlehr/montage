import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTimeline, timingSummary } from '../engine';
import { PerPhotoInspector, PhotoTray, SettingsPanel, useMontageStore } from '../ui';
import type { ExportRequest, Timeline } from '../types';
import { ExportBar } from './ExportBar';
import type { ExportState } from './ExportBar';
import { PreviewPlayer } from './PreviewPlayer';
import type { PreviewStats } from './previewEngine';
import { ingestFiles } from './ingestFiles';
import './app.css';

declare global {
  interface Window {
    __montage?: {
      store: typeof useMontageStore;
      getTimeline: () => Timeline | null;
      getPreviewStats: () => PreviewStats | null;
    };
  }
}

export function App() {
  const photos = useMontageStore((s) => s.photos);
  const overrides = useMontageStore((s) => s.overrides);
  const settings = useMontageStore((s) => s.settings);
  const [exportState, setExportState] = useState<ExportState>('idle');

  const ready = useMemo(() => photos.filter((p) => p.status === 'ready'), [photos]);
  const loading = photos.some((p) => p.status === 'loading');
  // Photos only change identity when added/removed/reordered/updated; sources are stable objects.
  const sources = useMemo(() => ready.map((p) => p.source), [ready]);

  const build = useMemo(() => buildTimeline(sources, overrides, settings), [sources, overrides, settings]);
  const timeline = build.ok ? build.timeline : null;
  const validationError = !build.ok && sources.length > 0 ? build.error : null;
  const timing = useMemo(
    () => (sources.length > 0 ? timingSummary(sources.length, settings) : null),
    [sources.length, settings],
  );

  const timelineRef = useRef<Timeline | null>(null);
  const statsRef = useRef<(() => PreviewStats | null) | null>(null);
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);
  useEffect(() => {
    window.__montage = {
      store: useMontageStore,
      getTimeline: () => timelineRef.current,
      getPreviewStats: () => statsRef.current?.() ?? null,
    };
  }, []);

  const exporting = exportState === 'running';
  const canExport = !!timeline && !loading && !exporting;

  const getRequest = useCallback((): ExportRequest | null => {
    if (!timeline) return null;
    return {
      files: sources.map((s) => s.file),
      photos: sources,
      overrides,
      settings,
    };
  }, [timeline, sources, overrides, settings]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Montage</h1>
        <span className="app-tagline">Photos to MP4, entirely in your browser.</span>
      </header>
      <main className="app-main">
        <div className="app-left">
          <PhotoTray onFilesSelected={(files) => void ingestFiles(files)} />
          <PerPhotoInspector />
        </div>
        <div className="app-centre">
          <PreviewPlayer
            timeline={timeline}
            photos={sources}
            settings={settings}
            suspended={exporting}
            statsRef={statsRef}
          />
          {validationError && (
            <div className="app-validation" role="alert" data-testid="validation-error">
              {validationError}
            </div>
          )}
          <ExportBar getRequest={getRequest} canExport={canExport} onStateChange={setExportState} />
        </div>
        <div className="app-right">
          <SettingsPanel timing={timing} validationError={validationError} />
        </div>
      </main>
    </div>
  );
}
