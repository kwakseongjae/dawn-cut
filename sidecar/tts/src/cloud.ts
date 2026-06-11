// 클라우드 TTS (opt-in, BYOK) — OpenAI gpt-4o-mini-tts.
//
// 선정 근거(2026-06-10 리서치, issue #3):
//  - 가성비: ~$0.015/분(텍스트 $0.60/1M tok + 오디오 $12/1M tok) — ElevenLabs Flash($103/1M자)
//    대비 수십 배 저렴. 10분 보이스오버 ≈ 200원.
//  - 한국어/영어/CJK 모두 지원(whisper 계열 다국어 토크나이저).
//  - instructions로 말투(속도/감정/톤)를 텍스트로 조절 가능 → '던(Dawn)' 시그니처 보이스의 토대.
//  - BYOK 친화: 크리에이터/개발자에게 가장 보급된 키.
//
// 프라이버시 계약: 이 모듈은 '명시적 opt-in + 키 존재' 시에만 호출된다(기본 off).
// 전송되는 것은 TTS 원고 텍스트뿐 — 영상/오디오는 절대 기기를 떠나지 않는다.
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const FFMPEG = () => process.env.DAWN_FFMPEG ?? 'ffmpeg'; // lazy — 패키징 동봉 경로 주입 대응

export interface CloudVoice {
  /** dawn-cut 보이스 id(UI/프로젝트에 저장되는 값). */
  id: string;
  /** 사람이 읽는 라벨. */
  label: string;
  /** OpenAI voice 이름. */
  openaiVoice: string;
  /** ElevenLabs premade voice id(프론티어 eleven_v3 경로). 같은 '던' 브랜드가 양쪽에 매핑된다. */
  elevenVoiceId: string;
  /** Gemini TTS prebuilt voice 이름(OpenRouter google/gemini-* 경로 — 2026-05 Elo 1위). */
  geminiVoice: string;
  /** 기본 말투 지시(한국어 최적화). 스타일 프리셋이 덧붙는다. */
  baseInstructions: string;
}

/**
 * dawn-cut 클라우드 보이스 카탈로그 — '던(Dawn)'이 시그니처(CapCut의 Adam 포지션).
 * 보이스는 OpenAI 원음색 + 한국어 내레이션 최적화 instructions의 조합으로 브랜딩한다.
 */
export const CLOUD_VOICES: readonly CloudVoice[] = [
  {
    id: 'dawn',
    label: '던 (시그니처 · 또렷한 내레이션)',
    openaiVoice: 'nova',
    elevenVoiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel — 또렷한 내레이션
    geminiVoice: 'Zephyr', // bright·clear
    baseInstructions:
      '밝고 또렷한 한국어 내레이션. 유튜브 해설 톤으로 자연스럽게, 문장 끝을 흐리지 않고 명확하게 읽는다. 영어 단어는 자연스러운 외래어 발음으로.',
  },
  {
    id: 'seoyeon',
    label: '서연 (차분한 다큐)',
    openaiVoice: 'shimmer',
    elevenVoiceId: 'MF3mGyEYCl7XYWbV9V6O', // Elli — 차분·부드러움
    geminiVoice: 'Charon', // informative·calm
    baseInstructions: '차분하고 신뢰감 있는 한국어 다큐멘터리 내레이션. 또박또박, 약간 낮은 톤.',
  },
  {
    id: 'hojin',
    label: '호진 (묵직한 예고편)',
    openaiVoice: 'onyx',
    elevenVoiceId: 'pNInz6obpgDQGcFmaJgB', // Adam — 깊고 묵직
    geminiVoice: 'Orus', // firm·deep
    baseInstructions: '묵직하고 깊은 한국어 내레이션. 영화 예고편처럼 무게감 있게.',
  },
  {
    id: 'haru',
    label: '하루 (활기찬 쇼츠)',
    openaiVoice: 'coral',
    elevenVoiceId: 'AZnzlk1XvdvUeBnXmlld', // Domi — 에너지
    geminiVoice: 'Puck', // upbeat
    baseInstructions: '활기차고 에너지 넘치는 한국어 쇼츠 내레이션. 빠른 호흡, 친근한 말투.',
  },
] as const;

export const SIGNATURE_VOICE_ID = 'dawn';

export function cloudVoiceById(id: string | undefined): CloudVoice {
  return CLOUD_VOICES.find((v) => v.id === id) ?? CLOUD_VOICES[0]!;
}

export interface CloudTtsOpts {
  apiKey: string;
  /** dawn-cut 보이스 id(CLOUD_VOICES). 미지정 시 시그니처 '던'. */
  voice?: string;
  /** 말하기 속도(wpm; say와 동일 규약 120/180/260) → 말투 지시문으로 변환. */
  rate?: number;
  /** 스타일 프리셋(차분/보통/활기참) — UI 기존 규약. */
  style?: string;
  /** 모델 오버라이드(기본 gpt-4o-mini-tts). */
  model?: string;
}

