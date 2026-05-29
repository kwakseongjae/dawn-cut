import { describe, expect, it } from 'vitest';
import { type GlossaryPair, applyGlossary } from './glossary.js';
import type { Word } from './types.js';

function w(id: string, text: string): Word {
  return {
    id,
    text,
    sourceStart: 1_000,
    sourceEnd: 2_000,
    confidence: 0.9,
    mediaId: 'm1',
  };
}

describe('applyGlossary', () => {
  it("'Don Cut'에서 'Don'→'Dawn' 치환", () => {
    const out = applyGlossary([w('a', 'Don Cut')], [{ from: 'Don', to: 'Dawn' }]);
    expect(out[0]!.text).toBe('Dawn Cut');
  });

  it('대소문자 구분: Don→Dawn은 소문자 don에 영향 없음', () => {
    const out = applyGlossary(
      [w('a', 'don Cut'), w('b', 'Don Cut')],
      [{ from: 'Don', to: 'Dawn' }],
    );
    expect(out[0]!.text).toBe('don Cut');
    expect(out[1]!.text).toBe('Dawn Cut');
  });

  it('from=빈문자열 pair는 스킵(전체오염 방지)', () => {
    const out = applyGlossary([w('a', 'hello')], [{ from: '', to: 'X' }]);
    expect(out[0]!.text).toBe('hello');
  });

  it('빈 from을 스킵해도 뒤따르는 유효 pair는 적용', () => {
    const pairs: GlossaryPair[] = [
      { from: '', to: 'X' },
      { from: 'lo', to: 'LO' },
    ];
    const out = applyGlossary([w('a', 'hello')], pairs);
    expect(out[0]!.text).toBe('helLO');
  });

  it('여러 pair 누적 적용(앞 결과에 다음 pair)', () => {
    const pairs: GlossaryPair[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ];
    // 'a' -> 'b' -> 'c': 결국 a와 b 모두 c가 됨
    const out = applyGlossary([w('a', 'aba')], pairs);
    expect(out[0]!.text).toBe('ccc');
  });

  it('매치 없음 → 동일 텍스트지만 새 객체(immutable)', () => {
    const orig = w('a', 'unchanged');
    const out = applyGlossary([orig], [{ from: 'zzz', to: 'qqq' }]);
    expect(out[0]!.text).toBe('unchanged');
    expect(out[0]).not.toBe(orig); // 새 객체
    expect(orig.text).toBe('unchanged'); // 원본 불변
  });

  it('한글 부분문자열 치환: 프로그람→프로그램', () => {
    const out = applyGlossary([w('a', '프로그람 작성')], [{ from: '프로그람', to: '프로그램' }]);
    expect(out[0]!.text).toBe('프로그램 작성');
  });

  it('한글 다중 출현 전부 치환', () => {
    const out = applyGlossary([w('a', '람람람')], [{ from: '람', to: '램' }]);
    expect(out[0]!.text).toBe('램램램');
  });

  it('id·타임스탬프·mediaId·confidence 보존', () => {
    const orig = w('keep-me', 'Don');
    const out = applyGlossary([orig], [{ from: 'Don', to: 'Dawn' }]);
    expect(out[0]!.id).toBe('keep-me');
    expect(out[0]!.sourceStart).toBe(1_000);
    expect(out[0]!.sourceEnd).toBe(2_000);
    expect(out[0]!.confidence).toBe(0.9);
    expect(out[0]!.mediaId).toBe('m1');
  });

  it('결과 text가 빈 문자열이 되어도 그대로 둔다(객체는 새로 생성)', () => {
    const orig = w('a', 'aaa');
    const out = applyGlossary([orig], [{ from: 'a', to: '' }]);
    expect(out[0]!.text).toBe('');
    expect(out[0]).not.toBe(orig);
  });

  it('원본 배열·원본 Word를 변형하지 않음(immutability)', () => {
    const input = [w('a', 'Don'), w('b', 'don')];
    const snapshot = input.map((x) => ({ ...x }));
    const out = applyGlossary(input, [{ from: 'Don', to: 'Dawn' }]);
    expect(input).toEqual(snapshot); // 입력 불변
    expect(out).not.toBe(input);
    expect(out[0]).not.toBe(input[0]);
  });

  it('빈 pairs면 텍스트는 동일하지만 새 객체 반환', () => {
    const orig = w('a', 'hello');
    const out = applyGlossary([orig], []);
    expect(out[0]!.text).toBe('hello');
    expect(out[0]).not.toBe(orig);
  });

  it('빈 words 입력 → 빈 배열', () => {
    expect(applyGlossary([], [{ from: 'a', to: 'b' }])).toEqual([]);
  });

  it('여러 Word에 동일 pair 적용', () => {
    const out = applyGlossary(
      [w('a', 'Don'), w('b', 'Don Don'), w('c', 'none')],
      [{ from: 'Don', to: 'Dawn' }],
    );
    expect(out.map((x) => x.text)).toEqual(['Dawn', 'Dawn Dawn', 'none']);
  });
});
