import { expect, type Download, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const FIXTURES = path.join(ROOT, 'fixtures');
export const OUT_DIR = path.join(ROOT, 'tmp', 'e2e');

export function set50(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const k = String(i + 1).padStart(2, '0');
    return path.join(FIXTURES, 'set50', `photo-${k}.${(i + 1) % 10 === 0 ? 'heic' : 'jpg'}`);
  });
}
export const fixture = (name: string): string => path.join(FIXTURES, name);

/** Collect console errors / page errors for the lifetime of the page. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    // Failed subresource loads are reported separately (with URL) below so a missing favicon can be ignored.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/i.test(r.url())) errors.push(`${r.status()} ${r.url()}`);
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('file-input')).toBeAttached();
}

export const tiles = (page: Page) => page.locator('li.mt-tile');

/** Upload files and wait until every tile has settled (no "Loading…"). Returns once `expectedTiles` tiles exist. */
export async function upload(page: Page, files: string[], expectedTiles = files.length): Promise<void> {
  await page.getByTestId('file-input').setInputFiles(files);
  await expect(tiles(page)).toHaveCount(expectedTiles, { timeout: 120_000 });
  await expect(page.locator('li.mt-tile .mt-tile-status', { hasText: 'Loading' })).toHaveCount(0, {
    timeout: 180_000,
  });
}

export async function setSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((p) => {
    const m = (
      window as unknown as {
        __montage: { store: { getState(): { setSettings(p: Record<string, unknown>): void } } };
      }
    ).__montage;
    m.store.getState().setSettings(p);
  }, patch);
}

/** Set dims/fps/duration through the real inputs. */
export async function setViaInputs(
  page: Page,
  o: { width: number; height: number; fps: number; seconds: number },
): Promise<void> {
  // Unlock aspect ratio if it is locked so width/height are independent.
  const lock = page.getByLabel('Lock aspect ratio');
  if ((await lock.count()) && (await lock.getAttribute('aria-pressed')) === 'true') await lock.click();
  const w = page.locator('#set-width');
  await w.fill(String(o.width));
  await w.press('Enter');
  const h = page.locator('#set-height');
  await h.fill(String(o.height));
  await h.press('Enter');
  await page.locator('#set-fps').selectOption(String(o.fps));
  const d = page.locator('#set-duration');
  await d.fill(String(o.seconds));
  await d.press('Enter');
}

export async function exportAndDownload(
  page: Page,
  timeoutMs: number,
): Promise<{ file: string; name: string; download: Download }> {
  mkdirSync(OUT_DIR, { recursive: true });
  const dl = page.waitForEvent('download', { timeout: timeoutMs });
  await page.getByTestId('export-button').click();
  const download = await dl;
  const name = download.suggestedFilename();
  const file = path.join(OUT_DIR, `${Date.now()}-${name}`);
  await download.saveAs(file);
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
  return { file, name, download };
}

export async function expectResultMeta(page: Page): Promise<void> {
  const r = page.getByTestId('export-result');
  await expect(r).toBeVisible();
  expect(await r.getAttribute('data-codec')).toBeTruthy();
  expect(['hardware', 'software']).toContain((await r.getAttribute('data-encoder-path')) ?? '');
}
