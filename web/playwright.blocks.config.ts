import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'blocks.spec.ts', workers: 1,
  timeout: 45_000, outputDir: './e2e/.artifacts/blocks',
  use: {
    ...devices['Desktop Chrome'], channel: process.platform === 'win32' ? 'msedge' : 'chromium',
    baseURL: 'http://127.0.0.1:4198', viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  // This suite exercises editing without requiring numerical initialization.
  // State seeding imports the dev modules; all interactions use real UI events.
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4198 --strictPort',
    url: 'http://127.0.0.1:4198', reuseExistingServer: false,
  },
});
