import { describe, expect, it } from 'vitest';
import { makeWord } from './_testkit.js';
import { DEFAULT_FILLERS, detectFillers } from './fillers.js';
import { buildTranscriptModel } from './transcript.js';
import type { TranscriptModel } from './types.js';

/** order 순서대로 [id, text]가 보장되도록 100µs 간격으로 단어를 깐다. */
function txt(words: string[]): { model: TranscriptModel; ids: string[] } {
  const built = words.map((t, k) => makeWord(t, k * 100_000, k * 100_000 + 90_000));
  const model = buildTranscriptModel(built, 'm1', 'en');
  return { model, ids: built.map((w) => w.id) };
}

describe('detectFillers', () => {
  it('detects bare default fillers', () => {
    const { model, ids } = txt(['음', '오늘', '어', '날씨']);
    expect(detectFillers(model)).toEqual([ids[0], ids[2]]);
  });

  it('preserves transcript.order in the returned ids', () => {
    const { model, ids } = txt(['시작', '어', '중간', '음', '끝']);
    // order: 시작, 어, 중간, 음, 끝 → 필러 인덱스 1,3
    expect(detectFillers(model)).toEqual([ids[1], ids[3]]);
  });

  it('strips leading/trailing punctuation before matching', () => {
    const { model, ids } = txt(['음,', '어.', '으~', '...아', '에!']);
    expect(detectFillers(model)).toEqual([ids[0], ids[1], ids[2], ids[3], ids[4]]);
  });

  it('only matches whole-eojeol equality (no substring false positives)', () => {
    // '어디'(어+디)·'음악'·'그것'·'뭔가'·'아니다'·'아냐'는 절대 미검출
    const { model } = txt(['어디', '음악', '그것', '뭔가', '아니다', '아냐', '에코']);
    expect(detectFillers(model)).toEqual([]);
  });

  it('does not match a filler that is merely a substring of a longer word', () => {
    const { model } = txt(['엄마', '으리', '흠뻑', '에어컨']);
    expect(detectFillers(model)).toEqual([]);
  });

  it("excludes '그' and '뭐' from the conservative default", () => {
    const { model } = txt(['그', '뭐']);
    expect(detectFillers(model)).toEqual([]);
  });

  it('returns [] for an empty transcript', () => {
    const empty = buildTranscriptModel([], 'm1', 'en');
    expect(detectFillers(empty)).toEqual([]);
  });

  it('supports a custom lexicon (replaces the default)', () => {
    const { model, ids } = txt(['음', '그', '뭐']);
    // 커스텀 사전으로 대체 → '음'은 미검출, '그'/'뭐'만 검출
    expect(detectFillers(model, { lexicon: ['그', '뭐'] })).toEqual([ids[1], ids[2]]);
  });

  it('supports extra terms (adds to the active lexicon)', () => {
    const { model, ids } = txt(['음', '그', '뭐']);
    // 기본 + '그' 추가 → '음','그' 검출, '뭐' 미검출
    expect(detectFillers(model, { extra: ['그'] })).toEqual([ids[0], ids[1]]);
  });

  it('strips punctuation from custom lexicon/extra entries too', () => {
    const { model, ids } = txt(['그', '뭐']);
    expect(detectFillers(model, { lexicon: ['그,', '뭐!'] })).toEqual([ids[0], ids[1]]);
  });

  it('DEFAULT_FILLERS is the conservative set of hesitation sounds', () => {
    expect(DEFAULT_FILLERS).toEqual(['음', '어', '엄', '으', '흠', '아', '에']);
    expect(DEFAULT_FILLERS).not.toContain('그');
    expect(DEFAULT_FILLERS).not.toContain('뭐');
  });

  it('treats a word that is only punctuation as a non-filler', () => {
    const { model } = txt(['...', '???', '!!!']);
    expect(detectFillers(model)).toEqual([]);
  });
});
