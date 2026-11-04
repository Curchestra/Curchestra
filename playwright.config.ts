import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Wall-clock budgets run serially via `npm run test:perf` (R24).
  grepInvert: /@perf/,
  globalSetup: './tests/e2e/global-setup.ts',
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:5179' },
  webServer: {
    command: 'npx vite --config examples/vite.config.ts --port 5179 --strictPort',
    port: 5179,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
