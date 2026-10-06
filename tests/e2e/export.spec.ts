import { expect, test } from '@playwright/test';
import { assertMontage } from './helpers/ffprobe.js';
import {
  exportAndDownload,
  expectResultMeta,
  openApp,
  set50,
  setSettings,
  setViaInputs,
  upload,
} from './helpers/app.js';

const EXPORT_TIMEOUT = 4 * 60_000;

test('10 photos, 1234x778 @25fps, 6 s (real inputs) exports a valid MP4', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await openApp(page);
  await upload(page, set50(10));
  await setViaInputs(page, { width: 1234, height: 778, fps: 25, seconds: 6 });
  await expect(page.getByTestId('export-button')).toBeEnabled();
  const { file, name } = await exportAndDownload(page, EXPORT_TIMEOUT);
  expect(name).toBe('montage-1234x778-6s.mp4');
  await expectResultMeta(page);
  const r = assertMontage(file, { width: 1234, height: 778, fps: 25, seconds: 6 });
  console.log('ffprobe 10-photo:', JSON.stringify(r));
});

test('single photo exports a valid MP4', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await openApp(page);
  await upload(page, set50(1));
  await setSettings(page, { width: 640, height: 360, fps: 25, totalDuration: 3 });
  const { file } = await exportAndDownload(page, EXPORT_TIMEOUT);
  const r = assertMontage(file, { width: 640, height: 360, fps: 25, seconds: 3 });
  console.log('ffprobe 1-photo:', JSON.stringify(r));
});

test('cancel stops an export and a subsequent export still works', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await openApp(page);
  await upload(page, set50(10));
  await setSettings(page, { width: 1280, height: 720, fps: 30, totalDuration: 60 });
  const status = page.getByTestId('export-status');
  await page.getByTestId('export-button').click();
  await expect(status).toHaveAttribute('data-state', 'running', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.getByTestId('cancel-export').click();
  await expect(status).toHaveAttribute('data-state', 'cancelled', { timeout: 60_000 });

  await setSettings(page, { width: 640, height: 360, fps: 25, totalDuration: 4 });
  await expect(page.getByTestId('export-button')).toBeEnabled();
  const { file } = await exportAndDownload(page, EXPORT_TIMEOUT);
  assertMontage(file, { width: 640, height: 360, fps: 25, seconds: 4 });
});
