import { defineConfig } from 'vitest/config';

// Unit layer (G3/G4/G6): pure-TS core + colocated component logic.
// Fully deterministic, no external binaries, no network.
export default defineConfig({
  test: {
    name: 'unit',
    include: ['packages/**/*.test.ts', 'sidecar/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/integration/**', 'tests/e2e/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**'],
      reportsDirectory: 'artifacts/coverage-core',
    },
  },
});
