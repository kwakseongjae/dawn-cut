import { defineConfig } from 'vitest/config';

// Demo runner: exercises the full pipeline on demo/ assets, writing real
// outputs to demo-output/. Not part of `pnpm verify` (it's a manual demo).
export default defineConfig({
  test: {
    name: 'demo',
    include: ['tests/demo/**/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
