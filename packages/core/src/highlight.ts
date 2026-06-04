// 자동 하이라이트 — 긴 영상을 핵심만 남긴 짧은 클립으로(롱폼→쇼츠). 순수·결정적.
//
// 비전의 헤드라인 데모("20분 원본 → 한 프롬프트 → 60초 자막 쇼츠, 100% 로컬")의 코어.
// 클라우드 자동컷 서비스(Opus Clip 등)의 로컬·무료·결정적 대안. 결과는 표준 EditCommand
// (deleteWordRange) 컷 계획이라 dry-run·감사·재현 가능하고 단일트랙 EDL 위에서만 동작한다
// (멀티트랙 불필요 = 결정성 해자 유지).
//
// 알고리즘(결정적):
//  1) 살아있는 어절을 문장으로 그룹(문장부호 끝 또는 큰 프로그램 갭에서 분절).
//  2) 각 문장을 키워드 밀도(pickKeywords)로 점수화(+가벼운 길이 가중).
//  3) 점수 내림차순(동점 시 시간 순)으로 targetUs까지 그리디 KEEP.
//  4) KEEP의 여집합(연속 비-KEEP 어절 구간)을 deleteWordRange 컷으로 환산.

import { pickKeywords } from './keywords.js';
import { liveWords, wordToProgram } from './sync.js';
import type { TimelineModel, TranscriptModel } from './types.js';

/** 하이라이트 점수화 단위(연속 어절 한 묶음 = 한 문장/구간). */
export interface HighlightSentence {
  ids: string[];
  text: string;
  startUs: number; // 프로그램 시작(µs)
  durUs: number; // 프로그램 길이(µs)
}

/** 문장 끝으로 보는 종결 문장부호(한/영/CJK). */
const SENT_END = /[.?!…。！？]$/;

/**
 * 살아있는 어절을 문장 단위로 그룹한다(프로그램 시간 기준). 종결 부호로 끝나거나 다음 어절과의
 * 프로그램 갭이 maxGapUs를 넘으면(=컷 경계) 새 문장을 시작한다. 순수·결정적.
 */
export function highlightSentences(
  transcript: TranscriptModel,
  timeline: TimelineModel,
  maxGapUs = 600_000,
  maxWords = 12,
): HighlightSentence[] {
  const out: HighlightSentence[] = [];
  let ids: string[] = [];
  let texts: string[] = [];
  let start = 0;
  let end = 0;
  let prevEnd = -1;
  const flush = () => {
    if (ids.length)
      out.push({ ids, text: texts.join(' '), startUs: start, durUs: Math.max(0, end - start) });
    ids = [];
    texts = [];
  };
  for (const id of liveWords(timeline, transcript)) {
    const w = transcript.words[id]!;
    const p = wordToProgram(timeline, w);
    if (!p) continue; // liveWords가 이미 걸러주지만 방어적.
    if (ids.length && prevEnd >= 0 && p.start - prevEnd > maxGapUs) flush();
    if (!ids.length) start = p.start;
    ids.push(id);
    texts.push(w.text);
    end = p.end;
    prevEnd = p.end;
    // 종결 부호로 끝나거나 어절 수 상한 도달 시 분절. 상한은 문장부호가 드문 내레이션에서도
    // 선택 단위를 잘게 유지해 롱폼→쇼츠 컷이 의미 있게 동작하게 한다(결정적).
    if (SENT_END.test(w.text.trim()) || ids.length >= maxWords) flush();
  }
  flush();
  return out;
}

/**
 * 하이라이트로 KEEP할 어절 id 집합을 고른다(결정적, 프로그램 길이 기준).
 *
 * 결과 클립이 목표(targetUs)에 가깝게 '실제로' 짧아지도록 **드롭 기준**으로 고른다: 기본은 전부
 * KEEP, 원본 프로그램이 목표보다 길면 점수(키워드 밀도) 낮은 문장부터 누적 드롭이 (총길이−목표)에
 * 도달할 때까지 잘라낸다. 군더더기(키워드 적은 구간)가 먼저 제거되고 최소 1문장은 항상 남는다.
 *
 * 예전엔 '말(speech) 길이 합'이 target에 도달할 때까지 KEEP했는데, 문장 사이 공백(무음)이 합산에서
 * 빠져 말이 적은 영상에선 전부 KEEP→컷 0이 되곤 했다. 이제 timeline.durationProgram(공백 포함)을
 * 기준으로 삼아 원본이 목표보다 길면 반드시 의미 있게 컷한다.
 */
export function selectHighlightWordIds(
  transcript: TranscriptModel,
  timeline: TimelineModel,
  targetUs: number,
): Set<string> {
  const sentences = highlightSentences(transcript, timeline);
  const ids = new Set<string>();
  if (!sentences.length) return ids;

  const scored = sentences.map((s, i) => ({
    i,
    durUs: s.durUs,
    // 키워드 수 + 가벼운 길이 가중(최대 +2). 결정적.
    score: pickKeywords(s.text).length + Math.min(2, s.text.length / 40),
  }));

  const total = timeline.durationProgram;
  const target = Math.max(0, targetUs);
  const keep = new Set<number>(scored.map((s) => s.i)); // 기본: 전부 KEEP
  if (total > target) {
    // 잘라낼 프로그램 시간 ≈ (총길이 − 목표). 점수 오름차순(동점=시간 순)으로 드롭.
    const dropBudget = total - target;
    const byScoreAsc = [...scored].sort((a, b) => a.score - b.score || a.i - b.i);
    let dropped = 0;
    for (const s of byScoreAsc) {
      if (dropped >= dropBudget || keep.size <= 1) break; // 목표 달성 또는 최소 1문장
      keep.delete(s.i);
      dropped += s.durUs;
    }
  }

  for (const i of keep) for (const id of sentences[i]!.ids) ids.add(id);
  return ids;
}

/**
 * KEEP 집합의 여집합 = 잘라낼 연속 어절 구간 목록 [fromWordId, toWordId]. 프로그램 시간 순.
 * autoHighlight reducer가 각 구간을 deleteWordRange로 적용한다.
 */
export function highlightCutSpans(
  orderedLiveIds: readonly string[],
  keep: ReadonlySet<string>,
): Array<[string, string]> {
  const spans: Array<[string, string]> = [];
  let from: string | null = null;
  let to: string | null = null;
  for (const id of orderedLiveIds) {
    if (!keep.has(id)) {
      if (from === null) from = id;
      to = id;
    } else if (from !== null) {
      spans.push([from, to!]);
      from = null;
      to = null;
    }
  }
  if (from !== null) spans.push([from, to!]);
  return spans;
}
