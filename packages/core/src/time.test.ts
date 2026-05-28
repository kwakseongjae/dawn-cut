import { describe, expect, it } from 'vitest';
import { frameUs, intervalLength, intervalsOverlap, snapToFrame, withinTolerance } from './time.js';

describe('time utils', () => {
  it('frameUs: 30fps == 33333µs (±1 frame tolerance basis, 04 §0)', () => {
    expect(frameUs(30)).toBe(33333);
    expect(frameUs(60)).toBe(16667);
  });

  it('frameUs: rejects non-positive fps', () => {
    expect(() => frameUs(0)).toThrow(RangeError);
    expect(() => frameUs(-1)).toThrow(RangeError);
  });

  it('snapToFrame: snaps to nearest frame grid', () => {
    expect(snapToFrame(0, 30)).toBe(0);
    expect(snapToFrame(33333, 30)).toBe(33333);
    expect(snapToFrame(40000, 30)).toBe(33333); // nearer to frame 1
    expect(snapToFrame(50001, 30)).toBe(66666); // nearer to frame 2
  });

  it('withinTolerance: ±1 frame at 30fps', () => {
    const tol = frameUs(30);
    expect(withinTolerance(1_000_000, 1_033_333, tol)).toBe(true);
    expect(withinTolerance(1_000_000, 1_033_334, tol)).toBe(false);
  });

  it('intervalLength: half-open, clamped at 0', () => {
    expect(intervalLength(100, 250)).toBe(150);
    expect(intervalLength(250, 100)).toBe(0);
  });

  it('intervalsOverlap: half-open semantics', () => {
    expect(intervalsOverlap(0, 100, 100, 200)).toBe(false); // touching != overlap
    expect(intervalsOverlap(0, 101, 100, 200)).toBe(true);
  });
});
