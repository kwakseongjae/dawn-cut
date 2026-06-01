import { describe, expect, it } from 'vitest';
import { PLANNER_GRAMMAR, commandGrammar } from './grammar.js';

// edit-command.ts의 EditCommandSchema discriminatedUnion과 1:1로 일치해야 하는 9개 verb.
const VERBS = [
  'deleteWordRange',
  'removeSilences',
  'removeFillers',
  'cutSourceRange',
  'applyGlossary',
  'setSubtitleStyle',
  'replaceSubtitleStyle',
  'applyColorgrade',
  'applyZoom',
] as const;

/**
 * GBNF를 줄 단위로 훑어 `name ::= ...` 형태의 좌변(정의된 비단말) 이름 집합을 모은다.
 * 주석(#)·빈 줄은 무시. 규칙 본문이 다음 줄로 이어져도 좌변만 모으면 충분하다.
 */
function definedRules(gbnf: string): Set<string> {
  const defined = new Set<string>();
  for (const raw of gbnf.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*::=/.exec(line);
    if (m) defined.add(m[1]!);
  }
  return defined;
}

/**
 * GBNF 한 줄의 RHS에서 따옴표 리터럴("...")과 문자클래스([...]) 내부를 공백으로
 * 치환한다. 좌→우로 스캔하며 먼저 만난 여는 구분자에 따라 닫힘을 찾고, 백슬래시
 * escape는 한 글자 건너뛴다. (regex 2회 치환은 "[" 같은 토큰에서 경계가 엉킨다.)
 */
function maskLiterals(rhs: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < rhs.length) {
    const ch = rhs[i]!;
    if (ch === '"' || ch === '[') {
      const close = ch === '"' ? '"' : ']';
      out.push(' ');
      i++;
      while (i < rhs.length && rhs[i] !== close) {
        if (rhs[i] === '\\') i++; // escape: 다음 글자 건너뜀
        i++;
      }
      i++; // 닫는 구분자 소비
    } else {
      out.push(ch);
      i++;
    }
  }
  return out.join('');
}

/**
 * GBNF에서 참조되는 비단말 식별자를 모은다. 단, 문자열 리터럴("...")과
 * 문자클래스([...]) 내부의 식별자는 비단말이 아니므로 마스킹 후 추출한다.
 * 규칙 좌변(::= 앞)도 정의이지 참조가 아니므로 제외한다.
 */
function referencedNonterminals(gbnf: string): Set<string> {
  const refs = new Set<string>();
  for (const raw of gbnf.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    // 좌변 이름 제거: "name ::=" 의 RHS만 본다.
    const rhs = line.replace(/^[A-Za-z][A-Za-z0-9_-]*\s*::=/, '');
    // 단일 패스 마스킹: 따옴표 리터럴("...")과 문자클래스([...])는 그 안의
    // 텍스트가 비단말이 아니므로 공백으로 지운다. 두 종류가 서로의 구분자를
    // 품을 수 있어("[" 안의 [ , ["\\/]] 안의 " ) 별도 regex 두 번이 아니라
    // 먼저 열린 구분자를 따라가는 좌→우 스캐너로 처리한다.
    for (const m of maskLiterals(rhs).matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)) {
      refs.add(m[0]);
    }
  }
  return refs;
}

describe('commandGrammar (GBNF)', () => {
  const g = commandGrammar();

  it('비어있지 않은 문자열을 반환', () => {
    expect(typeof g).toBe('string');
    expect(g.trim().length).toBeGreaterThan(0);
  });

  it('PLANNER_GRAMMAR 상수가 commandGrammar() 결과와 동일(순수·결정적)', () => {
    expect(PLANNER_GRAMMAR).toBe(g);
    expect(commandGrammar()).toBe(g); // 재호출해도 동일
  });

  it('root 규칙이 존재하고 JSON 배열을 표현([ ... ])', () => {
    const defined = definedRules(g);
    expect(defined.has('root')).toBe(true);
    // root 본문에 배열 괄호 리터럴이 들어간다.
    const rootLine = g.split('\n').find((l) => /^root\s*::=/.test(l.trim()));
    expect(rootLine).toBeDefined();
    expect(rootLine).toContain('"["');
    expect(rootLine).toContain('"]"');
    // 0개 이상 반복 + cmd 비단말 참조.
    expect(rootLine).toContain('cmd');
  });

  it('cmd 규칙이 존재한다', () => {
    expect(definedRules(g).has('cmd')).toBe(true);
  });

  it.each(VERBS)('9 verb type 리터럴 포함: %s', (verb) => {
    // GBNF 내 escape된 type 리터럴 형태: "\"<verb>\""
    expect(g).toContain(String.raw`"\"${verb}\""`);
    // 각 verb가 별도 규칙으로도 정의되어 있다.
    expect(definedRules(g).has(verb)).toBe(true);
  });

  it('9개 type 리터럴이 모두 정확히 존재(개수 검증)', () => {
    for (const verb of VERBS) {
      const needle = String.raw`"\"${verb}\""`;
      const count = g.split(needle).length - 1;
      // 각 verb 리터럴은 해당 규칙에서 정확히 1회 등장.
      expect(count).toBe(1);
    }
  });

  it('미정의 비단말이 없다(균형 잡힌 정의)', () => {
    const defined = definedRules(g);
    const refs = referencedNonterminals(g);
    const undefinedRefs = [...refs].filter((r) => !defined.has(r));
    expect(undefinedRefs).toEqual([]);
  });

  it('정의된 모든 규칙이 (root 제외) 어딘가에서 참조된다(고아 규칙 없음)', () => {
    const defined = definedRules(g);
    const refs = referencedNonterminals(g);
    const orphans = [...defined].filter((d) => d !== 'root' && !refs.has(d));
    expect(orphans).toEqual([]);
  });

  it('한국어 문자열 값 허용: string 터미널이 유니코드 코드포인트를 받는 char를 쓴다', () => {
    expect(definedRules(g).has('string')).toBe(true);
    expect(definedRules(g).has('char')).toBe(true);
    // 제어문자/따옴표/역슬래시만 배제하는 negated class → 한글 음절 포함 허용.
    expect(g).toContain('[^"\\\\\\x00-\\x1F]');
  });

  it('숫자/정수 터미널 정의 존재', () => {
    const defined = definedRules(g);
    expect(defined.has('number')).toBe(true);
    expect(defined.has('integer')).toBe(true);
  });

  it('색보정 프리셋 5종 리터럴 포함', () => {
    for (const preset of ['warm', 'cool', 'punch', 'cinematic', 'flat']) {
      expect(g).toContain(String.raw`"\"${preset}\""`);
    }
  });
});
