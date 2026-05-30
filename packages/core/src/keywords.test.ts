import { describe, expect, it } from 'vitest';
import { DEFAULT_STOPWORDS, pickKeywords } from './keywords.js';

describe('DEFAULT_STOPWORDS', () => {
  it('contains core Korean demonstratives/conjunctions/responses', () => {
    for (const w of ['이', '그', '저', '것', '수', '등', '때', '그리고', '하지만', '네', '예']) {
      expect(DEFAULT_STOPWORDS).toContain(w);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(DEFAULT_STOPWORDS).size).toBe(DEFAULT_STOPWORDS.length);
  });
});

describe('pickKeywords — empty / blank / all-filtered', () => {
  it('returns [] for empty string', () => {
    expect(pickKeywords('')).toEqual([]);
  });

  it('returns [] for whitespace-only', () => {
    expect(pickKeywords('   \t \n ')).toEqual([]);
  });

  it('returns [] when every word is a stopword', () => {
    expect(pickKeywords('그리고 그래서 하지만')).toEqual([]);
  });

  it('returns [] when only too-short (single-glyph) words remain', () => {
    // 각 어절이 1글자라 minGlyph(2) 미만 → 후보 없음
    expect(pickKeywords('산 강 별 꽃')).toEqual([]);
  });

  it('returns [] for pure punctuation / number-only tokens', () => {
    expect(pickKeywords('... !!! 123 45.6 -- ???')).toEqual([]);
  });
});

describe('pickKeywords — basic selection', () => {
  it('picks at most 2 by default, in original appearance order', () => {
    const out = pickKeywords('오늘은 인공지능 기술의 미래를 살펴봅니다');
    expect(out.length).toBeLessThanOrEqual(2);
    // 가장 긴 후보 '인공지능'(4)·'살펴봅니다'(5)가 상위 → 등장 순서 보존
    expect(out).toEqual(['인공지능', '살펴봅니다']);
  });

  it('ranks longer words higher (글자수↑)', () => {
    // 후보: 데이터(3), 분석(2), 정확도(3) — 길이 3짜리 둘이 상위, 등장순 보존
    const out = pickKeywords('데이터 분석 정확도', { max: 2 });
    expect(out).toEqual(['데이터', '정확도']);
  });

  it('returns a single keyword when only one candidate survives (짧은 cue ≤1)', () => {
    // '이건'(2글자, 비불용어 코어) + 나머지는 불용어/짧은어절
    const out = pickKeywords('그 인공지능');
    expect(out).toEqual(['인공지능']);
  });
});

describe('pickKeywords — surface form preserved (조사/구두점 유지)', () => {
  it('keeps josa tails (색만 입힘, 어절 변형 금지)', () => {
    const out = pickKeywords('인공지능은 빠르게 발전합니다', { max: 1 });
    // 표면형 그대로 — 조사 '은' 미제거
    expect(out).toEqual(['인공지능은']);
  });

  it('keeps the surface form of a punctuation-attached word', () => {
    // '자동으로,' 의 코어는 '자동으로'(4글자) — 표면형(쉼표 포함) 그대로 반환
    const out = pickKeywords('이건 자동으로, 됩니다', { max: 1 });
    expect(out).toEqual(['자동으로,']);
  });

  it('strips leading+trailing punctuation only for the core (length/stopword check)', () => {
    // '"중요"' 의 코어는 '중요'(2글자) → 후보. 다른 어절은 불용어/짧은 어절이라
    // 따옴표가 붙은 표면형 그대로 반환된다(코어로만 길이·불용어 판정).
    const out = pickKeywords('그 "중요" 점', { max: 1 });
    expect(out).toEqual(['"중요"']);
  });
});

describe('pickKeywords — numbers & latin', () => {
  it("allows mixed digit+hangul like '2026년'", () => {
    const out = pickKeywords('그 2026년 전망', { max: 2 });
    // '2026년'(글자 포함) 통과, '전망'(2글자) 통과. '그'는 불용어.
    expect(out).toContain('2026년');
    expect(out).toContain('전망');
    expect(out.length).toBe(2);
  });

  it('rejects pure-number tokens but keeps letter-bearing ones', () => {
    const out = pickKeywords('매출 100 억원으로 증가', { max: 3 });
    expect(out).not.toContain('100'); // 순수 숫자 제외
    expect(out).toContain('억원으로'); // 숫자 아님(한글)
  });

  it('accepts latin/english words of sufficient length', () => {
    const out = pickKeywords('새로운 React 프레임워크', { max: 2 });
    expect(out).toContain('React');
  });
});

