import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { MontageSettings, Timeline } from '../../../src/types.js';
import { ROOT } from './app.js';

declare global {
  // Test hook exposed by src/app/App.tsx (minimal shape used by the e2e specs).
  interface Window {
    __montage?: {
      store: { getState(): { settings: MontageSettings } };
      getTimeline(): Timeline | null;
      getPreviewStats(): unknown;
    };
  }
}

export const T16_DIR = path.join(ROOT, 'tmp', 't16');

const ff = (args: string[]): string =>
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });

/** md5 of every decoded frame (rawvideo, the stream's own pixel format), in presentation order. */
export function frameMd5s(file: string): string[] {
  return ff(['-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'])
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(',').pop()!.trim());
}

/** Average PSNR between two equally-sized videos (ffmpeg `psnr` filter); Infinity when identical. */
export function psnrAvg(a: string, b: string): number {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  const m = /average:(inf|[\d.]+)/.exec(r.stderr);
  if (!m) throw new Error(`psnr: no result\n${r.stderr.slice(-500)}`);
  return m[1] === 'inf' ? Infinity : Number(m[1]);
}

/** Write the frame nearest `t` seconds to `out` (PNG), optionally scaled to `width`. */
export function extractFrame(file: string, t: number, out: string, width?: number): void {
  mkdirSync(path.dirname(out), { recursive: true });
  ff(['-ss', t.toFixed(4), '-i', file, '-frames:v', '1', ...(width ? ['-vf', `scale=${width}:-2`] : []), out]);
}

/** Raw RGB24 pixels of the frame nearest `t`. */
export function frameRgb(file: string, t: number): { data: Buffer; width: number; height: number } {
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], {
      encoding: 'utf8',
    }),
  ) as { streams: Array<{ width: number; height: number }> };
  const { width, height } = probe.streams[0]!;
  const data = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-ss', t.toFixed(4), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 512 << 20 },
  );
  return { data, width, height };
}

/**
 * Contact sheet: one tile per (time, caption), `cols` per row, each scaled to `tileW`. Writes `<out>.png` and an
 * index `<out>.txt` (tile number → caption) next to it.
 */
export function contactSheet(file: string, shots: Array<{ t: number; caption: string }>, out: string, cols = 4, tileW = 480): void {
  const dir = `${out}.tiles`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  shots.forEach((s, i) => extractFrame(file, s.t, path.join(dir, `${String(i).padStart(3, '0')}.png`), tileW));
  const rows = Math.ceil(shots.length / cols);
  ff([
    '-framerate', '1', '-i', path.join(dir, '%03d.png'),
    '-vf', `tile=${cols}x${rows}:padding=6:margin=6:color=0x404040`,
    '-frames:v', '1', `${out}.png`,
  ]);
  writeFileSync(`${out}.txt`, shots.map((s, i) => `${i}\t${s.t.toFixed(3)}s\t${s.caption}`).join('\n') + '\n');
  rmSync(dir, { recursive: true, force: true });
}

export async function getTimeline(page: Page): Promise<Timeline> {
  const tl = await page.evaluate(() => window.__montage?.getTimeline() ?? null);
  if (!tl) throw new Error('no timeline');
  return tl as Timeline;
}

/** SHA-256 of the preview canvas pixels (WebGL canvas with preserveDrawingBuffer, read through a 2D canvas). */
export async function previewHash(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const src = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const c = new OffscreenCanvas(src.width, src.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const px = ctx.getImageData(0, 0, src.width, src.height).data;
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', px));
    return `${src.width}x${src.height}:` + Array.from(d.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
  });
}

/** Seek the preview and wait until the canvas is stable (two equal hashes 300 ms apart). */
export async function seekPreview(page: Page, t: number): Promise<string> {
  await page.getByTestId('preview-scrubber').fill(String(t));
  let prev = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(300);
    const h = await previewHash(page);
    if (h === prev) return h;
    prev = h;
  }
  throw new Error(`preview did not settle at t=${t}`);
}
