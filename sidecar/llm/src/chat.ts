// 공유 헬퍼/설정 — index.ts(one-shot CLI)와 server.ts(상주 서버)가 함께 쓴다.
// 순환 import를 피하려 ChatML 래핑·출력 정리·env 경로/상수를 한 곳에 모은다.

// env는 호출 시점에 읽어 런타임 오버라이드(IPC/테스트 stub)를 반영한다(STT는 로드시점 상수).
export const llamaBin = (): string =>
  process.env.DAWN_LLAMA_BIN ?? 'vendor/llama.cpp/build/bin/llama-cli';
export const llamaServerBin = (): string =>
  process.env.DAWN_LLAMA_SERVER_BIN ?? 'vendor/llama.cpp/build/bin/llama-server';
export const llmModel = (): string =>
  process.env.DAWN_LLM_MODEL_PATH ?? 'vendor/llama.cpp/models/qwen2.5-1.5b-instruct-q4_k_m.gguf';

/** 상주 서버 포트(기본 8127). 외부 관리 서버는 DAWN_LLAMA_SERVER_URL 로 우선 사용. */
export const serverPort = (): number => Number(process.env.DAWN_LLAMA_PORT ?? '8127');
/** 외부에서 띄운 llama-server URL(있으면 spawn 생략). 테스트/파워유저용. */
export const externalServerUrl = (): string | null =>
  process.env.DAWN_LLAMA_SERVER_URL?.replace(/\/+$/, '') ?? null;

/** 실행 경로 선택: 'server'(상주, 기본) | 'cli'(one-shot). e2e/CI는 cli로 결정성 확보 가능. */
export const llmMode = (): 'server' | 'cli' =>
  process.env.DAWN_LLM_MODE === 'cli' ? 'cli' : 'server';

// 모델 존재 판정의 하한(부분 다운로드/placeholder 방어). 실모델은 ~1.0GB.
export const MIN_MODEL_BYTES = 100 * 1024 * 1024;
// CLI 콜드 스타트 실측 ~9s(로드 7.7s + 평가 1.6s)라 기본 타임아웃은 넉넉히.
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_TOKENS = 256;
export const DEFAULT_TEMPERATURE = 0.2;
export const DEFAULT_CTX = 4096;

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
export function wrapChatMl(prompt: string): string {
  return `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`;
}

/**
 * LLM 출력 정리(순수). trim 후 끝의 종료 마커('[end of text]', '</s>')와 공백을 제거한다.
 * 코드펜스는 core parsePlan이 JSON 배열을 추출하므로 손대지 않는다(서버 .content는 보통 이미 깨끗).
 */
export function cleanLlmOutput(raw: string): string {
  let text = raw.trim();
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
