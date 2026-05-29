import type { Word } from './types.js';

/** 용어집 치환 규칙: `from`(원문 부분문자열)을 `to`(대체문)로 바꾼다. */
export interface GlossaryPair {
  from: string;
  to: string;
}

/**
 * 각 Word.text에 글로서리 pair들을 배열 순서대로 누적 substring 치환한 새 Word[]를 반환한다.
 * 대소문자를 구분하며, 원본 Word는 불변(id·타임스탬프·mediaId·confidence 보존, 객체는 새로 생성).
 */
export function applyGlossary(words: Word[], pairs: GlossaryPair[]): Word[] {
  return words.map((w) => {
    let text = w.text;
    for (const { from, to } of pairs) {
      // 빈 from은 무한치환/전체오염을 막기 위해 스킵.
      if (from === '') continue;
      text = text.split(from).join(to);
    }
    return { ...w, text };
  });
}
