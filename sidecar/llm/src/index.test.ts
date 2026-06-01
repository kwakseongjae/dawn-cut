import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanLlmOutput, isLlmAvailable } from './index.js';

afterEach(() => {
  // env 복원(다른 테스트에 누수 방지). stubEnv는 unset 복원도 정확히 처리한다.
  vi.unstubAllEnvs();
});

describe('isLlmAvailable — 가용성 점검(절대 throw 금지)', () => {
  it('존재하지 않는 경로면 available:false + 비어있지 않은 reason', () => {
    vi.stubEnv('DAWN_LLAMA_BIN', '/nope/does-not-exist/llama-cli');
    vi.stubEnv('DAWN_LLM_MODEL_PATH', '/nope/does-not-exist/model.gguf');
    const status = isLlmAvailable();
    expect(status.available).toBe(false);
    expect(status.reason).toBeTruthy();
    expect(status.reason?.length).toBeGreaterThan(0);
    expect(status.binPath).toBe('/nope/does-not-exist/llama-cli');
    expect(status.modelPath).toBe('/nope/does-not-exist/model.gguf');
  });
});

describe('cleanLlmOutput — stdout 정리(순수)', () => {
  it("' [{...}] [end of text]' → 끝 마커/공백 제거", () => {
    const raw = ' [{"type":"applyColorgrade","preset":"cinematic"}] [end of text]';
    expect(cleanLlmOutput(raw)).toBe('[{"type":"applyColorgrade","preset":"cinematic"}]');
  });

  it("'</s>' 종료 마커 제거", () => {
    expect(cleanLlmOutput('[]</s>')).toBe('[]');
    expect(cleanLlmOutput('[]  </s>  ')).toBe('[]');
  });

  it('연달아 붙은 마커도 모두 제거', () => {
    expect(cleanLlmOutput('[] [end of text]</s>')).toBe('[]');
  });

  it('정상 JSON은 그대로(trim만)', () => {
    expect(cleanLlmOutput('  [{"type":"removeFillers"}]  ')).toBe('[{"type":"removeFillers"}]');
  });

  it('빈 케이스', () => {
    expect(cleanLlmOutput('')).toBe('');
    expect(cleanLlmOutput('   [end of text]  ')).toBe('');
  });
});
