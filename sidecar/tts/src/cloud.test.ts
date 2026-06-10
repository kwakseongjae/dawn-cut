import { describe, expect, it } from 'vitest';
import {
  CLOUD_VOICES,
  SIGNATURE_VOICE_ID,
  buildElevenRequest,
  buildInstructions,
  buildSpeechRequest,
  cloudVoiceById,
} from './cloud.js';

describe('클라우드 TTS — 순수 헬퍼 (네트워크 없음)', () => {
  it("시그니처 보이스는 '던'(dawn)이고 카탈로그 첫 항목이다", () => {
    expect(SIGNATURE_VOICE_ID).toBe('dawn');
    expect(CLOUD_VOICES[0]!.id).toBe('dawn');
    expect(cloudVoiceById(undefined).id).toBe('dawn'); // 미지정 → 시그니처
    expect(cloudVoiceById('없는보이스').id).toBe('dawn'); // 모르는 id → 시그니처 폴백
  });

  it('모든 보이스가 한국어 최적화 기본 지시문을 가진다', () => {
    for (const v of CLOUD_VOICES) {
      expect(v.baseInstructions).toMatch(/한국어/);
      expect(v.openaiVoice.length).toBeGreaterThan(0);
    }
  });

  it('rate(wpm)·스타일이 지시문에 결정적으로 반영된다 (say와 동일 규약)', () => {
    const v = cloudVoiceById('dawn');
    expect(buildInstructions(v, 120)).toMatch(/느긋하게/);
    expect(buildInstructions(v, 260)).toMatch(/빠르고/);
    expect(buildInstructions(v, 180)).not.toMatch(/느긋하게|빠르고/); // 보통 속도 = 무첨가
    expect(buildInstructions(v, undefined, 'calm')).toMatch(/차분하고 절제/);
    expect(buildInstructions(v, undefined, 'lively')).toMatch(/활기차고 밝게/);
  });

  it('요청 본문: gpt-4o-mini-tts + wav + openai voice 매핑', () => {
    const req = buildSpeechRequest('안녕하세요', { apiKey: 'sk-x', voice: 'hojin', rate: 235 });
    expect(req.model).toBe('gpt-4o-mini-tts');
    expect(req.voice).toBe('onyx'); // hojin → onyx
    expect(req.input).toBe('안녕하세요');
    expect(req.response_format).toBe('wav');
    expect(req.instructions).toMatch(/묵직/);
  });

  it('결정성: 같은 입력 → 같은 요청', () => {
    const a = buildSpeechRequest('테스트', {
      apiKey: 'k',
      voice: 'haru',
      rate: 145,
      style: 'calm',
    });
    const b = buildSpeechRequest('테스트', {
      apiKey: 'k',
      voice: 'haru',
      rate: 145,
      style: 'calm',
    });
    expect(a).toEqual(b);
  });
});

describe('ElevenLabs eleven_v3 — 순수 헬퍼 (네트워크 없음)', () => {
  it("'던'을 포함한 모든 보이스가 ElevenLabs voice id 매핑을 가진다", () => {
    for (const v of CLOUD_VOICES) expect(v.elevenVoiceId.length).toBeGreaterThan(10);
  });

  it('기본 모델은 eleven_v3, 스타일 프리셋이 voice_settings로 결정적으로 매핑된다', () => {
    const calm = buildElevenRequest('안녕', { apiKey: 'k', voice: 'dawn', style: 'calm' });
    const lively = buildElevenRequest('안녕', { apiKey: 'k', voice: 'dawn', style: 'lively' });
    expect(calm.body.model_id).toBe('eleven_v3');
    expect(calm.voiceId).toBe(cloudVoiceById('dawn').elevenVoiceId);
    expect(calm.body.voice_settings.stability).toBeGreaterThan(
      lively.body.voice_settings.stability,
    );
    expect(lively.body.voice_settings.style).toBeGreaterThan(calm.body.voice_settings.style);
  });

  it('결정성: 같은 입력 → 같은 요청', () => {
    const a = buildElevenRequest('테스트', { apiKey: 'k', voice: 'hojin', style: 'normal' });
    const b = buildElevenRequest('테스트', { apiKey: 'k', voice: 'hojin', style: 'normal' });
    expect(a).toEqual(b);
  });
});

describe('OpenRouter TTS — 순수 헬퍼 (네트워크 없음)', () => {
  it('OpenAI 호환 요청 빌더 재사용 — 모델 prefix만 다르다', () => {
    const req = buildSpeechRequest('안녕', {
      apiKey: 'sk-or-x',
      voice: 'dawn',
      model: 'openai/gpt-4o-mini-tts',
    });
    expect(req.model).toBe('openai/gpt-4o-mini-tts');
    expect(req.voice).toBe('nova'); // dawn → nova (제공자 무관 동일 매핑)
    expect(req.instructions).toMatch(/한국어/);
  });
});
