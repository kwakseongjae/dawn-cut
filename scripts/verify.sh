#!/usr/bin/env bash
# Single verification entry point (03-TEST-GATES §2).
# Exit code 0 == all runnable gates green == necessary condition for PoC completion.
# Layers run in order; first failure stops the run with a non-zero exit code.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p artifacts

fail() { echo "❌ VERIFY FAILED at: $1"; exit 1; }

echo "▶ [1/6] lint (biome)"
pnpm lint || fail "lint"

echo "▶ [2/6] boundary (core must stay platform-agnostic)"
pnpm boundary > artifacts/g0-boundary.txt 2>&1 || { cat artifacts/g0-boundary.txt; fail "boundary"; }
echo "  boundary report → artifacts/g0-boundary.txt"

echo "▶ [3/6] build (all packages)"
pnpm build || fail "build"

echo "▶ [4/6] unit tests (vitest)"
pnpm test:unit || fail "unit"

echo "▶ [5/6] E2E (Electron; vertical-slice self-skips if whisper unbuilt)"
pnpm --filter @dawn-cut/desktop build || fail "desktop build"
pnpm exec playwright test || fail "e2e"

# Integration gates need fixtures + real ffmpeg. whisper-dependent tests
# self-skip at runtime when the binary is absent (it.skipIf), so we run the
# suite whenever the fixture exists.
if [ -f "fixtures/sample.mp4" ]; then
  echo "▶ [6/6] integration tests (real ffmpeg; whisper tests self-skip if unbuilt)"
  pnpm test:int || fail "integration"
else
  echo "▶ [6/6] integration — SKIPPED (run 'pnpm make:fixture' first)"
fi

echo "✅ verify passed"
