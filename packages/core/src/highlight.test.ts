import { describe, expect, it } from 'vitest';
import { highlightCutSpans, highlightSentences, selectHighlightWordIds } from './highlight.js';
import { createInitialTimeline } from './timeline.js';
import { buildTranscriptModel } from './transcript.js';
import type { TimelineModel, TranscriptModel } from './types.js';

// [text, startSec, endSec] → 단일 미디어 위 전사 + 전체를 덮는 단일 클립 타임라인.
function scene(rows: [string, number, number][]): {
  transcript: TranscriptModel;
  timeline: TimelineModel;
} {
  const words = rows.map(([text, s, e], i) => ({
    id: `m:w${i}`,
    text,
    sourceStart: Math.round(s * 1_000_000),
    sourceEnd: Math.round(e * 1_000_000),
    confidence: 1,
    mediaId: 'm',
  }));
  const dur = Math.max(...rows.map((r) => r[2])) * 1_000_000;
  return {
    transcript: buildTranscriptModel(words, 'm', 'ko'),
    timeline: createInitialTimeline('m', dur, 30),
  };
}

// 키워드가 풍부한 문장(홀수) vs 평범(짝수), 각 1초.
function richPoorScene(n = 10) {
  const rows: [string, number, number][] = [];
  for (let i = 0; i < n; i++) {
    rows.push([
      i % 2 === 0 ? `음 그냥 그래요${i}.` : `오픈소스 던컷 자막 핵심 기능${i}.`,
      i,
      i + 1,
    ]);
  }
  return scene(rows);
}

describe('highlightSentences', () => {
  it('문장부호 끝에서 분절한다', () => {
    const { transcript, timeline } = scene([
      ['안녕하세요.', 0, 1],
      ['반갑습니다', 1, 2],
      ['오늘은.', 2, 3],
    ]);
    const s = highlightSentences(transcript, timeline);
    expect(s).toHaveLength(2); // "안녕하세요." | "반갑습니다 오늘은."
    expect(s[0]!.ids).toEqual(['m:w0']);
  });

  it('큰 프로그램 갭(컷)에서 분절한다', () => {
    const { transcript, timeline } = scene([
      ['하나', 0, 1],
      ['둘', 5, 6], // 4초 갭 → 새 문장
    ]);
    expect(highlightSentences(transcript, timeline, 600_000)).toHaveLength(2);
  });
});

describe('selectHighlightWordIds', () => {
  it('키워드 밀도 높은 문장을 우선 KEEP한다', () => {
    const { transcript, timeline } = richPoorScene(10);
    const keep = selectHighlightWordIds(transcript, timeline, 4_000_000); // ~4문장
    // 홀수(키워드 풍부) 문장의 어절이 더 많이 살아남는다.
    const richKept = [...keep].filter((id) => {
      const idx = Number(id.split('w')[1]);
      return idx % 2 === 1;
    }).length;
    const poorKept = keep.size - richKept;
    expect(richKept).toBeGreaterThan(poorKept);
  });

  it('결정적: 같은 입력 → 같은 KEEP 집합', () => {
    const { transcript, timeline } = richPoorScene(8);
    const a = [...selectHighlightWordIds(transcript, timeline, 3_000_000)].sort();
    const b = [...selectHighlightWordIds(transcript, timeline, 3_000_000)].sort();
    expect(a).toEqual(b);
  });

  it('최소 1문장은 보장(target 0이어도)', () => {
    const { transcript, timeline } = richPoorScene(6);
    expect(selectHighlightWordIds(transcript, timeline, 0).size).toBeGreaterThan(0);
  });

  it('큰 target이면 거의 다 KEEP', () => {
    const { transcript, timeline } = richPoorScene(6);
    const keep = selectHighlightWordIds(transcript, timeline, 999_000_000);
    expect(keep.size).toBe(transcript.order.length);
  });

  it('원본이 목표보다 길면 실제로 컷한다(드롭 기준 — 말 적은 영상에서도)', () => {
    // 10문장×1초 = 프로그램 10초. 목표 4초 → ~6초를 드롭해야 한다(컷 0이면 안 됨).
    const { transcript, timeline } = richPoorScene(10);
    const keep = selectHighlightWordIds(transcript, timeline, 4_000_000);
    expect(keep.size).toBeLessThan(transcript.order.length); // 전부 KEEP이 아님(=실제 컷)
    const cuts = highlightCutSpans([...transcript.order], keep);
    expect(cuts.length).toBeGreaterThan(0);
    // 남은 어절 길이 합이 대략 목표 근처(±2문장). 군더더기부터 잘렸으니 과트림/무트림 아님.
    expect(keep.size).toBeLessThanOrEqual(6);
    expect(keep.size).toBeGreaterThanOrEqual(2);
  });
});

describe('highlightCutSpans', () => {
  it('비-KEEP 연속 구간을 [from,to]로 묶는다', () => {
    const ordered = ['a', 'b', 'c', 'd', 'e'];
    const keep = new Set(['b', 'd']);
    expect(highlightCutSpans(ordered, keep)).toEqual([
      ['a', 'a'],
      ['c', 'c'],
      ['e', 'e'],
    ]);
  });

  it('전부 KEEP이면 컷 없음', () => {
    expect(highlightCutSpans(['a', 'b'], new Set(['a', 'b']))).toEqual([]);
  });

  it('전부 컷이면 한 구간', () => {
    expect(highlightCutSpans(['a', 'b', 'c'], new Set())).toEqual([['a', 'c']]);
  });
});
