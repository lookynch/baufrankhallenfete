import { defineConfig, devices } from '@playwright/test';

const localChromium = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8799',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: localChromium ? { executablePath: localChromium } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/smoke-test.ts --serve',
    url: 'http://127.0.0.1:8799/api/health',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },
});
