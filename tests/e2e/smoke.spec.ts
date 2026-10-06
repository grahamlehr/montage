import { expect, test, type Page } from '@playwright/test';
import { fixture, openApp, tiles, trackErrors, upload } from './helpers/app.js';

/** Screenshot the preview canvas and return mean luminance + a cheap content hash. */
async function sampleCanvas(page: Page): Promise<{ mean: number; hash: string }> {
  const png = await page.getByTestId('preview-canvas').screenshot();
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(32, 32);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, 32, 32);
    bmp.close();
    const d = ctx.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    let hash = '';
    for (let i = 0; i < d.length; i += 4) {
      sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      hash += ((d[i]! >> 4) ^ (d[i + 1]! >> 4) ^ (d[i + 2]! >> 4)).toString(16);
    }
    return { mean: sum / (d.length / 4), hash };
  }, png.toString('base64'));
}

test('loads, ingests mixed fixtures, rejects non-images, previews and scrubs', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);

  const good = [
    'landscape.jpg',
    'portrait.jpg',
    'exif-rotated.jpg',
    'image.heic',
    'portrait.heic',
    'exif-rotated.heic',
    'panorama.jpg',
    'tiny.png',
    'image.png',
    'image.webp',
    'image.avif',
    'image.gif',
  ].map(fixture);
  await upload(page, good);
  // every good fixture has a thumbnail and no status badge
  await expect(page.locator('li.mt-tile .mt-tile-status')).toHaveCount(0);
  await expect(page.locator('li.mt-tile img')).toHaveCount(good.length);

  // A non-image must not break the app (rejected outright or shown as an error tile).
  await page.getByTestId('file-input').setInputFiles([fixture('not-an-image.txt'), fixture('fake.jpg')]);
  await page.waitForTimeout(1500);
  const n = await tiles(page).count();
  expect(n).toBeGreaterThanOrEqual(good.length);
  expect(n).toBeLessThanOrEqual(good.length + 2);
  if (n > good.length)
    await expect(page.locator('li.mt-tile .mt-tile-status[role=alert]').first()).toBeVisible();
  await expect(page.getByTestId('preview-canvas')).toBeVisible();

  // Preview renders non-black pixels.
  await expect.poll(async () => (await sampleCanvas(page)).mean, { timeout: 30_000 }).toBeGreaterThan(8);
  const before = await sampleCanvas(page);

  // Scrubbing changes the frame.
  const scrub = page.getByTestId('preview-scrubber');
  const max = Number(await scrub.getAttribute('max'));
  const targets = [0.25, 0.5, 0.75].map((f) => String(max * f));
  const hashes = new Set<string>([before.hash]);
  for (const t of targets) {
    await scrub.fill(t);
    await page.waitForTimeout(400);
    hashes.add((await sampleCanvas(page)).hash);
  }
  expect(hashes.size).toBeGreaterThan(1);

  // Play toggles.
  const play = page.getByTestId('play-button');
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');

  expect(errors).toEqual([]);
});

test('app loads with no console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
