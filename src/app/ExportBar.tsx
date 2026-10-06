import { useEffect, useRef, useState } from 'react';
import { downloadBlob, exportFileName, startExport } from '../export';
import type { ExportHandle } from '../export';
import type { ExportMessage, ExportRequest } from '../types';
import { formatBytes } from '../ui';

export type ExportState = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

type Progress = Extract<ExportMessage, { type: 'progress' }>;
type Done = Extract<ExportMessage, { type: 'done' }>;

export interface ExportBarProps {
  /** Builds the request, or null when export isn't possible. Called when Export is clicked. */
  getRequest(): ExportRequest | null;
  canExport: boolean;
  /** Why export is impossible for the current settings (e.g. unsupported size); shown next to the button. */
  blockedReason?: string | null;
  onStateChange(state: ExportState): void;
}

const PHASE_LABEL: Record<Progress['phase'], string> = {
  decoding: 'Decoding photos',
  encoding: 'Encoding',
  finalizing: 'Finalizing',
};

function formatEta(s: number): string {
  const r = Math.max(0, Math.round(s));
  return r >= 60 ? `${Math.floor(r / 60)}m ${r % 60}s` : `${r}s`;
}

export function ExportBar({ getRequest, canExport, blockedReason, onStateChange }: ExportBarProps) {
  const [state, setState] = useState<ExportState>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<ExportHandle | null>(null);

  const change = (s: ExportState) => {
    setState(s);
    onStateChange(s);
  };

  useEffect(
    () => () => {
      handle.current?.cancel();
    },
    [],
  );

  const run = () => {
    const request = getRequest();
    if (!request || state === 'running' || blockedReason) return;
    setProgress(null);
    setResult(null);
    setError(null);
    change('running');
    const h = startExport(request, (m) => {
      if (m.type === 'progress') setProgress(m);
    });
    handle.current = h;
    void h.done.then((m) => {
      if (handle.current !== h) return;
      handle.current = null;
      if (m.type === 'done') {
        setResult(m);
        downloadBlob(m.blob, exportFileName(request.settings));
        change('done');
      } else if (m.type === 'error') {
        setError(m.message);
        change('error');
      } else {
        change('cancelled');
      }
    });
  };

  const pct = progress && progress.total > 0 ? progress.done / progress.total : 0;
  let text = 'Ready to export';
  if (state === 'running') {
    text = progress
      ? `${PHASE_LABEL[progress.phase]}… ${Math.round(pct * 100)}% (${progress.done}/${progress.total})` +
        (progress.etaSeconds !== undefined ? ` · about ${formatEta(progress.etaSeconds)} left` : '')
      : 'Starting export…';
  } else if (state === 'done') text = 'Export complete';
  else if (state === 'error') text = `Export failed: ${error ?? 'unknown error'}`;
  else if (state === 'cancelled') text = 'Export cancelled';

  return (
    <div className="app-exportbar">
      <button
        type="button"
        className="app-btn app-primary"
        data-testid="export-button"
        disabled={!canExport || state === 'running'}
        onClick={run}
      >
        Export MP4
      </button>
      {blockedReason && (
        <span data-testid="export-blocked" role="alert" className="app-status">
          {blockedReason}
        </span>
      )}
      {state === 'running' && (
        <button
          type="button"
          className="app-btn"
          data-testid="cancel-export"
          onClick={() => handle.current?.cancel()}
        >
          Cancel
        </button>
      )}
      <progress
        data-testid="export-progress"
        className="app-progress"
        max={1}
        value={state === 'done' ? 1 : state === 'running' ? pct : 0}
      />
      <span data-testid="export-status" data-state={state} role="status" className="app-status">
        {text}
      </span>
      {result && state === 'done' && (
        <span
          data-testid="export-result"
          data-codec={result.codec}
          data-encoder-path={result.encoderPath}
          data-bytes={result.bytes}
          className="app-result"
        >
          {formatBytes(result.bytes)} ({result.bytes} bytes) · {result.codec} · {result.encoderPath} encoder
        </span>
      )}
    </div>
  );
}
