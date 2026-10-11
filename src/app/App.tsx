import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTimeline, timingSummary } from '../engine';
import { fitsEncoderArea } from '../lib/constants';
import { preflightEncoder, unsupportedSizeMessage } from '../export';
import { PerPhotoInspector, PhotoTray, SettingsPanel, useMontageStore } from '../ui';
import type { ExportRequest, Timeline } from '../types';
import { track } from './analytics';
import { BrowserNotice } from './BrowserNotice';
import { ConsentBanner } from './ConsentBanner';
import { ExportBar } from './ExportBar';
import type { ExportState } from './ExportBar';
import { PreviewPlayer } from './PreviewPlayer';
import type { PreviewStats } from './previewEngine';
import { ingestFiles } from './ingestFiles';
import { effectiveSettings, hasPendingChanges } from './staging';
import { Tour } from './Tour';
import { browserNoticeWillShow, tourSeen, useConsent } from './visitorPrefs';
import './app.css';

declare global {
  interface Window {
    __montage?: {
      store: typeof useMontageStore;
      getTimeline: () => Timeline | null;
      getPreviewStats: () => PreviewStats | null;
      /** Apply staged settings to the preview/export (same as the Rebuild button). */
      rebuild: () => void;
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

  // Settings are staged: preview and export use `applied` until Rebuild. With no photos there's nothing to
  // preview, so applied simply follows the panel (adjusting state during render, not in an effect).
  const [applied, setApplied] = useState(settings);
  if (sources.length === 0 && applied !== settings) setApplied(settings);
  // Keyed on `loop` rather than all of `settings`, so pending edits don't re-run the build.
  const loop = settings.loop;
  const previewSettings = useMemo(() => effectiveSettings(applied, { ...applied, loop }), [applied, loop]);
  const pending = sources.length > 0 && hasPendingChanges(applied, settings);

  const build = useMemo(
    () => buildTimeline(sources, overrides, previewSettings),
    [sources, overrides, previewSettings],
  );
  const timeline = build.ok ? build.timeline : null;
  const validationError = !build.ok && sources.length > 0 ? build.error : null;
  // The settings panel describes what's selected, so it validates the pending settings.
  const pendingBuild = useMemo(
    () => (pending ? buildTimeline(sources, overrides, settings) : build),
    [pending, sources, overrides, settings, build],
  );
  const pendingError = !pendingBuild.ok && sources.length > 0 ? pendingBuild.error : null;
  const timing = useMemo(
    () => (sources.length > 0 ? timingSummary(sources, settings, overrides) : null),
    [sources, settings, overrides],
  );

  const timelineRef = useRef<Timeline | null>(null);
  const statsRef = useRef<(() => PreviewStats | null) | null>(null);
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);
  const canRebuild = pending && pendingBuild.ok && exportState !== 'running';
  const rebuild = useCallback(() => {
    const current = useMontageStore.getState().settings;
    setApplied(current);
    track('rebuild');
  }, []);
  const rebuildRef = useRef(rebuild);
  useEffect(() => {
    rebuildRef.current = canRebuild ? rebuild : () => {};
  }, [canRebuild, rebuild]);
  useEffect(() => {
    window.__montage = {
      store: useMontageStore,
      getTimeline: () => timelineRef.current,
      getPreviewStats: () => statsRef.current?.() ?? null,
      rebuild: () => setApplied(useMontageStore.getState().settings),
    };
  }, []);
  // ⌘/Ctrl + Enter rebuilds from anywhere (including while a settings field has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // Let a focused number field commit its draft (on blur) before reading the store.
        (document.activeElement as HTMLElement | null)?.blur?.();
        queueMicrotask(() => rebuildRef.current());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pre-flight: can Chrome's H.264 encoder take this size/fps? Checked on the main thread before any worker starts.
  const { width, height, fps, quality } = previewSettings;
  const [encoderCheck, setEncoderCheck] = useState<{ key: string; message: string | null } | null>(null);
  const checkKey = `${width}x${height}@${fps}/${quality}`;
  useEffect(() => {
    let stale = false;
    void preflightEncoder({ width, height, fps, quality }).then((r) => {
      if (!stale) setEncoderCheck({ key: checkKey, message: r.ok ? null : r.message });
    });
    return () => {
      stale = true;
    };
  }, [width, height, fps, quality, checkKey]);
  const blockedReason = !fitsEncoderArea(width, height)
    ? unsupportedSizeMessage(width, height, fps)
    : encoderCheck?.key === checkKey
      ? encoderCheck.message
      : null;
  const checking = !blockedReason && encoderCheck?.key !== checkKey;

  const exporting = exportState === 'running';
  const canExport = !!timeline && !loading && !exporting && !blockedReason && !checking;

  const getRequest = useCallback((): ExportRequest | null => {
    if (!timeline) return null;
    return {
      files: sources.map((s) => s.file),
      photos: sources,
      overrides,
      settings: previewSettings,
    };
  }, [timeline, sources, overrides, previewSettings]);

  const onExportState = useCallback(
    (state: ExportState) => {
      setExportState(state);
      const s = previewSettings;
      const params = {
        width: s.width,
        height: s.height,
        fps: s.fps,
        duration_s: s.totalDuration,
        photo_count: sources.length,
        grouping: s.grouping,
        quality: s.quality,
        loop: s.loop,
      };
      if (state === 'running') track('export_start', params);
      else if (state === 'done') track('export_complete', params);
      else if (state === 'error') track('export_error', params);
      else if (state === 'cancelled') track('export_cancel', params);
    },
    [previewSettings, sources.length],
  );

  // First-visit tour: waits for the browser notice and the cookie choice so overlays never stack.
  const consent = useConsent();
  const [noticeOpen, setNoticeOpen] = useState(browserNoticeWillShow);
  const [consentOpen, setConsentOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(() => !tourSeen());
  const showTour = tourOpen && !noticeOpen && consent !== null && !consentOpen;
  const onTourFinish = useCallback((outcome: 'completed' | 'skipped', step: number) => {
    setTourOpen(false);
    track(outcome === 'completed' ? 'tour_complete' : 'tour_skip', { step: step + 1 });
  }, []);

  return (
    <div className="app-shell">
      <BrowserNotice onClosed={() => setNoticeOpen(false)} />
      <header className="app-header">
        <h1>Montage</h1>
        <span className="app-tagline">Make a <a href="https://www.google.com/search?q=montage+song+team+america" target="_blank">montage</a> video from photos in your browser. Definitely works in Chrome on desktop. Speed depends on your computer and the resolution.</span>
        <nav className="app-header-links" aria-label="Help and privacy">
          <button
            type="button"
            className="app-link"
            data-testid="tour-open"
            onClick={() => setTourOpen(true)}
          >
            Tour
          </button>
          <button
            type="button"
            className="app-link"
            data-testid="consent-open"
            onClick={() => setConsentOpen(true)}
          >
            Cookies
          </button>
        </nav>
      </header>
      <main className="app-main">
        <div className="app-left">
          <div data-tour="photos">
            <PhotoTray
              onFilesSelected={(files) => {
                track('photos_added', { count: files.length });
                void ingestFiles(files);
              }}
            />
          </div>
          <PerPhotoInspector />
        </div>
        <div className="app-centre">
          <div className="app-preview-wrap" data-tour="preview">
            <PreviewPlayer
              timeline={timeline}
              photos={sources}
              settings={previewSettings}
              suspended={exporting}
              statsRef={statsRef}
            />
            {pending && (
              <button
                type="button"
                className="app-stale"
                data-testid="preview-stale"
                disabled={!canRebuild}
                onClick={rebuild}
                title={pendingError ?? 'Apply the changed settings to the preview (⌘/Ctrl + Enter)'}
              >
                Settings changed · Rebuild preview
              </button>
            )}
          </div>
          {validationError && (
            <div className="app-validation" role="alert" data-testid="validation-error">
              {validationError}
            </div>
          )}
          <div data-tour="export">
            <ExportBar
              getRequest={getRequest}
              canExport={canExport}
              blockedReason={blockedReason}
              onStateChange={onExportState}
            />
          </div>
        </div>
        <div className="app-right">
          <div className="app-right-scroll" data-tour="settings">
            <SettingsPanel timing={timing} validationError={pendingError} />
          </div>
          <div className="app-rebuild" data-tour="rebuild">
            <span
              className="app-rebuild-status"
              data-testid="rebuild-status"
              data-pending={pending || undefined}
            >
              {sources.length === 0
                ? 'Add photos to build a preview'
                : pendingError
                  ? 'Fix the settings above to rebuild'
                  : pending
                    ? 'Settings changed'
                    : 'Preview is up to date'}
            </span>
            <button
              type="button"
              className={`app-btn${pending ? ' app-ink' : ''}`}
              data-testid="rebuild-button"
              disabled={!canRebuild}
              onClick={rebuild}
              title="Apply the settings to the preview and export (⌘/Ctrl + Enter)"
            >
              Rebuild
            </button>
          </div>
        </div>
      </main>
      <ConsentBanner open={consentOpen} onClose={() => setConsentOpen(false)} />
      {showTour && <Tour onFinish={onTourFinish} />}
    </div>
  );
}
