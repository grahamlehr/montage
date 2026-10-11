import { expect, test } from '@playwright/test';
import { openApp, set50, tiles, upload } from './helpers/app.js';

const FIREFOX_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0';

test('desktop Chrome sees no unsupported-browser notice', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('browser-notice')).toHaveCount(0);
});

test('another browser gets a dismissible notice and can still use the app', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, userAgent: FIREFOX_UA });
  const page = await ctx.newPage();
  await page.goto('/');
  const notice = page.getByTestId('browser-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('only supported in Google Chrome on a desktop');

  await page.getByTestId('browser-notice-dismiss').click();
  await expect(notice).toBeHidden();
  await upload(page, set50(2));
  await expect(tiles(page)).toHaveCount(2);

  // Dismissal lasts for the browser session (survives a reload); Esc also closes it in a fresh session.
  await page.reload();
  await expect(page.getByTestId('file-input')).toBeAttached();
  await expect(page.getByTestId('browser-notice')).toHaveCount(0);
  const fresh = await ctx.newPage();
  await fresh.goto('/');
  await expect(fresh.getByTestId('browser-notice')).toBeVisible();
  await fresh.keyboard.press('Escape');
  await expect(fresh.getByTestId('browser-notice')).toBeHidden();
  await ctx.close();
});
