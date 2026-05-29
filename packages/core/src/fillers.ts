import type { TranscriptModel } from './types.js';

/**
 * 보수적 기본 필러 사전 — 명백한 머뭇거림 소리만 포함한다.
 * '그'/'뭐'는 일반어 오탐 위험이 커서 기본에서 제외한다.
 */
export const DEFAULT_FILLERS: string[] = ['음', '어', '엄', '으', '흠', '아', '에'];

/** 앞뒤 구두점(\p{P})·기호(\p{S})·공백을 제거한 '코어' 어절을 돌려준다. */
function stripToCore(text: string): string {
  return text.replace(/^[\p{P}\p{S}\s]+/u, '').replace(/[\p{P}\p{S}\s]+$/u, '');
}

/**
 * 필러(머뭇거림) Word.id를 transcript.order 순서로 반환한다.
 * 각 단어의 앞뒤 구두점/공백을 떼어낸 코어가 사전 항목과 '정확히 전체 일치'할 때만
 * 필러로 판정한다(부분일치 금지). 반환은 id만 — 제거는 호출부(deleteWordRange)가 담당.
 */
export function detectFillers(
  transcript: TranscriptModel,
  opts?: { lexicon?: string[]; extra?: string[] },
): string[] {
  const base = opts?.lexicon ?? DEFAULT_FILLERS;
  const lex = new Set<string>();
  for (const t of base) lex.add(stripToCore(t));
  for (const t of opts?.extra ?? []) lex.add(stripToCore(t));

  const ids: string[] = [];
  for (const id of transcript.order) {
    const w = transcript.words[id];
    if (!w) continue;
    const core = stripToCore(w.text);
    if (core !== '' && lex.has(core)) ids.push(id);
  }
  return ids;
}
