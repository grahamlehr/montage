import { buildTimeline } from '../src/engine';
import { downloadBlob, startExport } from '../src/export';
import { DEFAULT_SETTINGS } from '../src/lib/constants';
import { readPhotoSource } from '../src/ingest';
import type { ExportMessage, MontageSettings } from '../src/types';

declare global {
  interface Window {
    runMontage(
      width: number, height: number, fps: MontageSettings['fps'], seconds: number, failEncoders: number, failAfter: number,
    ): Promise<{ type: ExportMessage['type']; message?: string; midpoints: number[]; progressRestarts: number }>;
  }
}

const input = document.getElementById('files') as HTMLInputElement;

window.runMontage = async (width, height, fps, seconds, failEncoders, failAfter) => {
  const files = Array.from(input.files ?? []);
  const photos = await Promise.all(files.map((f, i) => readPhotoSource(f, `p${i}`)));
  const settings: MontageSettings = { ...DEFAULT_SETTINGS, width, height, fps, totalDuration: seconds };
  const built = buildTimeline(photos, {}, settings);
  if (!built.ok) throw new Error(built.error);
  const segs = built.timeline.segments;
  const midpoints = segs.map((s, i) => (s.start + (s.transitionIn?.duration ?? 0) + (segs[i + 1]?.start ?? built.timeline.duration)) / 2);
  let last = 0;
  let progressRestarts = 0;
  const handle = startExport(
    { files, photos, overrides: {}, settings },
    (m) => {
      if (m.type === 'progress' && m.phase === 'encoding') {
        if (m.done < last) progressRestarts++;
        last = m.done;
      }
    },
    () => new Worker(new URL('./export-fail-montage.worker.ts', import.meta.url), { type: 'module', name: `${failEncoders}:${failAfter}` }),
  );
  const m = await handle.done;
  if (m.type === 'done') downloadBlob(m.blob, `out-${failEncoders}.mp4`);
  return { type: m.type, message: m.type === 'error' ? m.message : undefined, midpoints, progressRestarts };
};
