import { describe, expect, it } from 'vitest';
import { easeExpr, easeNumber } from './easing.js';

describe('easing', () => {
  it('endpoints: f(0)=0, f(1)=1 for every curve', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(easeNumber(e, 0)).toBeCloseTo(0);
      expect(easeNumber(e, 1)).toBeCloseTo(1);
    }
  });

  it('easeOut at u=0.25 is well past linear (faster start)', () => {
    expect(easeNumber('easeOut', 0.25)).toBeGreaterThan(0.25 + 0.15);
  });

  it('easeIn at u=0.25 lags behind linear', () => {
    expect(easeNumber('easeIn', 0.25)).toBeLessThan(0.25 - 0.1);
  });

  it('easeInOut symmetric around 0.5', () => {
    expect(easeNumber('easeInOut', 0.5)).toBeCloseTo(0.5);
  });

  it('easeExpr emits valid ffmpeg expressions for the curve', () => {
    const u = 'clip((t-0)/1,0,1)';
    expect(easeExpr('linear', u)).toBe(u);
    expect(easeExpr('easeIn', u)).toContain('pow(');
    expect(easeExpr('easeOut', u)).toContain('(1-pow(1-');
    expect(easeExpr('easeInOut', u)).toContain('3*pow');
  });
});

describe('back(오버슈트) 이징 — 사이클 8', () => {
  it('중간 구간에서 1을 초과(오버슈트)했다가 1로 정착한다', () => {
    expect(easeNumber('back', 0)).toBeCloseTo(0, 6);
    expect(easeNumber('back', 1)).toBeCloseTo(1, 6);
    // easeOutBack은 u≈0.7 부근에서 최대 오버슈트(>1)
    expect(easeNumber('back', 0.7)).toBeGreaterThan(1);
    expect(easeNumber('back', 0.7)).toBeLessThan(1.15);
  });

  it('ffmpeg 표현식과 수치 참조구현이 일치한다(샘플 5점)', () => {
    for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      // 표현식을 JS로 평가해 교차검증(pow → **)
      const expr = easeExpr('back', String(u)).replace(/pow\(([^,]+),([^)]+)\)/g, '(($1)**($2))');
      // biome-ignore lint/security/noGlobalEval: 테스트 한정 교차검증
      const v = eval(expr) as number;
      expect(v).toBeCloseTo(easeNumber('back', u), 6);
    }
  });
});
