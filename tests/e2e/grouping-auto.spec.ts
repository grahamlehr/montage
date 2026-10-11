import path from 'node:path';
import { expect, test } from '@playwright/test';
import { assertMontage } from './helpers/ffprobe.js';
import { exportAndDownload, FIXTURES, fixture, openApp, setSettings, tiles, trackErrors, upload } from './helpers/app.js';
import { contactSheet, frameRgb, getTimeline, T16_DIR } from './helpers/frames.js';

const s50 = (n: number) => path.join(FIXTURES, 'set50', `photo-${String(n).padStart(2, '0')}.jpg`);
// Pairs of portraits between landscapes: P P L P P L P P L P P L. Covers HEIC and an EXIF-rotated JPEG that only
// becomes portrait after decoding.
const PHOTOS = [
  fixture('portrait.jpg'), fixture('portrait.heic'), fixture('landscape.jpg'),
  fixture('exif-rotated.jpg'), s50(3), fixture('image.heic'),
  s50(6), s50(9), s50(1),
  s50(12), s50(15), fixture('panorama.jpg'),
];
const W = 1920;
const H = 1080;

test('auto grouping pairs portraits in 16:9, brackets them in the strip and exports a valid MP4', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const errors = trackErrors(page);
  await openApp(page);
  await upload(page, PHOTOS);
  await setSettings(page, { width: W, height: H, fps: 30, totalDuration: 20, fit: 'blur' });
  await page.getByTestId('grouping-auto').click();
  await expect(page.getByTestId('grouping-auto')).toHaveAttribute('aria-checked', 'true');

  // Strip: 4 Duo brackets over photos 1-2, 4-5, 7-8, 10-11; singles elsewhere.
  await expect(page.getByTestId('shot-label')).toHaveCount(4);
  await expect(page.getByTestId('shot-label')).toHaveText(['Duo', 'Duo', 'Duo', 'Duo']);
  const pos = await tiles(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-shot-pos') ?? '-'));
  expect(pos).toEqual(['start', 'end', '-', 'start', 'end', '-', 'start', 'end', '-', 'start', 'end', '-']);
  // Summary label: 8 shots.
  await expect(page.getByText(/^8 shots · avg \d+\.\d s$/)).toBeVisible();

  const tl = await getTimeline(page);
  expect(tl.segments.map((s) => s.layout)).toEqual(['duo', 'single', 'duo', 'single', 'duo', 'single', 'duo', 'single']);
  expect(tl.segments.flatMap((s) => s.cells.map((c) => c.photoIndex))).toEqual([...Array(12).keys()]);

  const { file } = await exportAndDownload(page, 4 * 60_000);
  const r = assertMontage(file, { width: W, height: H, fps: 30, seconds: 20 });
  console.log('ffprobe auto:', JSON.stringify(r));

  // Mid-hold of each duo: both halves show photo content, and the centre gutter column is background (black).
  const out = path.join(T16_DIR, 'auto-1920x1080');
  const sheet: Array<{ t: number; caption: string }> = [];
  for (const [k, seg] of tl.segments.entries()) {
    const tIn = seg.transitionIn ? seg.transitionIn.start + seg.transitionIn.duration : seg.start;
    const mid = (tIn + seg.end) / 2 - 0.25;
    if (seg.transitionIn) sheet.push({ t: seg.transitionIn.start + seg.transitionIn.duration / 2, caption: `shot ${k} ${seg.transitionIn.style} mid` });
    sheet.push({ t: mid, caption: `shot ${k} ${seg.layout} mid-hold photos ${seg.cells.map((c) => c.photoIndex + 1).join('+')}` });
    if (seg.layout !== 'duo') continue;
    const { data } = frameRgb(file, mid);
    const lum = (x: number, y: number) => {
      const i = (y * W + x) * 3;
      return (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    };
    let gutter = 0;
    let left = 0;
    let right = 0;
    for (let y = 100; y < H - 100; y += 10) {
      gutter = Math.max(gutter, lum(W / 2, y));
      left += lum(W / 4, y);
      right += lum((3 * W) / 4, y);
    }
    const rows = (H - 200) / 10;
    expect(gutter, `shot ${k}: centre gutter should be background`).toBeLessThan(12);
    expect(left / rows, `shot ${k}: left cell has content`).toBeGreaterThan(20);
    expect(right / rows, `shot ${k}: right cell has content`).toBeGreaterThan(20);
  }
  contactSheet(file, sheet, out, 4);
  expect(errors).toEqual([]);
});
