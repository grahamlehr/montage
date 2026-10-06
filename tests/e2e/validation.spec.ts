import { expect, test } from '@playwright/test';
import { openApp, set50, setSettings, upload } from './helpers/app.js';

test('too many photos for the length shows a validation error until fixed', async ({ page }) => {
  await openApp(page);
  await upload(page, set50(50));
  await setSettings(page, { pacing: 1, totalDuration: 10 });
  const err = page.getByTestId('validation-error');
  await expect(err).toBeVisible();
  await expect(err).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('export-button')).toBeDisabled();

  const d = page.locator('#set-duration');
  await d.fill('120');
  await d.press('Enter');
  await expect(err).toHaveCount(0);
  await expect(page.getByTestId('export-button')).toBeEnabled();
});
