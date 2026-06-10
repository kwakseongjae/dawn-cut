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
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';

export interface CloudVoice {
  /** dawn-cut 보이스 id(UI/프로젝트에 저장되는 값). */
  id: string;
  /** 사람이 읽는 라벨. */
  label: string;
  /** OpenAI voice 이름. */
  openaiVoice: string;
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
    baseInstructions:
      '밝고 또렷한 한국어 내레이션. 유튜브 해설 톤으로 자연스럽게, 문장 끝을 흐리지 않고 명확하게 읽는다. 영어 단어는 자연스러운 외래어 발음으로.',
  },
  {
    id: 'seoyeon',
    label: '서연 (차분한 다큐)',
    openaiVoice: 'shimmer',
    baseInstructions: '차분하고 신뢰감 있는 한국어 다큐멘터리 내레이션. 또박또박, 약간 낮은 톤.',
  },
  {
    id: 'hojin',
    label: '호진 (묵직한 예고편)',
    openaiVoice: 'onyx',
    baseInstructions: '묵직하고 깊은 한국어 내레이션. 영화 예고편처럼 무게감 있게.',
  },
  {
    id: 'haru',
    label: '하루 (활기찬 쇼츠)',
    openaiVoice: 'coral',
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
  await exec(FFMPEG, ['-y', '-loglevel', 'error', '-i', raw, '-ar', '16000', '-ac', '1', outWav]);
  return {
    wavPath: outWav,
    engine: 'cloud',
    voice: cloudVoiceById(opts.voice).id,
    model: body.model,
  };
}
