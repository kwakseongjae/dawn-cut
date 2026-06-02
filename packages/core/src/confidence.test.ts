import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIDENCE_THRESHOLD, lowConfidenceWords } from './confidence.js';
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
