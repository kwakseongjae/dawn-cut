// NL 셀렉터 — 자연어 참조를 구체 핸들(wordId 범위/소스 구간)로 해소하는 read-only 도구.
//
// 비전(VISION-AI-EDITING §3.2): LLM이 µs 산술·ID 합성을 직접 하지 않도록, "인트로 부분"
// "죽은 구간" 같은 참조를 셀렉터가 결정적으로 핸들로 바꾼다. 이 핸들이 그대로
// deleteWordRange/removeSilences 입력이 된다 — 플래너의 컷 계열 동사 개방(issue #2)의 토대.
//
// 순수·결정적·읽기전용: 상태를 절대 바꾸지 않는다. 같은 입력 → 같은 결과.
import { liveWords, wordToProgram } from './sync.js';
import type { TimelineModel, TranscriptModel, Word } from './types.js';

/** 어절 표면형 코어 — 앞뒤 구두점/기호 제거 + NFC. drawSubtitle·키워드 강조와 동일 규약. */
const STRIP = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
const core = (s: string) => s.normalize('NFC').replace(STRIP, '').toLowerCase();

/** findWords 결과 1건 — 연속 라이브 어절 범위(그대로 deleteWordRange 입력 가능). */
export interface WordRange {
  fromWordId: string;
  toWordId: string;
  /** 매칭된 어절들의 원문(공백 join) — 사람/에이전트 확인용. */
  text: string;
  /** 프로그램 좌표(현재 편집 기준 표시 구간) — diff 표시용. */
  programStartUs: number;
  programEndUs: number;
}

/**
 * 전사에서 질의(query)와 일치하는 연속 라이브 어절 범위를 찾는다.
 *
 * 매칭 규칙(결정적):
 *  - query를 공백으로 어절 분해, 각 토큰을 코어 정규화(구두점 제거·소문자).
 *  - 단일 토큰: 어절 코어가 토큰을 '포함'하면 매치(조사 변형 흡수 — "던컷을"⊃"던컷").
 *  - 다중 토큰(구절): 연속 라이브 어절이 토큰 순서대로 각각 포함-매치해야 한다.
 *  - 겹침 없이 왼쪽부터 그리디(같은 어절이 두 범위에 들어가지 않음).
 *
 * @returns 최대 limit개(기본 50). 못 찾으면 [] — 환각 금지, 추측 없음.
 */
export function findWords(
  transcript: TranscriptModel,
  timeline: TimelineModel,
  query: string,
  opts?: { limit?: number },
): WordRange[] {
  const limit = Math.max(1, opts?.limit ?? 50);
  const tokens = query
    .split(/\s+/)
    .map(core)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  // 라이브 어절을 program 순서로 나열(라이브만 — 이미 컷된 어절은 대상 아님).
  const liveSet = new Set(liveWords(timeline, transcript));
  const live: Word[] = transcript.order
    .filter((id) => liveSet.has(id))
    .map((id) => transcript.words[id])
    .filter((w): w is Word => !!w);

  const out: WordRange[] = [];
  let i = 0;
  while (i < live.length && out.length < limit) {
    let matched = true;
    for (let k = 0; k < tokens.length; k++) {
      const w = live[i + k];
      if (!w || !core(w.text).includes(tokens[k]!)) {
        matched = false;
        break;
      }
    }
    if (!matched) {
      i += 1;
      continue;
    }
    const from = live[i]!;
    const to = live[i + tokens.length - 1]!;
    const a = wordToProgram(timeline, from);
    const b = wordToProgram(timeline, to);
    out.push({
      fromWordId: from.id,
      toWordId: to.id,
      text: live
        .slice(i, i + tokens.length)
        .map((w) => w.text)
        .join(' '),
      programStartUs: a ? a.start : 0,
      programEndUs: b ? b.end : 0,
    });
    i += tokens.length; // 겹침 없이 그리디 전진.
  }
  return out;
}

/** findSilences 결과 1건 — 소스 좌표 구간(그대로 removeSilences.silences 입력 가능). */
export interface SilenceInterval {
  /** 소스 좌표(µs) — removeSilences가 기대하는 좌표계. */
  start: number;
  end: number;
  durationUs: number;
  /** 이 무음 직전의 어절 id(맥락 표시용; 선행 무음이면 없음). */
  afterWordId?: string;
}

/**
 * 발화 공백(=말 사이 무음) 구간을 전사 타이밍에서 결정적으로 찾는다.
 *
 * 라이브 어절의 소스 타임스탬프 사이 간격이 minMs 이상이면 무음으로 본다.
 * (오디오 파형 분석은 sidecar detectSilences의 몫 — 셀렉터는 순수 코어라
 *  전사 기반 근사를 쓴다. whisper 타임스탬프는 발화 경계라 실용적으로 일치.)
 * 결과는 소스 좌표 — `removeSilences` 명령에 그대로 흘릴 수 있다.
 */
export function findSilences(
  transcript: TranscriptModel,
  timeline: TimelineModel,
  opts?: { minMs?: number },
): SilenceInterval[] {
  const minUs = Math.max(0, Math.round((opts?.minMs ?? 500) * 1000));
  const liveSet = new Set(liveWords(timeline, transcript));
  const live: Word[] = transcript.order
    .filter((id) => liveSet.has(id))
    .map((id) => transcript.words[id])
    .filter((w): w is Word => !!w);

  const out: SilenceInterval[] = [];
  for (let i = 0; i + 1 < live.length; i++) {
    const cur = live[i]!;
    const next = live[i + 1]!;
    if (cur.mediaId !== next.mediaId) continue; // 다른 소스 간 갭은 무음이 아님.
    const gap = next.sourceStart - cur.sourceEnd;
    if (gap >= minUs) {
      out.push({
        start: cur.sourceEnd,
        end: next.sourceStart,
        durationUs: gap,
        afterWordId: cur.id,
      });
    }
  }
  return out;
}
