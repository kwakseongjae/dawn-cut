// 자막 정확도 UX — STT 신뢰도(Word.confidence)로 '검수가 필요한 어절'을 골라내는 순수 함수.
//
// whisper.cpp는 어절별 confidence(구성 토큰 확률의 평균, 0~1)를 부여한다(whisper.ts). 낮은
// 값일수록 오인식 가능성이 높다 — 이를 표면화해 사용자가 빠르게 검수·교정(correctWord)하게 한다.
// 순수·결정적: 입력 transcript만 보고 임계 미만 어절을 표시 순서대로 반환한다(node import 없음).

import type { TranscriptModel } from './types.js';

/** 검수 대상으로 표시할 저신뢰 어절(원문 순서 보존). */
export interface LowConfidenceWord {
  id: string;
  text: string;
  confidence: number;
  sourceStart: number;
  sourceEnd: number;
}

/** 기본 검수 임계값. turbo 모델은 깨끗한 발화에서 보통 0.8+ → 0.6 미만이면 한 번 볼 가치. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

/**
 * confidence < threshold 인 어절을 transcript의 표시 순서(order)대로 반환한다.
 * @param transcript 신뢰도가 채워진 TranscriptModel.
 * @param threshold  [0..1]. 이 값 미만인 어절만 반환(기본 0.6).
 */
export function lowConfidenceWords(
  transcript: TranscriptModel,
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): LowConfidenceWord[] {
  const out: LowConfidenceWord[] = [];
  for (const id of transcript.order) {
    const w = transcript.words[id];
    if (!w) continue;
    if (w.confidence < threshold) {
      out.push({
        id: w.id,
        text: w.text,
        confidence: w.confidence,
        sourceStart: w.sourceStart,
        sourceEnd: w.sourceEnd,
      });
    }
  }
  return out;
}

// ── 발화 신뢰성 평가 — 잡음/무음 환각 가드 (2026-06-11) ─────────────────
// whisper는 잡음·음악만 있는 오디오에서도 출력을 만든다. 실측(핑크노이즈 6s)에서 두 형태를 확인:
//  (a) 사운드 묘사 토큰 — "*Rain*"(p 0.85!) / "(music)" / "[BLANK_AUDIO]" — 고신뢰라 확률만으론 못 거름.
//  (b) 그럴듯한 문장 환각 — 토큰 확률이 전반적으로 낮음.
// → 3중 가드: 묘사 토큰 필터 + 발화 밀도(어절/초) + confidence 중앙값.

export interface SpeechAssessment {
  /** 유의미한 발화로 보이는가. false면 UI가 '음성을 찾지 못함/잡음' 안내. */
  speechLikely: boolean;
  /** 묘사 토큰 제거 후 어절 confidence 중앙값(어절 0개면 0). */
  medianConfidence: number;
  /** 묘사 토큰 제거 후 어절 수. */
  wordCount: number;
  /** 발화 밀도(어절/초). duration 미제공 시 -1(밀도 검사 생략). */
  wordsPerSec: number;
  reason: 'ok' | 'no-words' | 'low-confidence' | 'sparse';
}

/** confidence 중앙값 임계 — turbo 실측: 실발화 0.7+, 문장형 환각 0.2~0.45. */
export const SPEECH_MEDIAN_THRESHOLD = 0.5;
/** 발화 밀도 임계(어절/초) — 한국어 실발화 ~2/s, 잡음 환각은 듬성듬성(실측 0.17/s). */
export const SPEECH_DENSITY_THRESHOLD = 0.3;
/** 밀도 검사를 적용할 최소 오디오 길이(너무 짧으면 밀도가 불안정). */
const DENSITY_MIN_DURATION_US = 3_000_000;

/** whisper의 비발화 묘사 토큰 — *Rain*, (music), [BLANK_AUDIO], ♪ 등. */
function isAnnotation(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // 양끝이 묘사 기호로 감싸였거나 ♪ 포함 — 발화가 아니라 '소리에 대한 설명'.
  return /^[*([].*[*)\]]$/u.test(t) || t.includes('♪') || /^\[?BLANK_AUDIO\]?$/i.test(t);
}

/**
 * 전사 결과가 '실제 발화'인지 평가한다(순수·결정적).
 * @param words       전사 어절(텍스트+confidence).
 * @param durationUs  오디오 길이(µs). 주면 발화 밀도 검사 추가(권장).
 */
export function assessSpeech(
  words: ReadonlyArray<{ text?: string; confidence: number }>,
  durationUs?: number,
  threshold: number = SPEECH_MEDIAN_THRESHOLD,
): SpeechAssessment {
  // (1) 사운드 묘사 토큰 제거 — "*Rain*"은 발화가 아니다.
  const speechWords = words.filter((w) => !isAnnotation(w.text ?? 'x'));
  const wordsPerSec =
    durationUs && durationUs > 0 ? speechWords.length / (durationUs / 1_000_000) : -1;
  if (speechWords.length === 0)
    return {
      speechLikely: false,
      medianConfidence: 0,
      wordCount: 0,
      wordsPerSec,
      reason: 'no-words',
    };
  // (2) 발화 밀도 — 충분히 긴 오디오에서 어절이 너무 듬성하면 발화가 아니다.
  if (
    durationUs != null &&
    durationUs >= DENSITY_MIN_DURATION_US &&
    wordsPerSec >= 0 &&
    wordsPerSec < SPEECH_DENSITY_THRESHOLD
  )
    return {
      speechLikely: false,
      medianConfidence: medianOf(speechWords),
      wordCount: speechWords.length,
      wordsPerSec,
      reason: 'sparse',
    };
  // (3) confidence 중앙값 — 문장형 환각은 전반적 저신뢰.
  const median = medianOf(speechWords);
  if (median < threshold)
    return {
      speechLikely: false,
      medianConfidence: median,
      wordCount: speechWords.length,
      wordsPerSec,
      reason: 'low-confidence',
    };
  return {
    speechLikely: true,
    medianConfidence: median,
    wordCount: speechWords.length,
    wordsPerSec,
    reason: 'ok',
  };
}

function medianOf(words: ReadonlyArray<{ confidence: number }>): number {
  if (words.length === 0) return 0;
  const sorted = words.map((w) => w.confidence).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
