/**
 * 자막 줄바꿈 유틸 — 어절(공백) 단위 그리디 줄바꿈으로 한 줄 최대 글자수를 지킨다.
 * 텍스트는 절대 손실되지 않으며(어절 중간 분할 금지), 줄들은 '\n'으로 join 되어 반환된다.
 */

/** [...str] 기준 글자수(서로게이트 페어 1글자로 셈 → CJK/이모지 안전). */
function glyphLength(str: string): number {
  return [...str].length;
}

/**
 * 어절 단위 그리디 줄바꿈. 현재 줄 길이 + 1(공백) + 다음 어절 ≤ maxCharsPerLine 이면 같은 줄에,
 * 아니면 새 줄에 배치한다. 한 어절이 maxCharsPerLine 보다 길어도 절대 쪼개지 않고 단독 줄로 둔다.
 *
 * @param text 원본 자막 텍스트.
 * @param opts.maxCharsPerLine 한 줄 최대 글자수(기본 16).
 * @param opts.maxLines 목표 최대 줄 수(기본 2). 텍스트 손실 방지가 우선이라, 이를 초과해도 버리지 않는다.
 * @returns '\n' 으로 join 된 줄바꿈 텍스트. 빈/공백뿐 입력은 ''.
 */
export function wrapCaption(
  text: string,
  opts?: { maxCharsPerLine?: number; maxLines?: number },
): string {
  const maxCharsPerLine = opts?.maxCharsPerLine ?? 16;
  const maxLines = opts?.maxLines ?? 2;

  // 방어적: 비정상 옵션이면 그리디 분할이 무한/무의미해지므로 트림 없는 원본을 단일 줄로 돌려준다.
  if (maxCharsPerLine < 1 || !Number.isFinite(maxCharsPerLine)) {
    return text.trim();
  }

  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return '';

  const lines: string[] = [];
  let current = '';
  let currentLen = 0;

  for (const word of words) {
    const wordLen = glyphLength(word);
    if (current === '') {
      // 줄의 첫 어절은 길이와 무관하게 그대로 놓는다(긴 어절도 단독 줄로 허용).
      current = word;
      currentLen = wordLen;
      continue;
    }
    // 현재 줄 + 공백 1글자 + 다음 어절 이 한 줄에 들어가는지 검사.
    if (currentLen + 1 + wordLen <= maxCharsPerLine) {
      current = `${current} ${word}`;
      currentLen = currentLen + 1 + wordLen;
    } else {
      lines.push(current);
      current = word;
      currentLen = wordLen;
    }
  }
  lines.push(current);

  // maxLines 는 '재배치 시도' 용도로만 사용한다. 줄 수가 초과되면 maxCharsPerLine 을
  // (어절 손실 없이 가능한 만큼) 점진적으로 넓혀 다시 그리디 배치를 시도한다.
  // 단, 어절은 절대 쪼개지 않으므로 가장 긴 어절보다 더 줄일 수는 없다.
  if (maxLines >= 1 && lines.length > maxLines) {
    const longestWord = words.reduce((m, w) => Math.max(m, glyphLength(w)), 0);
    let width = maxCharsPerLine;
    let best = lines;
    // 폭을 1씩 넓혀가며 줄 수가 maxLines 이하가 되는 최소 폭을 찾는다.
    // longestWord 까지 넓혀도 안 되면(= 어절 수가 maxLines 보다 많아 불가피) 그냥 둔다.
    while (
      width < longestWord ||
      (best.length > maxLines && width < maxCharsPerLine + longestWord)
    ) {
      width += 1;
      const candidate = greedy(words, width);
      best = candidate;
      if (candidate.length <= maxLines) break;
    }
    return best.join('\n');
  }

  return lines.join('\n');
}

/** 주어진 폭으로 그리디 줄바꿈한 줄 배열을 만든다(어절 분할 없음). */
function greedy(words: string[], maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  let current = '';
  let currentLen = 0;
  for (const word of words) {
    const wordLen = glyphLength(word);
    if (current === '') {
      current = word;
      currentLen = wordLen;
      continue;
    }
    if (currentLen + 1 + wordLen <= maxCharsPerLine) {
      current = `${current} ${word}`;
      currentLen = currentLen + 1 + wordLen;
    } else {
      lines.push(current);
      current = word;
      currentLen = wordLen;
    }
  }
  lines.push(current);
  return lines;
}
