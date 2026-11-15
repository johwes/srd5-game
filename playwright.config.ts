import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Locate system-installed chromium binary if available
const chromiumExecutable = [
  process.env.CHROMIUM_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].find((p) => p && fs.existsSync(p));

export default defineConfig({
  testDir: './packages/client/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 800 }, // Steam Deck native 16:10 resolution
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: chromiumExecutable
      ? {
          executablePath: chromiumExecutable,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        }
      : undefined,
  },
  projects: [
    {
      name: 'steam-deck-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter @srd5/client run dev --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
