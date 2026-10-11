// Renders docs/og/og.html to docs/og/og.png at 1200×630 using installed Google Chrome.
// Usage: node docs/og/render.mjs
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const html = new URL('./og.html', import.meta.url);
const png = fileURLToPath(new URL('./og.png', import.meta.url));

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(html.href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: png });
await browser.close();
console.log(png);
