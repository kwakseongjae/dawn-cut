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
