/**
 * 자막 cue 키워드 강조 — 한 cue 텍스트에서 '강조할 핵심 어절 1~2개'만 골라
 * 그 표면형(원문 그대로)을 돌려준다. CapCut식 키워드 강조처럼, 색만 입히는 용도라
 * 어절을 변형하지 않고(조사 꼬리 유지) 표면형을 보존한다.
 *
 * 정보형 한국어 롱폼이 타겟이라 '절제'가 핵심 — 기본 최대 2개, 짧은 cue는 1개 이하만 고른다.
 * 결정적·순수 함수(외부 상태/난수/시간 의존 없음).
 */

/**
 * 한국어 흔한 불용어/지시어 기본 사전.
 * 지시어(이/그/저/것…), 의존명사/허사(수/등/때…), 부사·접속부사(더/좀/잘/또/즉…),
 * 접속사(그리고/그래서/하지만…), 응답어(네/예/아니) 등 '강조해도 의미 없는' 어휘만 담는다.
 * 조사 단독은 어차피 공백 어절로 잘 분리되지 않으므로 핵심만 포함한다.
 */
export const DEFAULT_STOPWORDS: string[] = [
  // 지시 관형사/대명사
  '이',
  '그',
  '저',
  '것',
  '거',
  '이것',
  '그것',
  '저것',
  '이거',
  '그거',
  '저거',
  '여기',
  '거기',
  '저기',
  '이런',
  '그런',
  '저런',
  '이렇게',
  '그렇게',
  '저렇게',
  // 의존명사/허사
  '수',
  '등',
  '때',
  '점',
  '분',
  '게',
  '데',
  '바',
  '줄',
  '뿐',
  '만큼',
  '대로',
  '듯',
  // 부사
  '더',
  '좀',
  '잘',
  '또',
  '및',
  '즉',
  '약',
  '막',
  '딱',
  '꼭',
  '참',
  '잠깐',
  '아주',
  '매우',
  '너무',
  '정말',
  '진짜',
  '거의',
  '바로',
  '다시',
  '계속',
  '아마',
  '혹시',
  '이미',
  '벌써',
  '아직',
  // 접속부사/접속사
  '그리고',
  '그래서',
  '하지만',
  '그러나',
  '그런데',
  '그러면',
  '그러므로',
  '따라서',
  '또한',
  '그리하여',
  '왜냐하면',
  // 응답·감탄
  '네',
  '예',
  '아니',
  '아니요',
  '응',
  '음',
  '어',
  '아',
  '자',
  '그냥',
  // 일반 술어 보조어/형식어
  '하다',
  '되다',
  '있다',
  '없다',
  '같다',
  '대한',
  '관한',
  '위한',
  '통해',
  '대해',
  '관해',
  '위해',
];

/** 앞뒤 구두점(\p{P})·기호(\p{S})·공백을 제거한 '코어' 어절을 돌려준다. caption/fillers와 동일 규칙. */
function stripToCore(text: string): string {
  return text.replace(/^[\p{P}\p{S}\s]+/u, '').replace(/[\p{P}\p{S}\s]+$/u, '');
}

/** [...str] 기준 글자수(서로게이트 페어 1글자 → CJK/이모지 안전). */
function glyphLength(str: string): number {
  return [...str].length;
}

/** 코어가 '글자(letter)'를 하나라도 포함하는가? (순수 구두점/기호/숫자만이면 false). */
function hasLetter(core: string): boolean {
  return /\p{L}/u.test(core);
}

/** 후보 한 개의 평가 메타데이터. */
interface Candidate {
  /** 원문 표면형(앞뒤 구두점 포함, 색을 입힐 대상). */
  surface: string;
  /** 불용어/빈도 비교용 정규화 코어(앞뒤 구두점 제거). */
  core: string;
  /** 코어 글자수. */
  glyphs: number;
  /** 원문 등장 순서(0-base) — 동점 tie-break 및 결과 순서 보존용. */
  index: number;
}

