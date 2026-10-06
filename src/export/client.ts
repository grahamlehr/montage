import type { ExportMessage, ExportRequest } from '../types';

export interface ExportHandle {
  cancel(): void;
  /** Resolves with the terminal message: 'done', 'error' or 'cancelled'. */
  done: Promise<ExportMessage>;
}

/** Spawns a worker from `makeWorker` (default: the montage export worker) and runs one export. */
export function startExport(
  request: ExportRequest,
  onMessage: (m: ExportMessage) => void,
  makeWorker: () => Worker = () =>
    new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' }),
): ExportHandle {
  const worker = makeWorker();
  const done = new Promise<ExportMessage>((resolve) => {
    const finish = (m: ExportMessage) => {
      worker.terminate();
      resolve(m);
    };
    worker.onmessage = (e: MessageEvent<ExportMessage>) => {
      onMessage(e.data);
      if (e.data.type !== 'progress') finish(e.data);
    };
    worker.onerror = (e) => {
      const m: ExportMessage = { type: 'error', message: e.message || 'Export worker crashed' };
      onMessage(m);
      finish(m);
    };
  });
  worker.postMessage({ type: 'start', request });
  return {
    cancel: () => worker.postMessage({ type: 'cancel' }),
    done,
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