/** rate(wpm)·스타일을 instructions 문장으로 결정적으로 변환(단위테스트 대상, 순수). */
export function buildInstructions(v: CloudVoice, rate?: number, style?: string): string {
  const parts = [v.baseInstructions];
  if (rate != null && rate > 0) {
    if (rate <= 140) parts.push('말 속도는 평소보다 느긋하게.');
    else if (rate >= 230) parts.push('말 속도는 빠르고 경쾌하게.');
  }
  if (style === 'calm') parts.push('감정은 차분하고 절제되게.');
  else if (style === 'lively') parts.push('감정은 활기차고 밝게.');
  return parts.join(' ');
}

/** OpenAI /v1/audio/speech 요청 본문(순수 — 단위테스트 대상). */
export function buildSpeechRequest(
  text: string,
  opts: CloudTtsOpts,
): { model: string; voice: string; input: string; instructions: string; response_format: string } {
  const v = cloudVoiceById(opts.voice);
  return {
    model: opts.model ?? 'gpt-4o-mini-tts',
    voice: v.openaiVoice,
    input: text,
    instructions: buildInstructions(v, opts.rate, opts.style),
    response_format: 'wav',
  };
}

export interface CloudTtsResult {
  wavPath: string;
  engine: 'cloud';
  /** dawn-cut 보이스 id(예: 'dawn'). */
  voice: string;
  model: string;
}

// ── OpenRouter — 한 키로 여러 TTS(+추후 LLM 플래너까지) ──────────────────
// OpenRouter /api/v1/audio/speech 는 OpenAI Audio Speech API 호환(2026 신설).
// 기본 모델 = google/gemini-3.1-flash-tts-preview — 2026-05 Speech Arena Elo 1위(프론티어,
// ElevenLabs v3보다 위). 실패 시 openai/gpt-4o-mini-tts(가성비)로 같은 키 안에서 강등.
// ElevenLabs는 OpenRouter에 없다 — 직결 키가 있을 때만 그 경로를 쓴다.

/** OpenRouter 기본(프론티어) 모델 — 2026-05 Speech Arena Elo 1위. 실측 검증됨(2026-06-11). */
export const OPENROUTER_FRONTIER_MODEL = 'google/gemini-3.1-flash-tts-preview';

/**
 * OpenRouter 요청 본문(순수 — 단위테스트 대상). 모델 제공자에 맞는 보이스·포맷을 고른다:
 *  - google/*: Gemini prebuilt 보이스(Zephyr/Charon/Orus/Puck) + **pcm 전용**(실측: mp3는 400).
 *    PCM은 24kHz/16-bit/mono raw로 내려온다.
 *  - 그 외(OpenAI 계열): nova 등 + mp3.
 * instructions는 무시하는 제공자도 무해해 동일 전달(요청 구조 단일화).
 */
export function buildOpenRouterRequest(
  text: string,
  opts: CloudTtsOpts,
): { model: string; voice: string; input: string; instructions: string; response_format: string } {
  const model = opts.model ?? OPENROUTER_FRONTIER_MODEL;
  const v = cloudVoiceById(opts.voice);
  const isGemini = model.startsWith('google/');
  return {
    model,
    voice: isGemini ? v.geminiVoice : v.openaiVoice,
    input: text,
    instructions: buildInstructions(v, opts.rate, opts.style),
    response_format: isGemini ? 'pcm' : 'mp3',
  };
}

/**
 * OpenRouter 합성 → 16kHz mono wav. 기본 = Gemini 3.1 Flash TTS(프론티어).
 * 실패하면 throw — 호출측(main)이 OpenAI 직결 → 로컬 say 순으로 폴백한다.
 * (참고: speech 엔드포인트에 gpt-4o-mini-tts는 더 이상 없음 — 2026-06-11 실측 400.)
 */
export async function synthesizeOpenRouterTts(
  text: string,
  outWav: string,
  opts: CloudTtsOpts,
): Promise<CloudTtsResult> {
  if (!opts.apiKey) throw new Error('OpenRouter TTS: API 키가 없습니다');
  const body = buildOpenRouterRequest(text, opts);
  const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter TTS 실패(${res.status}): ${detail.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), 'dawn-or-tts-'));
  if (body.response_format === 'pcm') {
    // Gemini: raw PCM s16le 24kHz mono → 표준 16kHz wav.
    const raw = join(dir, 'voice-raw.pcm');
    await writeFile(raw, buf);
    await exec(FFMPEG(), [
      '-y',
      '-loglevel',
      'error',
      '-f',
      's16le',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-i',
      raw,
      '-ar',
      '16000',
      '-ac',
      '1',
      outWav,
    ]);
  } else {
    const raw = join(dir, 'voice-raw.mp3');
    await writeFile(raw, buf);
    await exec(FFMPEG(), [
      '-y',
      '-loglevel',
      'error',
      '-i',
      raw,
      '-ar',
      '16000',
      '-ac',
      '1',
      outWav,
    ]);
  }
  return {
    wavPath: outWav,
    engine: 'cloud',
    voice: cloudVoiceById(opts.voice).id,
    model: body.model,
  };
}