/**
 * 한 cue 텍스트에서 강조할 어절의 '표면형' 배열을 반환한다(원문에 등장한 그대로).
 *
 * 처리 순서:
 *  1. 공백 기준 어절 분리 → 각 어절의 앞뒤 구두점을 떼어 코어를 얻는다(표면형은 보존).
 *  2. 후보 필터: 코어 글자수 < minGlyph 제외, 불용어(stopwords ∪ DEFAULT) 제외,
 *     글자(letter)를 전혀 포함하지 않는 어절(순수 구두점/숫자/기호) 제외.
 *     단 '2026년'처럼 숫자+한글은 글자를 포함하므로 허용된다.
 *  3. 랭킹: 글자수가 길수록 가산, opts.freq 가 주어지면 전사 전체 빈도가 높을수록 감점
 *     (흔한 단어 ↓, 드문 단어 ↑). 동점이면 먼저 등장한 어절 우선.
 *  4. 코어 기준 중복 제거 후 상위 effectiveMax 개를 골라 '원문 등장 순서'로 정렬해 표면형을 반환한다.
 *
 * 절제 규칙: 기본 max=2. 다만 후보가 1개뿐인 짧은 cue는 1개만 반환된다(필터의 자연스러운 결과).
 *
 * @param text 한 자막 cue의 텍스트.
 * @param opts.max 최대 강조 개수(기본 2, 1 미만이면 0으로 클램프).
 * @param opts.minGlyph 후보 최소 글자수(기본 2).
 * @param opts.stopwords 추가 불용어(DEFAULT_STOPWORDS 와 합집합).
 * @param opts.freq 전사 전체 코어→등장횟수 맵. 주어지면 흔한 단어를 감점한다.
 * @returns 강조할 어절 표면형 배열(등장 순서 보존, 코어 기준 중복 없음). 후보가 없으면 [].
 */
export function pickKeywords(
  text: string,
  opts?: { max?: number; minGlyph?: number; stopwords?: string[]; freq?: Record<string, number> },
): string[] {
  const max = opts?.max ?? 2;
  const minGlyph = opts?.minGlyph ?? 2;
  const effectiveMax = Math.max(0, Math.floor(max));
  if (effectiveMax === 0) return [];

  // 불용어 집합: 코어 정규화하여 DEFAULT 와 커스텀을 합친다.
  const stop = new Set<string>();
  for (const w of DEFAULT_STOPWORDS) stop.add(stripToCore(w));
  for (const w of opts?.stopwords ?? []) stop.add(stripToCore(w));

  const freq = opts?.freq;

  // 1·2단계: 어절 분리 + 코어 추출 + 필터.
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  const candidates: Candidate[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const surface = tokens[i];
    if (surface === undefined) continue;
    const core = stripToCore(surface);
    if (core === '') continue; // 순수 구두점/공백 어절
    if (!hasLetter(core)) continue; // 숫자/기호만 → 제외 ('2026년'은 통과)
    const glyphs = glyphLength(core);
    if (glyphs < minGlyph) continue; // 너무 짧은 어절
    if (stop.has(core)) continue; // 불용어
    candidates.push({ surface, core, glyphs, index: candidates.length });
  }
  if (candidates.length === 0) return [];

  // 3단계: 점수 = 글자수 + 희소성 보너스. 빈도가 높을수록 감점.
  //  - freq 없으면 글자수만으로 랭킹(동점은 등장 순).
  //  - freq 있으면: 결정적·정수친화적으로 "count 가 작을수록 큰 가산점"을 주되
  //    글자수와 같은 스케일로 합산한다 (2/n - 1: n=1→+1, n=2→0, n≥3→음수).
  function score(c: Candidate): number {
    let s = c.glyphs;
    if (freq) {
      const n = freq[c.core] ?? 1;
      s += 2 / n - 1;
    }
    return s;
  }

  // 안정 정렬: 점수 내림차순, 동점이면 등장 인덱스 오름차순(먼저 등장 우선).
  const ranked = [...candidates].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sb !== sa) return sb - sa;
    return a.index - b.index;
  });

  // 4단계: 코어 기준 중복 제거 후 상위 effectiveMax 개를 고른다.
  //  같은 단어가 한 cue 안에서 반복되면(예: "데이터입니다 정말 데이터입니다")
  //  강조 슬롯을 같은 단어로 두 번 쓰지 않는다 — '절제'가 핵심이고 강조 대상은
  //  '서로 다른' 핵심 어절이어야 한다. 코어가 같은 후보 중에서는 랭킹 1순위
  //  (=ranked 선두; 점수↑·먼저 등장)를 대표로 남기고, 남는 슬롯은 다음 distinct 어절로 채운다.
  const chosen: Candidate[] = [];
  const seenCores = new Set<string>();
  for (const c of ranked) {
    if (seenCores.has(c.core)) continue;
    seenCores.add(c.core);
    chosen.push(c);
    if (chosen.length >= effectiveMax) break;
  }

  // 결과는 '원문 등장 순서'로 재정렬한 표면형.
  return chosen.sort((a, b) => a.index - b.index).map((c) => c.surface);
}
