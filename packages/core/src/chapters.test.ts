import { describe, expect, it } from 'vitest';
import { type Chapter, extractChapters, formatChapters } from './chapters.js';
import { createInitialTimeline } from './timeline.js';
import { buildTranscriptModel } from './transcript.js';
import type { Word } from './types.js';

// 헬퍼: [text, startSec, endSec] → 단어. 1초 = 1_000_000µs.
function words(rows: [string, number, number][]): Word[] {
  return rows.map(([text, s, e], i) => ({
    id: `m:w${i}`,
    text,
    sourceStart: Math.round(s * 1_000_000),
    sourceEnd: Math.round(e * 1_000_000),
    confidence: 1,
    mediaId: 'm',
  }));
}
function scene(rows: [string, number, number][], durationSec = 120) {
  const ws = words(rows);
  const transcript = buildTranscriptModel(ws, 'm', 'ko');
  const timeline = createInitialTimeline('m', durationSec * 1_000_000, 30);
  return { transcript, timeline };
}

// 촘촘한 발화(어절 1s 간격, 0.9s 길이 → 연속 gap 0.1s < gapUs): 토픽 내부엔 공백이 없고
// 토픽 사이에만 큰 공백이 있는 실제 발화 패턴을 모사.
function dense(texts: string[], startSec: number, step = 1): [string, number, number][] {
  return texts.map(
    (t, i) => [t, startSec + i * step, startSec + i * step + 0.9] as [string, number, number],
  );
}
const plain = (n: number, start: number) =>
  dense(
    Array.from({ length: n }, (_, i) => `말${i}`),
    start,
  );

describe('extractChapters', () => {
  it('빈 전사 → 빈 배열', () => {
    const { transcript, timeline } = scene([]);
    expect(extractChapters(transcript, timeline)).toEqual([]);
  });

  it('첫 챕터는 항상 0:00에서 시작', () => {
    const { transcript, timeline } = scene([['안녕하세요', 5, 6]]);
    const ch = extractChapters(transcript, timeline);
    expect(ch).toHaveLength(1);
    expect(ch[0]!.startUs).toBe(0);
  });

  it('큰 공백 + 최소길이 충족 시 새 챕터 분리', () => {
    // 토픽1: 0~20s 촘촘(공백 0.1s). 토픽2: 24s에 3.1s 공백 후 시작 → elapsed 24>=20 → 2챕터.
    const { transcript, timeline } = scene([
      ...plain(21, 0), // 말0..말20 (0~20.9s)
      ...dense(['다음', '주제는', '상태', '관리'], 24),
    ]);
    const ch = extractChapters(transcript, timeline, { minChapterUs: 20_000_000 });
    expect(ch).toHaveLength(2);
    expect(ch[0]!.startUs).toBe(0);
    expect(ch[1]!.startUs).toBe(24_000_000);
    expect(ch[1]!.title).toContain('다음');
  });

  it('최소 길이 미달이면 공백이 커도 분리하지 않는다', () => {
    const { transcript, timeline } = scene([
      ['짧은', 0, 1],
      ['도입', 1, 2],
      ['그리고', 10, 11], // 8초 공백이지만 elapsed 10<20 → 분리 안 함
      ['본론', 11, 12],
    ]);
    const ch = extractChapters(transcript, timeline, { minChapterUs: 20_000_000 });
    expect(ch).toHaveLength(1);
  });

  it('문장부호(.?!)도 최소길이 후 경계가 된다(공백 없이)', () => {
    // 21s까지 촘촘 + 문장끝 단어, 22s '이제'에서 문장경계 분리(gap은 크지 않음).
    const { transcript, timeline } = scene([
      ...plain(21, 0), // 0~20.9s
      ['마칩니다.', 21, 21.9], // 문장끝
      ['이제', 22, 22.9],
      ['시작합니다', 23, 23.9],
    ]);
    const ch = extractChapters(transcript, timeline, {
      minChapterUs: 20_000_000,
      gapUs: 5_000_000, // 공백 경계는 사실상 비활성 → 문장끝만으로 분리됨을 검증
    });
    expect(ch.length).toBeGreaterThanOrEqual(2);
    expect(ch[1]!.startUs).toBe(22_000_000);
  });

  it('제목은 maxTitleChars에서 어절 경계로 잘리고 …가 붙는다', () => {
    const { transcript, timeline } = scene([
      ['가나다라마', 0, 1],
      ['바사아자차', 1, 2],
      ['카타파하', 2, 3],
    ]);
    const ch = extractChapters(transcript, timeline, { maxTitleChars: 6 });
    expect(ch[0]!.title.endsWith('…')).toBe(true);
    expect([...ch[0]!.title.replace('…', '')].length).toBeLessThanOrEqual(6);
  });
});

describe('formatChapters', () => {
  it('M:SS 형식, 첫 줄 0:00', () => {
    const ch: Chapter[] = [
      { startUs: 0, title: '인트로' },
      { startUs: 83_000_000, title: '본론' },
      { startUs: 3_725_000_000, title: '마무리' }, // 1:02:05
    ];
    expect(formatChapters(ch)).toBe('0:00 인트로\n1:23 본론\n1:02:05 마무리');
  });
});
