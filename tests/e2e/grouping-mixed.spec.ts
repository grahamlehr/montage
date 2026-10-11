import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { LayoutStyle, Segment } from '../../src/types.js';
import { assertMontage } from './helpers/ffprobe.js';
import { exportAndDownload, openApp, set50, setSettings, trackErrors, upload } from './helpers/app.js';
import { contactSheet, getTimeline, T16_DIR } from './helpers/frames.js';

const ALL: LayoutStyle[] = ['duo', 'trio', 'quad', 'pip', 'polaroid'];
const N = 40;
const SECONDS = 60;

for (const [W, H] of [
  [1080, 1920],
  [1920, 1080],
] as const) {
  test(`mixed + stagger, all five layouts, ${W}x${H}`, async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const errors = trackErrors(page);
    await openApp(page);
    await upload(page, set50(N));
    await setSettings(page, {
      width: W, height: H, fps: 30, totalDuration: SECONDS, fit: 'blur', motionIntensity: 0.8,
      transitionPool: ['crossfade', 'slideLeft', 'push', 'zoom', 'wipe'], selection: 'sequence',
    });
    // Real controls: Mixed, every layout chip on, Stagger.
    await page.getByTestId('grouping-mixed').click();
    for (const l of ALL) {
      const chip = page.getByTestId(`layout-${l}`);
      if ((await chip.getAttribute('aria-pressed')) !== 'true' && (await chip.getAttribute('aria-checked')) !== 'true') {
        await chip.click();
      }
    }
    await page.getByTestId('reveal-stagger').click();
    const s = await page.evaluate(() => window.__montage!.store.getState().settings);
    expect(s.grouping).toBe('mixed');
    expect([...s.layoutPool].sort()).toEqual([...ALL].sort());
    expect(s.reveal).toBe('stagger');

    // Grouping is seeded: take the first seed (from 1) whose timeline uses every layout.
    let seed = 1;
    let segs: Segment[] = [];
    for (; seed <= 40; seed++) {
      await setSettings(page, { seed });
      segs = (await getTimeline(page)).segments;
      if (ALL.every((l) => segs.some((g) => g.layout === l))) break;
    }
    const counts = Object.fromEntries(['single', ...ALL].map((l) => [l, segs.filter((g) => g.layout === l).length]));
    console.log(`${W}x${H} seed ${seed}: ${segs.length} shots`, JSON.stringify(counts));
    for (const l of ALL) expect(counts[l], `layout ${l} appears`).toBeGreaterThan(0);
    // Invariant 2: every photo exactly once, in order.
    expect(segs.flatMap((g) => g.cells.map((c) => c.photoIndex))).toEqual([...Array(N).keys()]);
    // Stagger actually staggers at least some multi-cell shots; cell 0 is always present from the start.
    const multi = segs.filter((g) => g.cells.length > 1);
    expect(multi.some((g) => g.cells.slice(1).some((c) => c.revealDuration > 0))).toBe(true);
    for (const g of segs) expect(g.cells[0]!.revealDuration).toBe(0);
    await expect(page.getByText(new RegExp(`^${segs.length} shots · avg \\d+\\.\\d s$`))).toBeVisible();

    const { file } = await exportAndDownload(page, 6 * 60_000);
    const r = assertMontage(file, { width: W, height: H, fps: 30, seconds: SECONDS });
    console.log(`ffprobe mixed ${W}x${H}:`, JSON.stringify(r));

    // Contact sheet: for each multi-photo shot, mid-reveal of cell 1 (if staggered), last reveal end and mid-hold,
    // plus the transition into it.
    const sheet: Array<{ t: number; caption: string }> = [];
    for (const [k, g] of segs.entries()) {
      if (g.cells.length < 2) continue;
      const tag = `#${k} ${g.layout} p${g.cells.map((c) => c.photoIndex + 1).join('+')}`;
      if (g.transitionIn) sheet.push({ t: g.transitionIn.start + g.transitionIn.duration / 2, caption: `${tag} ${g.transitionIn.style} mid` });
      const c1 = g.cells[1]!;
      if (c1.revealDuration > 0) sheet.push({ t: c1.revealStart + c1.revealDuration / 2, caption: `${tag} cell1 mid-reveal` });
      const last = g.cells[g.cells.length - 1]!;
      if (last.revealDuration > 0) sheet.push({ t: last.revealStart + last.revealDuration * 0.5, caption: `${tag} last cell mid-reveal` });
      const tIn = g.transitionIn ? g.transitionIn.start + g.transitionIn.duration : g.start;
      sheet.push({ t: Math.max(tIn, last.revealStart + last.revealDuration) + 0.05 + (g.end - tIn) * 0.25, caption: `${tag} hold` });
    }
    contactSheet(file, sheet, path.join(T16_DIR, `mixed-${W}x${H}`), 5, 360);
    expect(errors).toEqual([]);
  });
}
