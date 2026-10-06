import { defineConfig } from '@playwright/test';

// Playwright's bundled Chromium has no H.264 encoder — always use installed Google Chrome.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 5 * 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    channel: 'chrome',
    headless: !!process.env.PW_HEADLESS,
    baseURL: 'http://localhost:5173',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