// ── ElevenLabs eleven_v3 — 프론티어 음질 경로 (키 있으면 우선) ──────────
// eleven_v3는 2026 현재 TTS 품질 프론티어(70+ 언어, 감정 오디오태그). API ~$0.1/1k자
// (한국어 ~300자/분 → ~$0.03/분). gpt-4o-mini-tts(가성비 라인)의 상위 옵션.

export interface ElevenTtsOpts {
  apiKey: string;
  voice?: string; // dawn-cut 보이스 id(CLOUD_VOICES)
  rate?: number; // wpm — voice_settings에 직접 대응 없음 → 텍스트 페이스는 원고에 맡김
  style?: string; // calm/normal/lively → stability/style 매핑
  model?: string; // 기본 eleven_v3
}

/** ElevenLabs 요청(순수 — 단위테스트 대상). 스타일 프리셋 → voice_settings 결정적 매핑. */
export function buildElevenRequest(
  text: string,
  opts: ElevenTtsOpts,
): {
  voiceId: string;
  body: {
    text: string;
    model_id: string;
    voice_settings: { stability: number; similarity_boost: number; style: number };
  };
} {
  const v = cloudVoiceById(opts.voice);
  // calm=안정 위주, lively=표현력 위주, 보통=중간. 결정적 상수(튜닝은 추후 실측으로).
  const preset =
    opts.style === 'calm'
      ? { stability: 0.8, style: 0.15 }
      : opts.style === 'lively'
        ? { stability: 0.35, style: 0.65 }
        : { stability: 0.55, style: 0.35 };
  return {
    voiceId: v.elevenVoiceId,
    body: {
      text,
      model_id: opts.model ?? 'eleven_v3',
      voice_settings: { ...preset, similarity_boost: 0.8 },
    },
  };
}

/**
 * ElevenLabs 합성 → 16kHz mono wav. 실패는 throw — 호출측이 다음 엔진으로 폴백.
 * (eleven_v3 미가용 계정이면 422 등이 떨어진다 → 호출측이 multilingual v2로 재시도.)
 */
export async function synthesizeElevenTts(
  text: string,
  outWav: string,
  opts: ElevenTtsOpts,
): Promise<CloudTtsResult> {
  if (!opts.apiKey) throw new Error('ElevenLabs TTS: API 키가 없습니다');
  const { voiceId, body } = buildElevenRequest(text, opts);
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': opts.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // v3 미가용 계정 → multilingual v2로 1회 자동 강등(같은 보이스).
    if (res.status >= 400 && body.model_id === 'eleven_v3') {
      return synthesizeElevenTts(text, outWav, { ...opts, model: 'eleven_multilingual_v2' });
    }
    throw new Error(`ElevenLabs TTS 실패(${res.status}): ${detail.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), 'dawn-eleven-tts-'));
  const raw = join(dir, 'voice-raw.mp3');
  await writeFile(raw, buf);
  await exec(FFMPEG(), ['-y', '-loglevel', 'error', '-i', raw, '-ar', '16000', '-ac', '1', outWav]);
  return {
    wavPath: outWav,
    engine: 'cloud',
    voice: cloudVoiceById(opts.voice).id,
    model: body.model_id,
  };
}

/**
 * 클라우드 합성 → 16kHz mono wav(로컬 엔진과 동일 포맷 → 믹스 파이프라인 호환).
 * 실패는 throw — 호출측(main)이 로컬 `say`로 폴백하고 사유를 알린다.
 */
export async function synthesizeCloudTts(
  text: string,
  outWav: string,
  opts: CloudTtsOpts,
): Promise<CloudTtsResult> {
  if (!opts.apiKey) throw new Error('클라우드 TTS: API 키가 없습니다');
  const body = buildSpeechRequest(text, opts);
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`클라우드 TTS 실패(${res.status}): ${detail.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), 'dawn-cloud-tts-'));
  const raw = join(dir, 'voice-raw.wav');
  await writeFile(raw, buf);
  await exec(FFMPEG(), ['-y', '-loglevel', 'error', '-i', raw, '-ar', '16000', '-ac', '1', outWav]);
  return {
    wavPath: outWav,
    engine: 'cloud',
    voice: cloudVoiceById(opts.voice).id,
    model: body.model,
  };
}
