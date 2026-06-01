import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { type PlanProvider, plannerGrammar } from '@dawn-cut/core';

const exec = promisify(execFile);

// env 명명은 STT 사이드카(DAWN_WHISPER_BIN/DAWN_WHISPER_MODEL_PATH)를 미러한다.
// 호출 시점에 읽어 런타임 오버라이드(IPC/테스트 stub)를 반영한다.
const llamaBin = (): string => process.env.DAWN_LLAMA_BIN ?? 'vendor/llama.cpp/build/bin/llama-cli';
const llmModel = (): string =>
  process.env.DAWN_LLM_MODEL_PATH ?? 'vendor/llama.cpp/models/qwen2.5-1.5b-instruct-q4_k_m.gguf';

// 모델 존재 판정의 하한(부분 다운로드/심볼릭 placeholder 방어). 실모델은 ~1.0GB.
const MIN_MODEL_BYTES = 100 * 1024 * 1024;

// 콜드 스타트 실측 ~9s(로드 7.7s + 평가 1.6s)라 기본 타임아웃은 넉넉히.
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 256;
const DEFAULT_TEMPERATURE = 0.2;

export interface LlmStatus {
  available: boolean;
  binPath: string;
  modelPath: string;
  reason?: string;
}

/**
 * 로컬 LLM 사용 가능 여부를 동기로 점검(STT의 가용성 체크 미러).
 *
 * bin은 파일 존재만, model은 존재 + 크기>100MB(부분 다운로드 방어)로 확인한다.
 * 호출측이 룰 플래너로 폴백할 수 있게 절대 throw하지 않고 reason에 한국어 사유를 담는다.
 */
export function isLlmAvailable(): LlmStatus {
  const binPath = llamaBin();
  const modelPath = llmModel();

  if (!existsSync(binPath)) {
    return { available: false, binPath, modelPath, reason: `llama-cli 없음: ${binPath}` };
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

export interface LlmCompleteOpts {
  maxTokens?: number;
  timeoutMs?: number;
  grammar?: string;
  temperature?: number;
}

/**
 * Qwen2.5는 instruct(챗) 모델 → raw 프롬프트면 빈 배열 [] 만 나온다.
 * 반드시 ChatML로 감싸야 플래너 verb가 제대로 추론된다(메인 루프 실측 검증).
 */
function wrapChatMl(prompt: string): string {
  return `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`;
}

/**
 * llama-cli를 one-shot subprocess로 호출해 raw 완성 텍스트를 얻는다.
 *
 * 프롬프트는 ChatML로 감싸 `-f` 파일로, grammar(기본 plannerGrammar)는 `--grammar-file`로
 * 전달해 디코딩 단계에서 출력을 플래너 안전 부분집합으로 제약한다. 인자는 메인 루프가
 * llama.cpp b4589 + Qwen2.5-1.5B로 실측 검증한 조합을 그대로 사용한다.
 */
export async function llmComplete(
  prompt: string,
  opts: LlmCompleteOpts = {},
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
    '4096',
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
    // stdout만 캡처(완성 텍스트). 타이밍/배너는 stderr로 분리돼 나온다.
    const { stdout } = await exec(llamaBin(), args, {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    const ms = performance.now() - startedAt;
    return { text: cleanLlmOutput(stdout), ms };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
    if (e.killed || e.signal === 'SIGTERM') {
      throw new Error(`llama-cli 타임아웃(${timeoutMs}ms 초과)`);
    }
    throw new Error(`llama-cli 비정상 종료: ${e.message}`);
  } finally {
    // 임시파일 정리(실패 무시).
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * llama-cli stdout 정리(순수). trim 후 끝의 종료 마커('[end of text]', '</s>')와
 * 앞뒤 공백을 제거한다. 코드펜스는 core parsePlan이 JSON 배열을 추출하므로 손대지 않는다.
 */
export function cleanLlmOutput(raw: string): string {
  let text = raw.trim();
  // 끝 종료 마커는 반복 제거(둘 다/연달아 붙는 경우 방어).
  let changed = true;
  while (changed) {
    changed = false;
    for (const marker of ['[end of text]', '</s>']) {
      if (text.endsWith(marker)) {
        text = text.slice(0, -marker.length).trimEnd();
        changed = true;
      }
    }
  }
  return text.trim();
}

/**
 * core PlanProvider 호환 provider. 기본 grammar(plannerGrammar)로 동작하므로
 * core planAndPreview(nl, state, llmPlanProvider, plannerManifest())에 그대로 꽂힌다.
 */
export const llmPlanProvider: PlanProvider = (prompt) => llmComplete(prompt).then((r) => r.text);
