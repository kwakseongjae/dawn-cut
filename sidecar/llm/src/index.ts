import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { type PlanProvider, plannerGrammar } from '@dawn-cut/core';
import {
  DEFAULT_CTX,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT_MS,
  type LlmCompleteOpts,
  MIN_MODEL_BYTES,
  cleanLlmOutput,
  externalServerUrl,
  llamaBin,
  llamaServerBin,
  llmMode,
  llmModel,
  wrapChatMl,
} from './chat.js';
import { ensureServer, isServerRunning, serverComplete, shutdownServer } from './server.js';

const exec = promisify(execFile);

export type { LlmCompleteOpts };
export { cleanLlmOutput, isServerRunning };

export interface LlmStatus {
  available: boolean;
  binPath: string;
  modelPath: string;
  reason?: string;
}

/**
 * 로컬 LLM 사용 가능 여부를 동기로 점검(STT의 가용성 체크 미러).
 *
 * 모델은 존재 + 크기>100MB(부분 다운로드 방어), 바이너리는 상주 서버 또는 one-shot CLI 중
 * 하나라도 있으면 OK. 외부 서버(DAWN_LLAMA_SERVER_URL)가 설정돼 있으면 바이너리 없이도 가용.
 * 호출측이 룰 플래너로 폴백할 수 있게 절대 throw하지 않고 reason에 한국어 사유를 담는다.
 */
export function isLlmAvailable(): LlmStatus {
  const serverBin = llamaServerBin();
  const cliBin = llamaBin();
  const modelPath = llmModel();

  // 외부 서버를 쓰면 로컬 바이너리/모델 점검을 건너뛴다(원격이 책임).
  if (externalServerUrl()) {
    return { available: true, binPath: externalServerUrl() ?? '', modelPath };
  }
  // 모드-인지: cli 모드는 cli 바이너리 필수. server 모드는 server 필수(없으면 CLI 폴백 가능하니 cli도 허용).
  const cli = llmMode() === 'cli';
  const hasBin = cli ? existsSync(cliBin) : existsSync(serverBin) || existsSync(cliBin);
  const binPath = cli ? cliBin : existsSync(serverBin) ? serverBin : cliBin;

  if (!hasBin) {
    return { available: false, binPath, modelPath, reason: `llama 바이너리 없음: ${binPath}` };
  }
  if (!existsSync(modelPath)) {
    return { available: false, binPath, modelPath, reason: `모델 없음: ${modelPath}` };
  }
  const bytes = statSync(modelPath).size;
  if (bytes < MIN_MODEL_BYTES) {
    return {
      available: false,
      binPath,
      modelPath,
      reason: `모델 손상 의심(크기 ${bytes}B < 100MB): ${modelPath}`,
    };
  }
  return { available: true, binPath, modelPath };
}

/**
 * llama-cli one-shot 호출(콜드 ~9s). 상주 서버를 못 쓰는 환경의 폴백 경로.
 * 프롬프트는 ChatML로 감싸 -f 파일로, grammar(기본 plannerGrammar)는 --grammar-file 로 전달.
 */
async function cliComplete(
  prompt: string,
  opts: LlmCompleteOpts,
): Promise<{ text: string; ms: number }> {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  const grammar = opts.grammar ?? plannerGrammar();

  const dir = mkdtempSync(join(tmpdir(), 'dawn-llm-'));
  const promptPath = join(dir, 'prompt.txt');
  const grammarPath = join(dir, 'grammar.gbnf');
  writeFileSync(promptPath, wrapChatMl(prompt), 'utf8');
  writeFileSync(grammarPath, grammar, 'utf8');

  // 검증된 인자: -ngl 99(Metal offload), -no-cnv(대화모드 끔),
  // --no-display-prompt(프롬프트 에코 끔), --simple-io(subprocess 호환 IO).
  const args = [
    '-m',
    llmModel(),
    '-f',
    promptPath,
    '--grammar-file',
    grammarPath,
    '-n',
    String(maxTokens),
    '-c',
    String(DEFAULT_CTX),
    '--temp',
    String(temperature),
    '-ngl',
    '99',
    '-no-cnv',
    '--no-display-prompt',
    '--simple-io',
  ];

  const startedAt = performance.now();
  try {
    const { stdout } = await exec(llamaBin(), args, {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { text: cleanLlmOutput(stdout), ms: performance.now() - startedAt };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
    if (e.killed || e.signal === 'SIGTERM') {
      throw new Error(`llama-cli 타임아웃(${timeoutMs}ms 초과)`);
    }
    throw new Error(`llama-cli 비정상 종료: ${e.message}`);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * 로컬 LLM 추론. 기본은 상주 서버(웜 ~0.1–0.5s); 서버 기동 실패 시 one-shot CLI로 폴백.
 * DAWN_LLM_MODE=cli 면 처음부터 CLI만 쓴다(결정성/디버깅). 모두 실패하면 throw(호출측 룰 폴백).
 */
export async function llmComplete(
  prompt: string,
  opts: LlmCompleteOpts = {},
): Promise<{ text: string; ms: number }> {
  if (llmMode() === 'cli') return cliComplete(prompt, opts);

  const total = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = performance.now();
  try {
    return await serverComplete(prompt, { ...opts, timeoutMs: total });
  } catch (e) {
    // 외부 서버 모드는 CLI 폴백 금지 — 원래 오류를 보존해야 디버깅 가능(로컬 바이너리도 없을 수 있음).
    if (externalServerUrl()) throw e;
    // 상주 서버 실패 → one-shot CLI 폴백. 단 남은 예산만 줘서 총 대기를 timeoutMs로 제한(이중 타임아웃 방지).
    const remaining = Math.max(2_000, total - (performance.now() - startedAt));
    // 폴백 사유를 남겨 '왜 느린지' 진단 가능하게(noConsole 규칙 비활성).
    console.warn(`[llm] 상주 서버 경로 실패 → CLI 폴백: ${e instanceof Error ? e.message : e}`);
    return cliComplete(prompt, { ...opts, timeoutMs: remaining });
  }
}

/**
 * 상주 서버를 미리 기동해 모델을 로드해 둔다(앱 마운트 시 호출 → 첫 사용자 요청이 즉시 빠름).
 * 실패해도 throw하지 않는다(가용성/사유만 보고; 실제 추론 때 CLI 폴백).
 */
export async function warmupLlm(): Promise<{ ready: boolean; ms: number; reason?: string }> {
  if (llmMode() === 'cli') return { ready: false, ms: 0, reason: 'CLI 모드(서버 미사용)' };
  const t = performance.now();
  try {
    await ensureServer();
    return { ready: true, ms: performance.now() - t };
  } catch (e) {
    return {
      ready: false,
      ms: performance.now() - t,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 상주 서버 종료(Electron app 'will-quit'에서 호출). */
export function shutdownLlm(): void {
  shutdownServer();
}

/**
 * core PlanProvider 호환 provider. 기본 grammar(plannerGrammar)로 동작하므로
 * core planAndPreview(nl, state, llmPlanProvider, plannerManifest())에 그대로 꽂힌다.
 */
export const llmPlanProvider: PlanProvider = (prompt) => llmComplete(prompt).then((r) => r.text);
