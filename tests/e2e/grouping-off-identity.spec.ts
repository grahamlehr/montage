import { expect, test, type Browser, type Page } from '@playwright/test';
import { assertMontage } from './helpers/ffprobe.js';
import { exportAndDownload, fixture, set50, setSettings, skipFirstVisit, upload } from './helpers/app.js';
import { frameMd5s, psnrAvg, seekPreview } from './helpers/frames.js';

/**
 * Invariant 1 (docs/proposals/multi-photo-shots.md §3): with `grouping: 'off'` the branch must produce
 * exactly v1 main's output (the default is `'auto'`, so both sides pin `'off'`). Needs a dev server of `main` (e.g. a detached worktree of main running
 * `npx vite --port 5174` in a checkout of main); point MONTAGE_MAIN_URL at it. CI skips it.
 */
const MAIN = process.env.MONTAGE_MAIN_URL;
test.skip(!MAIN, 'Set MONTAGE_MAIN_URL to a dev server of main (e.g. http://localhost:5174) to run the identity check.');

// Mixed orientations, HEIC, EXIF rotation and a panorama, so grouping *would* fire if it weren't off.
const PHOTOS = [
  ...set50(4),
  fixture('portrait.jpg'),
  fixture('portrait.heic'),
  fixture('exif-rotated.jpg'),
  fixture('panorama.jpg'),
];
const BASE = { width: 1280, height: 720, fps: 30, totalDuration: 10, motionIntensity: 1, seed: 7, background: '#204060' };
const TRANSITIONS = ['crossfade', 'slideLeft', 'zoom', 'blur'];
const TIMES = [0.6, 3.1, 7.4]; // inside a hold, a transition and a late hold

async function run(browser: Browser, base: string, patch: Record<string, unknown>) {
  const ctx = await browser.newContext({ baseURL: base, acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
  const page: Page = await ctx.newPage();
  await skipFirstVisit(page);
  await page.goto('/');
  await expect(page.getByTestId('file-input')).toBeAttached();
  await upload(page, PHOTOS);
  await setSettings(page, { ...BASE, ...patch, transitionPool: TRANSITIONS });
  await expect(page.getByTestId('export-button')).toBeEnabled();
  const preview: string[] = [];
  for (const t of TIMES) preview.push(await seekPreview(page, t));
  const { file } = await exportAndDownload(page, 4 * 60_000);
  await ctx.close();
  return { preview, file };
}

for (const fit of ['cover', 'contain', 'blur'] as const) {
  test(`grouping off: ${fit} export + preview identical to main`, async ({ browser, baseURL }) => {
    test.setTimeout(8 * 60_000);
    const ref = await run(browser, MAIN!, { fit, grouping: 'off' });
    const cur = await run(browser, baseURL!, { fit, grouping: 'off' });
    assertMontage(cur.file, { width: 1280, height: 720, fps: 30, seconds: 10 });

    const a = frameMd5s(ref.file);
    const b = frameMd5s(cur.file);
    expect(b.length).toBe(a.length);
    const differing = b.map((h, i) => (h === a[i] ? -1 : i)).filter((i) => i >= 0);
    console.log(`${fit}: ${a.length} frames, ${differing.length} differ; psnr=${psnrAvg(ref.file, cur.file)}`);
    for (const t of TIMES) expect(b[Math.round(t * 30)], `frame at ${t}s`).toBe(a[Math.round(t * 30)]);
    expect(differing).toEqual([]);
    expect(new Set(cur.preview).size, 'preview samples differ from each other (not blank)').toBe(TIMES.length);
    expect(cur.preview).toEqual(ref.preview);
  });
}
