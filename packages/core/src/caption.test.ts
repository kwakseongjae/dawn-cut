import { describe, expect, it } from 'vitest';
import { wrapCaption } from './caption.js';

/** 손실 0 보장: 줄바꿈 결과에서 공백을 모두 제거하면 원본 어절 연결과 같아야 한다. */
function joinedWords(s: string): string {
  return s
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .join('');
}

describe('wrapCaption', () => {
  it('빈 입력 → 빈 문자열', () => {
    expect(wrapCaption('')).toBe('');
  });

  it('공백만 있는 입력 → 빈 문자열', () => {
    expect(wrapCaption('   ')).toBe('');
    expect(wrapCaption('\t \n  ')).toBe('');
  });

  it('짧은 텍스트는 한 줄에 그대로', () => {
    expect(wrapCaption('hello world', { maxCharsPerLine: 16 })).toBe('hello world');
  });

  it('그리디로 폭을 초과하면 새 줄로 넘긴다', () => {
    // 'one two three' → 'one two'(7) | 'three' (다음 어절 추가 시 7+1+5=13>8)
    const out = wrapCaption('one two three', { maxCharsPerLine: 8, maxLines: 99 });
    expect(out).toBe('one two\nthree');
  });

  it('정확히 경계 길이는 같은 줄에 유지된다 (≤ 이므로 포함)', () => {
    // 'ab cd' → 2+1+2 = 5, maxCharsPerLine 5 이면 같은 줄.
    expect(wrapCaption('ab cd', { maxCharsPerLine: 5, maxLines: 99 })).toBe('ab cd');
    // maxCharsPerLine 4 이면 5>4 이므로 분리.
    expect(wrapCaption('ab cd', { maxCharsPerLine: 4, maxLines: 99 })).toBe('ab\ncd');
  });

  it('다중 공백/탭/개행은 단일 구분자로 정규화된다', () => {
    const out = wrapCaption('a    b\t\tc', { maxCharsPerLine: 16 });
    expect(out).toBe('a b c');
  });

  it('단일 초장문 어절은 쪼개지 않고 단독 줄로 둔다', () => {
    const long = 'x'.repeat(40);
    const out = wrapCaption(long, { maxCharsPerLine: 16, maxLines: 2 });
    expect(out).toBe(long); // 한 줄, 분할 없음
    expect(out.includes('\n')).toBe(false);
  });

  it('긴 영문 단어가 줄 중간에 와도 절대 분할하지 않는다', () => {
    const out = wrapCaption('hi supercalifragilistic bye', { maxCharsPerLine: 10, maxLines: 99 });
    const lines = out.split('\n');
    expect(lines).toContain('supercalifragilistic');
    expect(joinedWords(out)).toBe('hisupercalifragilisticbye');
  });

  it('CJK(한글) 글자수를 정확히 센다', () => {
    // 각 어절 4글자, maxCharsPerLine 8 → '가나다라'(4) + ' ' + '마바사아'(4)=9>8 → 분리
    const out = wrapCaption('가나다라 마바사아', { maxCharsPerLine: 8, maxLines: 99 });
    expect(out).toBe('가나다라\n마바사아');
    // maxCharsPerLine 9 면 9<=9 → 한 줄
    expect(wrapCaption('가나다라 마바사아', { maxCharsPerLine: 9, maxLines: 99 })).toBe(
      '가나다라 마바사아',
    );
  });

  it('한글/영문 혼용', () => {
    const out = wrapCaption('안녕 world 반가워', { maxCharsPerLine: 8, maxLines: 99 });
    // '안녕'(2) + ' world'(6) = 8 <=8 같은 줄 → '안녕 world'(8) + ' 반가워'(4)=13>8 분리
    expect(out).toBe('안녕 world\n반가워');
  });

  it('서로게이트 페어(이모지)는 1글자로 센다', () => {
    // 이모지 4개를 4글자로 셈. '😀😀'(2) + ' ' + '😀😀'(2)=5>4 → 분리
    const out = wrapCaption('😀😀 😀😀', { maxCharsPerLine: 4, maxLines: 99 });
    expect(out).toBe('😀😀\n😀😀');
  });

  it('손실 0: 임의 입력에서도 모든 어절 글자가 보존된다', () => {
    const inputs = [
      'the quick brown fox jumps over the lazy dog',
      '가나다 라마바 사아자 차카타 파하',
      'mix 한글 and english 텍스트 together now',
      'a b c d e f g h i j',
    ];
    for (const inp of inputs) {
      const out = wrapCaption(inp, { maxCharsPerLine: 10, maxLines: 2 });
      expect(joinedWords(out)).toBe(joinedWords(inp));
    }
  });

  it('기본 maxCharsPerLine 16 — maxLines 제약이 없으면 모든 줄이 16 이하', () => {
    const out = wrapCaption('this is a fairly long english caption line example', {
      maxLines: 99,
    });
    // 어절 손실 없음
    expect(joinedWords(out)).toBe('thisisafairlylongenglishcaptionlineexample');
    // 모든 줄이 16 글자 이하 (단일 초장문 어절은 없음)
    for (const line of out.split('\n')) {
      expect([...line].length).toBeLessThanOrEqual(16);
    }
  });

  it('maxLines 초과 시 폭을 넓혀 재배치하되 텍스트는 버리지 않는다', () => {
    // maxCharsPerLine 4 면 'aa bb cc dd' → 4줄. maxLines 2 → 폭을 넓혀 줄여본다.
    const out = wrapCaption('aa bb cc dd', { maxCharsPerLine: 4, maxLines: 2 });
    expect(out.split('\n').length).toBeLessThanOrEqual(2);
    expect(joinedWords(out)).toBe('aabbccdd');
  });

  it('maxLines 로 줄일 수 없는 경우(어절 수가 많음)에도 손실 없이 그냥 줄을 더 만든다', () => {
    // 어절 10개, 각 한 글자. maxLines 2 로는 폭을 아무리 넓혀도 본래 정책상 그리디.
    const out = wrapCaption('a b c d e f g h i j', { maxCharsPerLine: 1, maxLines: 2 });
    expect(joinedWords(out)).toBe('abcdefghij');
  });

  it('maxCharsPerLine 가 0/음수면 트림된 원본을 단일 줄로 돌려준다(손실 방지)', () => {
    expect(wrapCaption('  hello world  ', { maxCharsPerLine: 0 })).toBe('hello world');
    expect(wrapCaption('hello world', { maxCharsPerLine: -5 })).toBe('hello world');
  });
});
