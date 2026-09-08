import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    headless: true,
    screenshot: 'only-on-failure',
  },
  outputDir: 'work/playwright-results',
  webServer: {
    command: 'npm start -- --hostname 127.0.0.1 --port 3001',
    url: 'http://127.0.0.1:3001',
    reuseExistingServer: false,
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      PENNYAHEAD_MONITOR_DB: 'work/e2e-monitor.sqlite',
    },
    timeout: 30000,
  },
});
