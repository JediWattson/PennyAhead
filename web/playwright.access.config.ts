import { defineConfig } from '@playwright/test';
import { createHash } from 'node:crypto';

// Public test fixtures only. Never use these credentials for a deployment.
export default defineConfig({
  testDir: './access-e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3003',
    headless: true,
    screenshot: 'only-on-failure',
  },
  outputDir: 'work/access-results',
  webServer: {
    command: 'npm start -- --hostname 127.0.0.1 --port 3003',
    url: 'http://127.0.0.1:3003/api/health',
    reuseExistingServer: false,
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      PENNYAHEAD_MONITOR_DB: 'work/access-monitor.sqlite',
      PENNYAHEAD_ASSISTANT: 'mock',
      PENNYAHEAD_PLAID_SANDBOX_ENABLED: 'false',
      PENNYAHEAD_ACCESS_MODE: 'required',
      PENNYAHEAD_INVITE_HASHES: createHash('sha256')
        .update('a'.repeat(43))
        .digest('hex'),
      PENNYAHEAD_ACCESS_SECRET: 'b'.repeat(64),
    },
    timeout: 30000,
  },
});
