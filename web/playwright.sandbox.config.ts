import { defineConfig } from '@playwright/test';
/** Explicit opt-in only: uses the private, operator-configured Plaid Sandbox Item. */
export default defineConfig({
  testDir: './checks',
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3003',
    headless: true,
    screenshot: 'only-on-failure',
  },
  outputDir: 'work/plaid-browser-results',
  webServer: {
    command: 'npm start -- --hostname 127.0.0.1 --port 3003',
    url: 'http://127.0.0.1:3003',
    reuseExistingServer: false,
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      PENNYAHEAD_PLAID_SANDBOX_ENABLED: 'true',
      PENNYAHEAD_ASSISTANT: 'mock',
      PENNYAHEAD_MONITOR_DB: 'work/plaid-browser-monitor.sqlite',
    },
    timeout: 30000,
  },
});
