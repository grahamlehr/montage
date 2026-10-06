import { downloadBlob, exportFileName, startExport } from '../src/export';
import type { ExportHandle } from '../src/export';
import { DEFAULT_SETTINGS } from '../src/lib/constants';
import type { ExportMessage, MontageSettings } from '../src/types';

interface CaseResult {
  type: ExportMessage['type'];
  bytes?: number;
  codec?: string;
  encoderPath?: string;
  message?: string;
  progressEvents: number;
  fileName?: string;
}

declare global {
  interface Window {
    runCase(
      width: number,
      height: number,
      fps: MontageSettings['fps'],
      seconds: number,
      cancelAfterFrames?: number,
      failEncoders?: number,
      failAfter?: number,
    ): Promise<CaseResult>;
    lastResult?: CaseResult;
  }
}

const log = document.getElementById('log') as HTMLPreElement;
const bar = document.getElementById('bar') as HTMLProgressElement;
let current: ExportHandle | null = null;

window.runCase = async (width, height, fps, seconds, cancelAfterFrames, failEncoders, failAfter) => {
  const settings: MontageSettings = { ...DEFAULT_SETTINGS, width, height, fps, totalDuration: seconds };
  let progressEvents = 0;
  const handle = startExport(
    { files: [], photos: [], overrides: {}, settings },
    (m) => {
      if (m.type === 'progress') {
        progressEvents++;
        bar.value = m.total ? m.done / m.total : 0;
        log.textContent = `${m.phase} ${m.done}/${m.total} eta=${m.etaSeconds?.toFixed(1) ?? '-'}`;
        if (cancelAfterFrames !== undefined && m.phase === 'encoding' && m.done >= cancelAfterFrames)
          handle.cancel();
      }
    },
    () =>
      failEncoders
        ? new Worker(new URL('./export-fail.worker.ts', import.meta.url), {
            type: 'module',
            name: `${failEncoders}:${failAfter ?? 40}`,
          })
        : new Worker(new URL('../src/export/testPattern.worker.ts', import.meta.url), { type: 'module' }),
  );
  current = handle;
  const m = await handle.done;
  current = null;
  const result: CaseResult = { type: m.type, progressEvents };
  if (m.type === 'done') {
    Object.assign(result, {
      bytes: m.bytes,
      codec: m.codec,
      encoderPath: m.encoderPath,
      fileName: exportFileName(settings),
    });
    downloadBlob(m.blob, exportFileName(settings));
  } else if (m.type === 'error') result.message = m.message;
  log.textContent = JSON.stringify(result);
  window.lastResult = result;
  return result;
};

document.getElementById('cancel')?.addEventListener('click', () => current?.cancel());
for (const [w, h, fps] of [
  [1080, 1920, 30],
  [1234, 778, 25],
] as const) {
  const b = document.createElement('button');
  b.textContent = `Export 5s ${w}x${h}@${fps}`;
  b.onclick = () => void window.runCase(w, h, fps, 5);
  document.getElementById('buttons')?.appendChild(b);
}
