import { defineConfig } from '@playwright/test';

// Playwright's bundled Chromium has no H.264 encoder — always use installed Google Chrome.

// E2E gets its own port (not the dev server's 5173) and its own server by default, so a dev server left
// running from another checkout or worktree is never silently tested. Override with E2E_PORT; set
// E2E_REUSE_SERVER=1 to reuse a server you started yourself on that port.
const PORT = Number(process.env.E2E_PORT ?? 5199);
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 5 * 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    channel: 'chrome',
    headless: !!process.env.PW_HEADLESS,
    baseURL: BASE,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
    timeout: 60_000,
  },
});
