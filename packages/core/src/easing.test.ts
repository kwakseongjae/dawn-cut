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
