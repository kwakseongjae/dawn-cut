import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIDENCE_THRESHOLD, assessSpeech, lowConfidenceWords } from './confidence.js';
import { buildTranscriptModel } from './transcript.js';
import type { Word } from './types.js';

// [text, confidence] → 1초 간격 어절들로 transcript 구성.
function tr(rows: [string, number][]) {
  const words: Word[] = rows.map(([text, confidence], i) => ({
    id: `m:w${i}`,
    text,
    sourceStart: i * 1_000_000,
    sourceEnd: (i + 1) * 1_000_000,
    confidence,
    mediaId: 'm',
  }));
  return buildTranscriptModel(words, 'm', 'ko');
}

describe('lowConfidenceWords', () => {
  it('returns only words below the threshold', () => {
    const t = tr([
      ['안녕하세요', 0.95],
      ['몸', 0.13],
      ['정상', 0.98],
      ['그러니까', 0.4],
    ]);
    const low = lowConfidenceWords(t, 0.6);
    expect(low.map((w) => w.text)).toEqual(['몸', '그러니까']);
  });

  it('preserves transcript display order + carries timing', () => {
    const t = tr([
      ['가', 0.2],
      ['나', 0.9],
      ['다', 0.1],
    ]);
    const low = lowConfidenceWords(t, 0.5);
    expect(low.map((w) => w.text)).toEqual(['가', '다']);
    expect(low[0]!.sourceStart).toBe(0);
    expect(low[1]!.sourceEnd).toBe(3_000_000);
  });

  it('empty when all words are confident', () => {
    expect(
      lowConfidenceWords(
        tr([
          ['a', 0.9],
          ['b', 0.99],
        ]),
        0.6,
      ),
    ).toEqual([]);
  });

  it('all words when all below threshold', () => {
    const low = lowConfidenceWords(
      tr([
        ['a', 0.1],
        ['b', 0.2],
      ]),
      0.6,
    );
    expect(low).toHaveLength(2);
  });

  it('uses the default threshold (0.6) when omitted', () => {
    const t = tr([
      ['a', 0.55],
      ['b', 0.7],
    ]);
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.6);
    expect(lowConfidenceWords(t).map((w) => w.text)).toEqual(['a']);
  });

  it('threshold boundary is strict (< not <=)', () => {
    expect(lowConfidenceWords(tr([['a', 0.6]]), 0.6)).toEqual([]);
  });
});

describe('assessSpeech — 잡음/무음 환각 가드', () => {
  const w = (c: number, t = '어절') => ({ text: t, confidence: c });

  it('어절 0개 → no-words', () => {
    const a = assessSpeech([]);
    expect(a.speechLikely).toBe(false);
    expect(a.reason).toBe('no-words');
  });

  it("사운드 묘사 토큰만('*Rain*' p0.85 — 실측 환각)은 고신뢰여도 no-words", () => {
    const a = assessSpeech([{ text: '*Rain*', confidence: 0.848 }], 6_000_000);
    expect(a.speechLikely).toBe(false);
    expect(a.reason).toBe('no-words');
  });

  it('(music)/[BLANK_AUDIO]/♪ 류도 묘사 토큰으로 거른다', () => {
    const a = assessSpeech(
      [
        { text: '(music)', confidence: 0.9 },
        { text: '[BLANK_AUDIO]', confidence: 0.95 },
        { text: '♪♪', confidence: 0.8 },
      ],
      8_000_000,
    );
    expect(a.speechLikely).toBe(false);
  });

  it('발화 밀도가 너무 낮으면(6초 1어절) sparse — 고신뢰여도 발화 아님', () => {
    const a = assessSpeech([w(0.9, '비')], 6_000_000);
    expect(a.speechLikely).toBe(false);
    expect(a.reason).toBe('sparse');
  });

  it('실발화 패턴(중앙값 0.7+, 정상 밀도) → speechLikely', () => {
    const a = assessSpeech(
      [0.92, 0.85, 0.78, 0.71, 0.66, 0.88].map((c) => w(c)),
      3_000_000, // 3초 6어절 = 2/s
    );
    expect(a.speechLikely).toBe(true);
    expect(a.reason).toBe('ok');
  });

  it('문장형 환각(전반적 저신뢰) → low-confidence', () => {
    const a = assessSpeech(
      [0.12, 0.31, 0.27, 0.44, 0.19, 0.35].map((c) => w(c)),
      3_000_000,
    );
    expect(a.speechLikely).toBe(false);
    expect(a.reason).toBe('low-confidence');
  });

  it('duration 미제공이면 밀도 검사는 생략(신뢰도만)', () => {
    const a = assessSpeech([w(0.9, '안녕하세요')]);
    expect(a.speechLikely).toBe(true);
  });

  it('소수 저신뢰 어절이 섞인 정상 발화는 통과(검수 UI 몫)', () => {
    const a = assessSpeech(
      [0.9, 0.85, 0.2, 0.88, 0.75, 0.15, 0.8].map((c) => w(c)),
      3_000_000,
    );
    expect(a.speechLikely).toBe(true);
  });
});
