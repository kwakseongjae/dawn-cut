// 상주 llama-server 수명주기 + HTTP 추론. one-shot CLI(콜드 ~9s) 대비 웜 ~0.1–0.5s(실측).
//
// 설계: 모델을 한 번만 로드해 두고 /completion 으로 반복 추론한다. 첫 요청에 lazy-spawn,
// /health 폴링으로 준비를 기다리고, 이후 재사용. 프로세스 종료 시 best-effort로 정리한다.
// DAWN_LLAMA_SERVER_URL 이 있으면 spawn 없이 그 서버를 그대로 쓴다(테스트/파워유저).
import { type ChildProcess, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { plannerGrammar } from '@dawn-cut/core';
import {
  DEFAULT_CTX,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT_MS,
  type LlmCompleteOpts,
  cleanLlmOutput,
  externalServerUrl,
  llamaServerBin,
  llmModel,
  serverPort,
  wrapChatMl,
} from './chat.js';

interface ServerHandle {
  proc: ChildProcess;
  baseUrl: string;
  ready: Promise<void>;
}
let handle: ServerHandle | null = null;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 신호로 죽은 자식은 exitCode가 영원히 null이고 signalCode에만 신호가 들어간다 →
// exitCode만 보면 죽은 서버를 살아있다고 오판한다. 세 신호를 모두 본다.
const isAlive = (p: ChildProcess): boolean =>
  p.exitCode === null && p.signalCode === null && !p.killed;

/** 상주 서버가 살아있나(외부 서버 사용 시에도 true). */
export function isServerRunning(): boolean {
  return externalServerUrl() != null || (handle != null && isAlive(handle.proc));
}

/**
 * 상주 서버를 보장하고 baseUrl을 돌려준다(없으면 spawn + /health 대기, 있으면 재사용).
 * 외부 URL이 설정돼 있으면 그대로 반환. spawn 실패/health 타임아웃이면 정리 후 throw.
 */
export async function ensureServer(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
  const ext = externalServerUrl();
  if (ext) return ext;

  if (handle && isAlive(handle.proc)) {
    await handle.ready;
    return handle.baseUrl;
  }

  const port = serverPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = spawn(
    llamaServerBin(),
    [
      '-m',
      llmModel(),
      '-ngl',
      '99',
      '-c',
      String(DEFAULT_CTX),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--no-webui',
    ],
    { stdio: 'ignore' },
  );
  // self-heal: 서버가 (정상/신호로) 죽으면 핸들을 비워 다음 호출이 재기동하게 한다.
  // 안 그러면 죽은 baseUrl을 영원히 재사용 → 매 요청 실패 → 영구 CLI 폴백(느림).
  proc.once('exit', () => {
    if (handle?.proc === proc) handle = null;
  });
  const ready = waitHealthy(proc, baseUrl, timeoutMs);
  handle = { proc, baseUrl, ready };
  try {
    await ready;
  } catch (e) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    handle = null;
    throw e;
  }
  return baseUrl;
}

/** /health 가 ok 가 될 때까지 폴링. 프로세스가 먼저 죽으면 즉시 실패. */
async function waitHealthy(proc: ChildProcess, baseUrl: string, timeoutMs: number): Promise<void> {
  let exited = false;
  proc.once('exit', () => {
    exited = true;
  });
  proc.once('error', () => {
    exited = true;
  });
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (exited) throw new Error('llama-server 프로세스가 준비 전에 종료됨(바이너리/모델 확인)');
    try {
      // ★ per-request 타임아웃 필수: 포트를 'connect는 되나 HTTP 무응답'인 프로세스가
      // 점유하면 타임아웃 없는 fetch는 ~5분 블록돼 deadline이 무력화된다.
      const budget = Math.max(250, Math.min(2000, deadline - performance.now()));
      const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(budget) });
      if (r.ok) {
        const j = (await r.json().catch(() => null)) as { status?: string } | null;
        if (!j || j.status === 'ok') return;
      }
    } catch {
      // 아직 안 떴음/무응답/abort — 계속 폴링(deadline까지).
    }
    await delay(300);
  }
  throw new Error(`llama-server health 타임아웃(${timeoutMs}ms)`);
}

/**
 * 상주 서버 /completion 으로 raw 완성 텍스트를 얻는다(웜 ~0.1–0.5s).
 * 프롬프트는 ChatML로 감싸고, grammar(기본 plannerGrammar)와 cache_prompt 로 제약·가속한다.
 */
export async function serverComplete(
  prompt: string,
  opts: LlmCompleteOpts = {},
): Promise<{ text: string; ms: number }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = await ensureServer(timeoutMs);
  const startedAt = performance.now();
  const res = await fetch(`${base}/completion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: wrapChatMl(prompt),
      grammar: opts.grammar ?? plannerGrammar(),
      n_predict: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      cache_prompt: true,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`llama-server /completion ${res.status}`);
  const j = (await res.json()) as { content?: string };
  return { text: cleanLlmOutput(String(j.content ?? '')), ms: performance.now() - startedAt };
}

/** 상주 서버 종료(있으면). 우리가 spawn한 프로세스만 죽인다(외부 서버는 건드리지 않음). */
export function shutdownServer(): void {
  if (handle) {
    try {
      handle.proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    handle = null;
  }
}

// orphan 방지. 'exit'(정상 종료)는 동기 정리만 가능. 신호(SIGINT=dev Ctrl-C, SIGTERM=kill/
// 시스템 종료)는 'exit'를 발화시키지 않으므로 별도로 잡아 자식을 죽이고 신호를 재전달한다
// (once 핸들러는 발화 전 제거되므로 재전달 시 기본 종료 동작이 진행 — Electron 핸들러도 비파괴).
// SIGKILL/세그폴트는 어떤 핸들러로도 못 막는다(불가피한 orphan은 다음 기동의 self-heal로 회복).
process.once('exit', shutdownServer);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(sig, () => {
    shutdownServer();
    process.kill(process.pid, sig);
  });
}
