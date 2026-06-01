import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type EditorState,
  buildTranscriptModel,
  createInitialTimeline,
  planAndPreview,
  plannerManifest,
} from '@dawn-cut/core';
import { llmComplete, llmPlanProvider } from '@dawn-cut/sidecar-llm';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 가짜 llama-cli: 인자를 무시하고 plannerGrammar 준수(clipId 없음) JSON을 stdout에 낸다.
// 실제 모델 출력처럼 끝에 ' [end of text]' 마커를 붙여 cleanLlmOutput 경로까지 통과시킨다.
const FAKE_CLI = `#!/usr/bin/env node
process.stdout.write('[{"type":"applyColorgrade","preset":"cinematic"}] [end of text]');
`;

function installFakeCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dawn-llm-fake-'));
  const bin = join(dir, 'llama-cli');
  writeFileSync(bin, FAKE_CLI, 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

// state = createInitialTimeline + buildTranscriptModel([], ...) (전사 없는 최소 상태).
function emptyState(): EditorState {
  return {
    transcript: buildTranscriptModel([], 'm', 'ko'),
    timeline: createInitialTimeline('m', 5_000_000, 30),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('LLM 사이드카 — 가짜 바이너리 subprocess', () => {
  it('llmComplete → JSON.parse 가능, applyColorgrade/cinematic, clipId 없음', async () => {
    vi.stubEnv('DAWN_LLAMA_BIN', installFakeCli());
    const { text, ms } = await llmComplete('아무 프롬프트');
    expect(ms).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(parsed[0]?.type).toBe('applyColorgrade');
    expect(parsed[0]?.preset).toBe('cinematic');
    expect(parsed[0]).not.toHaveProperty('clipId');
  });

  it('end-to-end: planAndPreview(nl, state, llmPlanProvider, plannerManifest()) → applyColorgrade', async () => {
    vi.stubEnv('DAWN_LLAMA_BIN', installFakeCli());
    const state = emptyState();
    const { plan } = await planAndPreview(
      '시네마틱하게 만들어줘',
      state,
      llmPlanProvider,
      plannerManifest(),
    );
    expect(plan[0]?.type).toBe('applyColorgrade');
  });
});
