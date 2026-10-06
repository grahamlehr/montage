import type { ExportCommand, ExportMessage } from '../types';
import type { FrameSourceFactory } from './frameSource';
import { CancelledError, runExport } from './pipeline';
import type { PipelineHandle } from './pipeline';

/** Minimal slice of DedicatedWorkerGlobalScope we use (the project's tsconfig only has the DOM lib). */
export interface WorkerScopeLike {
  postMessage(message: ExportMessage): void;
  onmessage: ((event: MessageEvent<ExportCommand>) => void) | null;
}

/**
 * Wires a worker scope to the export pipeline: ExportCommand in, ExportMessage out.
 * Thin worker entry files call this with their frame source factory.
 */
export function createExportWorkerHandler(factory: FrameSourceFactory, scope: WorkerScopeLike): void {
  let active: PipelineHandle | null = null;
  scope.onmessage = (event) => {
    const cmd = event.data;
    if (cmd.type === 'cancel') {
      active?.cancel();
      return;
    }
    if (active) {
      scope.postMessage({ type: 'error', message: 'An export is already running.' });
      return;
    }
    const { handle, result } = runExport(cmd.request, factory(), (m) => scope.postMessage(m));
    active = handle;
    result
      .then(
        (done) => scope.postMessage(done),
        (e: unknown) => {
          if (e instanceof CancelledError) scope.postMessage({ type: 'cancelled' });
          else scope.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        },
      )
      .finally(() => {
        active = null;
      });
  };
}