describe('pickKeywords — custom options', () => {
  it('respects custom max', () => {
    const out = pickKeywords('인공지능 데이터 분석 모델 학습', { max: 3 });
    expect(out.length).toBe(3);
  });

  it('max < 1 (or 0) clamps to no keywords', () => {
    expect(pickKeywords('인공지능 데이터', { max: 0 })).toEqual([]);
    expect(pickKeywords('인공지능 데이터', { max: -5 })).toEqual([]);
  });

  it('respects custom minGlyph (raise threshold drops short words)', () => {
    // minGlyph=4 → '데이터'(3) 탈락, '인공지능'(4)만 후보
    const out = pickKeywords('데이터 인공지능', { minGlyph: 4 });
    expect(out).toEqual(['인공지능']);
  });

  it('minGlyph=1 lets single-glyph non-stopwords through', () => {
    const out = pickKeywords('산 강', { minGlyph: 1, max: 2 });
    expect(out).toEqual(['산', '강']);
  });

  it('respects custom stopwords (union with DEFAULT)', () => {
    // '브랜드명'을 불용어로 지정 → 결과에서 제외, DEFAULT('그')도 여전히 제외
    const out = pickKeywords('그 브랜드명 출시 발표', {
      stopwords: ['브랜드명'],
      max: 2,
    });
    expect(out).not.toContain('브랜드명');
    expect(out).not.toContain('그');
    expect(out).toEqual(['출시', '발표']);
  });
});

describe('pickKeywords — freq-based rarity weighting', () => {
  it('demotes common words even if longer (드문 단어 우선)', () => {
    // '데이터'(3글자, 흔함 count=50) vs '편향'(2글자, 드뭄 count=1)
    // freq 없으면 데이터가 이김. freq 있으면 희소한 '편향'이 가산받아 역전.
    const freq = { 데이터: 50, 편향: 1 };
    const out = pickKeywords('데이터 편향', { max: 1, freq });
    expect(out).toEqual(['편향']);
  });

  it('without freq, longer word wins the same pair', () => {
    const out = pickKeywords('데이터 편향', { max: 1 });
    expect(out).toEqual(['데이터']);
  });

  it('missing freq entry is treated as rarest (count→1)', () => {
    // '신조어'는 freq에 없음 → 가장 드문 것으로 간주, 흔한 '기술'(count 큼)을 이긴다.
    const freq = { 기술: 100 };
    const out = pickKeywords('기술 신조어', { max: 1, freq });
    expect(out).toEqual(['신조어']);
  });
});

describe('pickKeywords — determinism & tie-break', () => {
  it('is deterministic across repeated calls', () => {
    const t = '인공지능 데이터 분석 모델 학습 평가';
    const a = pickKeywords(t, { max: 2 });
    const b = pickKeywords(t, { max: 2 });
    expect(a).toEqual(b);
  });

  it('breaks ties by earliest appearance', () => {
    // 동일 길이(3글자) 후보들: 가나다·라마바·사아자 → 상위 2개는 먼저 등장한 둘
    const out = pickKeywords('가나다 라마바 사아자', { max: 2 });
    expect(out).toEqual(['가나다', '라마바']);
  });

  it('preserves appearance order in the output even if rank order differs', () => {
    // 점수 상위는 '프레임워크'(5, 뒤) > '데이터'(3, 앞) 이지만 결과는 등장순
    const out = pickKeywords('데이터 처리 프레임워크', { max: 2 });
    expect(out).toEqual(['데이터', '프레임워크']);
  });

  it('never returns duplicates / more than max', () => {
    const out = pickKeywords('인공지능 데이터 분석 모델 학습 평가 검증', { max: 2 });
    expect(out.length).toBe(2);
    expect(new Set(out).size).toBe(out.length);
  });

  it('같은 어절 반복 시 강조 슬롯을 중복으로 쓰지 않는다 (적대검증 회귀)', () => {
    expect(pickKeywords('인공지능 인공지능 인공지능', { max: 2 })).toEqual(['인공지능']);
    expect(pickKeywords('프레임워크 모델학습 프레임워크', { max: 2 })).toEqual([
      '프레임워크',
      '모델학습',
    ]);
  });
});
