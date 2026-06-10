import { defineConfig } from 'vitest/config';

// Integration layer (G1/G2/G5/G7): exercises real FFmpeg / whisper.cpp
// against fixtures. Deterministic via fixtures only; no network at runtime.
export default defineConfig({
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    globalSetup: './tests/global-setup.ts', // artifacts/ 보장(CI fresh clone)
    testTimeout: 120_000, // whisper transcription can be slow
    hookTimeout: 120_000,
  },
});
