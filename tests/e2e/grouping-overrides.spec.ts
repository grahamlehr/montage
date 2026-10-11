import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, openApp, rebuild, setSettings, tiles, trackErrors, upload } from './helpers/app.js';
import { getTimeline } from './helpers/frames.js';

const s50 = (n: number) => path.join(FIXTURES, 'set50', `photo-${String(n).padStart(2, '0')}.jpg`);
// P P L L P
const PHOTOS = [s50(3), s50(6), s50(1), s50(2), s50(9)];

const selectPhoto = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^Select photo ${n}:`) }).click();
const shotPos = (page: Page) => tiles(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-shot-pos') ?? '-'));
const layouts = async (page: Page) => (await getTimeline(page)).segments.map((s) => s.layout);

test('Keep solo / Join with next change grouping; joined photos lock the transition select', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await upload(page, PHOTOS);
  await setSettings(page, { width: 1920, height: 1080, totalDuration: 12 });
  await page.getByTestId('grouping-auto').click(); // already the default: may leave nothing to rebuild
  await rebuild(page);

  const transition = page.locator('#insp-transition');
  const group = page.locator('#insp-group');
  const joinedHint = page.getByTestId('transition-joined-hint');
  const summary = page.getByText(/^\d+ shots? · avg \d+\.\d s$/);

  // Default auto: photos 1+2 form a duo, the rest are single.
  expect(await shotPos(page)).toEqual(['start', 'end', '-', '-', '-']);
  expect(await layouts(page)).toEqual(['duo', 'single', 'single', 'single']);
  await expect(summary).toHaveText(/^4 shots/);
  await selectPhoto(page, 2);
  await expect(transition).toBeDisabled();
  await expect(joinedHint).toHaveText('Joined with the previous photo');
  await expect(transition).toHaveAttribute('aria-describedby', 'insp-transition-hint');
  await expect(page.getByTestId('group-hint')).toContainText('Duo shot (photo 2 of 2)');

  // Keep solo on photo 1 breaks the pair; photo 2 then owns its transition again.
  await selectPhoto(page, 1);
  await group.selectOption('solo');
  await expect.poll(() => shotPos(page)).toEqual(['-', '-', '-', '-', '-']);
  expect(await layouts(page)).toEqual(['single', 'single', 'single', 'single', 'single']);
  await expect(summary).toHaveText(/^5 shots/);
  await selectPhoto(page, 2);
  await expect(transition).toBeEnabled();
  await expect(joinedHint).toHaveCount(0);

  // Join with next on photo 3 (landscape, would never auto-group in 16:9) pairs 3+4.
  await selectPhoto(page, 3);
  await group.selectOption('joinNext');
  await expect.poll(() => shotPos(page)).toEqual(['-', '-', 'start', 'end', '-']);
  expect(await layouts(page)).toEqual(['single', 'single', 'duo', 'single']);
  await expect(summary).toHaveText(/^4 shots/);
  await expect(transition).toBeEnabled(); // first photo of its shot
  await selectPhoto(page, 4);
  await expect(transition).toBeDisabled();
  await expect(joinedHint).toBeVisible();

  // Chain: photo 4 joinNext as well → trio 3+4+5.
  await group.selectOption('joinNext');
  await expect.poll(() => shotPos(page)).toEqual(['-', '-', 'start', 'mid', 'end']);
  expect(await layouts(page)).toEqual(['single', 'single', 'trio']);
  await selectPhoto(page, 5);
  await expect(transition).toBeDisabled();
  await expect(page.locator('#insp-group option[value=joinNext]')).toBeDisabled(); // last photo

  // Grouping off ignores overrides entirely (invariant 1) and re-enables every transition select.
  await page.getByTestId('grouping-off').click();
  await page.getByTestId('rebuild-button').click();
  await expect.poll(() => shotPos(page)).toEqual(['-', '-', '-', '-', '-']);
  expect(await layouts(page)).toEqual(['single', 'single', 'single', 'single', 'single']);
  await selectPhoto(page, 4);
  await expect(transition).toBeEnabled();
  await expect(page.getByTestId('group-hint')).toContainText('Grouping is off');
  expect(errors).toEqual([]);
});
