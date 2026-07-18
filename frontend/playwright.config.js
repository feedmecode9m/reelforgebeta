/** @type {import('@playwright/test').PlaywrightTestConfig} */
import fs from 'node:fs';

const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const launchOptions = fs.existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {};

const config = {
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL || process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app',
    headless: true,
    trace: 'off',
    launchOptions
  },
  projects: [{ name: 'chromium', use: {} }]
};

export default config;
