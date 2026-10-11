import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { assertMontage } from './helpers/ffprobe.js';
import { exportAndDownload, openApp, set50, setSettings, trackErrors, upload } from './helpers/app.js';
import { contactSheet, getTimeline, T16_DIR } from './helpers/frames.js';

// 3840x2160 = 32,400 macroblocks, inside the 36,864 cap.
const W = 3840;
const H = 2160;
const N = 40;
const SECONDS = 30;

async function timedExport(page: Page) {
  const t0 = performance.now();
  const { file } = await exportAndDownload(page, 6 * 60_000);
  const secs = (performance.now() - t0) / 1000;
  const r = assertMontage(file, { width: W, height: H, fps: 30, seconds: SECONDS });
  const result = page.getByTestId('export-result');
  return { file, secs, r, encoderPath: await result.getAttribute('data-encoder-path') };
}

test('40 photos at 3840x2160: mixed quad pool and all-quad export without context loss; timed against grouping off', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const errors = trackErrors(page);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  await openApp(page);
  await upload(page, set50(N));
  await setSettings(page, { width: W, height: H, fps: 30, totalDuration: SECONDS, fit: 'blur', grouping: 'off' });
  await expect(page.getByTestId('export-button')).toBeEnabled();
  const off = await timedExport(page);

  await setSettings(page, { grouping: 'mixed', layoutPool: ['quad'], reveal: 'stagger' });
  const tl = await getTimeline(page);
  const quads = tl.segments.filter((s) => s.layout === 'quad').length;
  console.log(`quad timeline: ${tl.segments.length} shots, ${quads} quad`);
  expect(quads).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId('export-button')).toBeEnabled();
  const mixed = await timedExport(page);

  // Worst case: every photo in a quad (joinNext chains of 4) → 10 quad shots, 4 decodes per shot.
  await page.evaluate(() => {
    const st = (window.__montage!.store as unknown as {
      getState(): { photos: Array<{ source: { id: string } }>; setOverride(id: string, p: object): void };
    }).getState();
    st.photos.forEach((p, i) => { if (i % 4 !== 3) st.setOverride(p.source.id, { group: 'joinNext' }); });
  });
  const allTl = await getTimeline(page);
  expect(allTl.segments.map((s) => s.layout)).toEqual(Array(N / 4).fill('quad'));
  await expect(page.getByTestId('export-button')).toBeEnabled();
  const all = await timedExport(page);
  const stats = await page.evaluate(() => window.__montage?.getPreviewStats() ?? null);

  const summary = {
    size: `${W}x${H}`, photos: N, seconds: SECONDS,
    off: { wall: +off.secs.toFixed(1), encoderPath: off.encoderPath, frames: off.r.stream.nb_read_frames },
    mixedQuad: { wall: +mixed.secs.toFixed(1), encoderPath: mixed.encoderPath, frames: mixed.r.stream.nb_read_frames, shots: tl.segments.length, quads },
    allQuad: { wall: +all.secs.toFixed(1), encoderPath: all.encoderPath, frames: all.r.stream.nb_read_frames, shots: allTl.segments.length },
    previewStats: stats,
  };
  console.log('perf', JSON.stringify(summary));
  mkdirSync(path.join(T16_DIR, 'perf'), { recursive: true });
  writeFileSync(path.join(T16_DIR, 'perf', 'summary.json'), JSON.stringify({ ...summary, logs }, null, 2));
  const sheet = allTl.segments
    .slice(0, 8)
    .map((s, k) => ({ t: s.end - 0.6, caption: `quad ${k} late hold p${s.cells.map((c) => c.photoIndex + 1).join('+')}` }));
  contactSheet(all.file, sheet, path.join(T16_DIR, 'perf', 'quad-3840x2160'), 4, 640);

  expect(logs.filter((l) => /context ?lost|CONTEXT_LOST|out of memory/i.test(l))).toEqual([]);
  expect(errors).toEqual([]);
});
