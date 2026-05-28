import { defineConfig } from '@playwright/test';

// Demo-only: drives the real app with demo/ assets and captures screenshots.
// Separate from playwright.config.ts so it never runs during `pnpm verify`.
export default defineConfig({
  testDir: 'tests/demo',
  testMatch: '**/*.spec.ts',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
});
