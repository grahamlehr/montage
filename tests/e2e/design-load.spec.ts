import { expect, test } from '@playwright/test';
import { assertMontage } from './helpers/ffprobe.js';
import { exportAndDownload, expectResultMeta, openApp, set50, setSettings, upload } from './helpers/app.js';

test.skip(
  process.env.E2E_FULL !== '1',
  'Set E2E_FULL=1 to run the design-load export (too slow for CI software encoding).',
);

test('design load: 50 photos, 1080x1920 @30fps, 60 s in < 60 s', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await openApp(page);
  await upload(page, set50(50));
  await setSettings(page, { width: 1080, height: 1920, fps: 30, totalDuration: 60 });
  await expect(page.getByTestId('export-button')).toBeEnabled();
  const t0 = performance.now();
  const { file } = await exportAndDownload(page, 5 * 60_000);
  const secs = (performance.now() - t0) / 1000;
  await expectResultMeta(page);
  const r = assertMontage(file, { width: 1080, height: 1920, fps: 30, seconds: 60 });
  console.log(`design-load wall time ${secs.toFixed(1)} s; ffprobe`, JSON.stringify(r));
  expect(secs).toBeLessThan(60);
});
