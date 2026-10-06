import { expect, test } from '@playwright/test';
import { assertMontage } from './helpers/ffprobe.js';
import { exportAndDownload, expectResultMeta, openApp, set50, setViaInputs, upload } from './helpers/app.js';

const dims = async (page: import('@playwright/test').Page) => ({
  w: Number(await page.locator('#set-width').inputValue()),
  h: Number(await page.locator('#set-height').inputValue()),
});

test('4096x4096 typed into the real inputs ends at an encodable size with the area-cap note', async ({ page }) => {
  await openApp(page);
  const lock = page.getByLabel('Lock aspect ratio');
  if ((await lock.getAttribute('aria-pressed')) === 'true') await lock.click();

  // Editing the width keeps it and limits the height...
  await page.locator('#set-height').fill('4096');
  await page.locator('#set-height').press('Enter');
  await page.locator('#set-width').fill('4096');
  await page.locator('#set-width').press('Enter');
  expect(await dims(page)).toEqual({ w: 4096, h: 2304 });
  const note = page.getByTestId('area-cap-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('height limited to 2304');

  // ...editing the height keeps it and limits the width.
  await page.locator('#set-height').fill('4096');
  await page.locator('#set-height').press('Enter');
  expect(await dims(page)).toEqual({ w: 2304, h: 4096 });
  await expect(note).toContainText('width limited to 2304');

  // A normal size clears the note.
  await page.locator('#set-width').fill('1080');
  await page.locator('#set-width').press('Enter');
  await page.locator('#set-height').fill('1920');
  await page.locator('#set-height').press('Enter');
  await expect(note).toHaveCount(0);

});

test('4096x2304 @30 fps, 2 s, 2 photos exports a valid MP4 at the cap', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await openApp(page);
  await upload(page, set50(2));
  await setViaInputs(page, { width: 2304, height: 2304, fps: 30, seconds: 2 });
  await setViaInputs(page, { width: 4096, height: 2304, fps: 30, seconds: 2 });
  expect(await dims(page)).toEqual({ w: 4096, h: 2304 });
  await expect(page.getByTestId('area-cap-note')).toBeVisible();
  await expect(page.getByTestId('export-button')).toBeEnabled();
  await page.screenshot({ path: 'tmp/fix19/settings-at-cap.png', fullPage: true });
  const { file, name } = await exportAndDownload(page, 6 * 60_000);
  expect(name).toBe('montage-4096x2304-2s.mp4');
  await expectResultMeta(page);
  const r = assertMontage(file, { width: 4096, height: 2304, fps: 30, seconds: 2 });
  console.log('ffprobe 4096x2304:', JSON.stringify(r));
});

test('export stays disabled with a reason if an over-cap size slips past the UI', async ({ page }) => {
  await openApp(page);
  await upload(page, set50(2));
  await page.evaluate(() => {
    const m = (window as unknown as { __montage: { store: { setState(p: unknown): void; getState(): { settings: object } } } }).__montage;
    m.store.setState({ settings: { ...m.store.getState().settings, width: 4096, height: 4096 } });
  });
  await expect(page.getByTestId('export-button')).toBeDisabled();
  await expect(page.getByTestId('export-blocked')).toContainText('9.4 MP');
});
