import { defineConfig } from '@playwright/test';

// E2E layer (G8) + G0 smoke. Drives the real Electron app.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    trace: 'on',
  },
});
