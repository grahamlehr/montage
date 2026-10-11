import { expect, test } from '@playwright/test';
import { openApp, set50, skipFirstVisit, trackErrors, upload } from './helpers/app.js';
import { getTimeline } from './helpers/frames.js';

test('first visit: cookie banner, then the guided tour; neither returns on reload', async ({ page }) => {
  const errors = trackErrors(page);
  const gaRequests: string[] = [];
  page.on('request', (r) => {
    if (/googletagmanager|google-analytics/.test(r.url())) gaRequests.push(r.url());
  });
  await page.goto('/');
  const banner = page.getByTestId('consent-banner');
  await expect(banner).toBeVisible();
  // The tour waits for the cookie choice so the two never overlap.
  await expect(page.getByTestId('tour')).toHaveCount(0);

  await page.getByTestId('consent-accept').click();
  await expect(banner).toHaveCount(0);
  const tour = page.getByTestId('tour');
  await expect(tour).toBeVisible();
  await expect(tour.getByRole('dialog')).toContainText('Welcome to Montage');

  // Step through every stop; each one spotlights its part of the app.
  const titles: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('tour-next').click();
    titles.push((await page.locator('#tour-title').textContent()) ?? '');
  }
  expect(titles).toEqual([
    '1. Add your photos',
    '2. Watch the preview',
    '3. Choose your settings',
    '4. Rebuild to apply',
    '5. Export your video',
  ]);
  await page.getByTestId('tour-back').click();
  await expect(page.locator('#tour-title')).toHaveText('4. Rebuild to apply');
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-next')).toHaveText('Get started');
  await page.getByTestId('tour-next').click();
  await expect(tour).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('file-input')).toBeAttached();
  await expect(banner).toHaveCount(0);
  await expect(tour).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('montage.analyticsConsent'))).toBe('granted');

  // Only production builds load Google Analytics; the dev server never contacts Google.
  expect(gaRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('declining is remembered, and the Cookies link reopens the choice', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('consent-decline').click();
  await expect(page.getByTestId('consent-banner')).toHaveCount(0);
  // Esc skips the tour; the header's Tour button replays it.
  await expect(page.getByTestId('tour')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour')).toHaveCount(0);
  await page.getByTestId('tour-open').click();
  await expect(page.getByTestId('tour')).toBeVisible();
  await page.getByTestId('tour-skip').click();

  await page.getByTestId('consent-open').click();
  await expect(page.getByTestId('consent-current')).toHaveText(/analytics declined/);
  await page.getByTestId('consent-accept').click();
  await expect(page.getByTestId('consent-banner')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('montage.analyticsConsent'))).toBe('granted');
});

test('returning visitors see neither banner nor tour', async ({ page }) => {
  await skipFirstVisit(page);
  await page.goto('/');
  await expect(page.getByTestId('file-input')).toBeAttached();
  await expect(page.getByTestId('consent-banner')).toHaveCount(0);
  await expect(page.getByTestId('tour')).toHaveCount(0);
});

test('settings changes are staged until Rebuild', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const status = page.getByTestId('rebuild-status');
  const button = page.getByTestId('rebuild-button');
  await expect(status).toHaveText('Add photos to build a preview');
  await expect(button).toBeDisabled();

  await upload(page, set50(3));
  await expect(status).toHaveText('Preview is up to date');
  const before = (await getTimeline(page)).duration;

  const d = page.locator('#set-duration');
  await d.fill(String(before + 4));
  await d.press('Enter');
  await expect(status).toHaveText('Settings changed');
  await expect(page.getByTestId('preview-stale')).toBeVisible();
  expect((await getTimeline(page)).duration).toBe(before); // preview still shows the last build

  await button.click();
  await expect(status).toHaveText('Preview is up to date');
  await expect(page.getByTestId('preview-stale')).toHaveCount(0);
  expect((await getTimeline(page)).duration).toBe(before + 4);

  // ⌘/Ctrl + Enter also rebuilds, committing a number field that still has focus.
  await d.fill(String(before + 6));
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(status).toHaveText('Preview is up to date');
  expect((await getTimeline(page)).duration).toBe(before + 6);

  // Loop is a playback toggle: it applies at once and never stages.
  const loop = (await getTimeline(page)).loop;
  await page.getByTestId('loop-toggle').click();
  await expect(status).toHaveText('Preview is up to date');
  expect((await getTimeline(page)).loop).toBe(!loop);
  expect(errors).toEqual([]);
});
