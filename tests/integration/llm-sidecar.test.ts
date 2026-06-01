import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
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

describe('LLM 사이드카 — CLI one-shot(가짜 바이너리)', () => {
  it('llmComplete(CLI 모드) → JSON.parse 가능, applyColorgrade/cinematic, clipId 없음', async () => {
    vi.stubEnv('DAWN_LLM_MODE', 'cli'); // 상주 서버 대신 가짜 CLI 경로 강제.
    vi.stubEnv('DAWN_LLAMA_BIN', installFakeCli());
    const { text, ms } = await llmComplete('아무 프롬프트');
    expect(ms).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(parsed[0]?.type).toBe('applyColorgrade');
    expect(parsed[0]?.preset).toBe('cinematic');
    expect(parsed[0]).not.toHaveProperty('clipId');
  });

  it('end-to-end: planAndPreview(nl, state, llmPlanProvider, plannerManifest()) → applyColorgrade', async () => {
    vi.stubEnv('DAWN_LLM_MODE', 'cli');
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

describe('LLM 사이드카 — 상주 서버(가짜 HTTP /completion)', () => {
  let srv: Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => (srv ? srv.close(() => resolve()) : resolve()));
    srv = null;
  });

  // 가짜 llama-server: POST /completion 에 plannerGrammar 준수 JSON을 content로 돌려준다.
  // DAWN_LLAMA_SERVER_URL 이 설정되면 ensureServer는 spawn 없이 이 URL을 그대로 쓴다.
  async function startFakeServer(content: string): Promise<string> {
    srv = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/completion') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ content }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => srv?.listen(0, '127.0.0.1', resolve));
    const addr = srv?.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    return `http://127.0.0.1:${addr.port}`;
  }

  it('llmComplete(서버 모드) → 외부 /completion content를 정리해 반환', async () => {
    const url = await startFakeServer('[{"type":"applyColorgrade","preset":"warm"}] [end of text]');
    vi.stubEnv('DAWN_LLAMA_SERVER_URL', url); // 외부 서버 사용(spawn 안 함).
    const { text } = await llmComplete('따뜻하게 해줘');
    const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(parsed[0]?.type).toBe('applyColorgrade');
    expect(parsed[0]?.preset).toBe('warm');
  });

  it('end-to-end(서버 모드): planAndPreview → 복합 plan(색보정+자막)', async () => {
    const url = await startFakeServer(
      '[{"type":"applyColorgrade","preset":"warm"},{"type":"replaceSubtitleStyle","style":{"color":"yellow"}}]',
    );
    vi.stubEnv('DAWN_LLAMA_SERVER_URL', url);
    const { plan } = await planAndPreview(
      '따뜻하게 하고 자막 노랗게',
      emptyState(),
      llmPlanProvider,
      plannerManifest(),
    );
    expect(plan.map((c) => c.type)).toEqual(['applyColorgrade', 'replaceSubtitleStyle']);
  });
});
