import { describe, expect, it } from 'vitest';
import { makeWord, scene } from './_testkit.js';
import { deleteWordRange } from './commands.js';
import { formatSrt, transcriptToCues, validateCues } from './subtitles.js';
import { createInitialTimeline } from './timeline.js';
import { buildTranscriptModel } from './transcript.js';

describe('subtitles (SUB-INV)', () => {
  it('builds cues for every live word, in program order, valid', () => {
    const { transcript, timeline } = scene(); // 5 words [k*100ms, +90ms)
    const cues = transcriptToCues(transcript, timeline, { maxGapUs: 50_000, maxWordsPerCue: 8 });
    expect(cues.length).toBeGreaterThan(0);
    expect(validateCues(cues, timeline)).toEqual([]);
    // all 5 words present across cues
    const text = cues.map((c) => c.text).join(' ');
    for (const w of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) expect(text).toContain(w);
  });

  it('breaks a cue at a program gap caused by a cut', () => {
    const { transcript, timeline } = scene();
    const mid = transcript.order[2]!; // remove charlie → gap in the middle
    const { after } = deleteWordRange(timeline, transcript, mid, mid);
    const cues = transcriptToCues(transcript, after, { maxGapUs: 50_000, maxWordsPerCue: 8 });
    expect(validateCues(cues, after)).toEqual([]);
    // charlie removed → not present
    expect(cues.map((c) => c.text).join(' ')).not.toContain('charlie');
  });

  it('formatSrt emits well-formed timestamps', () => {
    const srt = formatSrt([
      { index: 1, startUs: 0, endUs: 1_500_000, text: 'hello world' },
      { index: 2, startUs: 2_000_000, endUs: 3_250_000, text: 'second cue' },
    ]);
    expect(srt).toContain('00:00:00,000 --> 00:00:01,500');
    expect(srt).toContain('00:00:02,000 --> 00:00:03,250');
    expect(srt).toContain('hello world');
  });

  it('detects SUB-INV-2 (empty / inverted cue)', () => {
    const { timeline } = scene();
    const bad = [{ index: 1, startUs: 100, endUs: 100, text: 'x' }];
    expect(validateCues(bad, timeline).some((e) => e.startsWith('SUB-INV-2'))).toBe(true);
  });

  it('문장 끝(.?!)에서 cue를 끊어 완결된 자막을 만든다 (다음 문장을 물지 않음)', () => {
    // 한 문장(끝에 마침표) + 다음 문장 시작 어절. 8어절 컷이라면 '소개합니다. 이'로 묶이지만,
    // 문장경계 flush로 '…소개합니다.' 와 '이…' 가 분리돼야 한다.
    const words = [
      '오픈소스',
      '영상',
      '편집기',
      '던컷을',
      '소개합니다.',
      '이',
      '영상은',
      '로컬',
    ].map((t, k) => makeWord(t, k * 100_000, k * 100_000 + 90_000));
    const transcript = buildTranscriptModel(words, 'm1', 'ko');
    const timeline = createInitialTimeline('m1', 1_000_000, 30);
    const cues = transcriptToCues(transcript, timeline, { maxGapUs: 1_000_000, maxWordsPerCue: 8 });
    expect(cues.length).toBeGreaterThanOrEqual(2);
    // 첫 cue는 마침표로 끝나고, '이'는 다음 cue 시작.
    expect(cues[0]!.text.endsWith('소개합니다.')).toBe(true);
    expect(cues[1]!.text.startsWith('이')).toBe(true);
    expect(validateCues(cues, timeline)).toEqual([]);
  });

  it('maxCharsPerCue: 긴 발화를 짧은 쇼츠형 cue로 끊는다(단어 중간 안 자름)', () => {
    const words = ['물을', '약하게', '키고', '냄비에', '물', '한컵', '진간장', '한컵'].map((t, k) =>
      makeWord(t, k * 100_000, k * 100_000 + 90_000),
    );
    const transcript = buildTranscriptModel(words, 'm1', 'ko');
    const timeline = createInitialTimeline('m1', 1_000_000, 30);
    const loose = transcriptToCues(transcript, timeline, {
      maxGapUs: 1_000_000,
      maxWordsPerCue: 8,
    });
    const tight = transcriptToCues(transcript, timeline, {
      maxGapUs: 1_000_000,
      maxWordsPerCue: 8,
      maxCharsPerCue: 8,
    });
    expect(tight.length).toBeGreaterThan(loose.length); // 더 잘게 쪼갬
    // 다중 어절 cue는 캡(8자) 이내. 모든 어절이 보존된다(중간 안 자름).
    for (const c of tight) {
      if (c.text.includes(' ')) expect(c.text.length).toBeLessThanOrEqual(8);
    }
    const flat = tight
      .map((c) => c.text)
      .join(' ')
      .split(' ');
    expect(flat).toEqual(['물을', '약하게', '키고', '냄비에', '물', '한컵', '진간장', '한컵']);
    expect(validateCues(tight, timeline)).toEqual([]);
  });
});
