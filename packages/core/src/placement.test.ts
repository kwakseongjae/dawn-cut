import { describe, expect, it } from 'vitest';
import { clamp01, clampRange, moveOverlay, resizeOverlay } from './placement.js';

describe('placement helpers', () => {
  it('clamp01', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });

  it('moveOverlay clamps within frame (x cannot push overlay off the right edge)', () => {
    const o = { x: 0.9, y: 0.5, scale: 0.3 };
    const m = moveOverlay(o, 0.5, 0.1);
    expect(m.x).toBeCloseTo(0.7); // 1 - scale
    expect(m.y).toBeCloseTo(0.6);
  });

  it('moveOverlay clamps y to [0,1]', () => {
    expect(moveOverlay({ x: 0.1, y: 0.0, scale: 0.2 }, 0, -0.5).y).toBe(0);
  });

  it('resizeOverlay clamps scale and keeps overlay inside', () => {
    expect(resizeOverlay({ x: 0.5, scale: 0.3 }, 0.01).scale).toBeCloseTo(0.31);
    expect(resizeOverlay({ x: 0.5, scale: 0.3 }, -1).scale).toBe(0.03); // floor
    const big = resizeOverlay({ x: 0.9, scale: 0.2 }, 0.5); // scale→0.7, x must shrink to 0.3
    expect(big.x).toBeCloseTo(0.3);
  });

  it('clampRange enforces 0 ≤ start < end ≤ duration', () => {
    expect(clampRange(-100, 999, 500)).toEqual({ startUs: 0, endUs: 500 });
    expect(clampRange(400, 200, 500)).toEqual({ startUs: 199, endUs: 200 });
  });
});
