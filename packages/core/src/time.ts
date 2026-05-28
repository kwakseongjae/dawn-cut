/**
 * Time utilities — integer microseconds, frame-grid snapping, tolerance.
 * See 04-DATA-CONTRACTS §0. Tolerance default = ±1 frame.
 */

export const US_PER_SECOND = 1_000_000;

/** Microseconds per frame at a given fps (rounded to integer µs). */
export function frameUs(fps: number): number {
  if (fps <= 0) throw new RangeError(`fps must be > 0, got ${fps}`);
  return Math.round(US_PER_SECOND / fps);
}

/** Snap a µs timestamp to the nearest frame boundary. */
export function snapToFrame(us: number, fps: number): number {
  const f = frameUs(fps);
  return Math.round(us / f) * f;
}

/** True when |a - b| <= tolerance (µs). Default tolerance = 1 frame. */
export function withinTolerance(a: number, b: number, toleranceUs: number): boolean {
  return Math.abs(a - b) <= toleranceUs;
}

/** Length of a half-open interval [start, end). */
export function intervalLength(start: number, end: number): number {
  return Math.max(0, end - start);
}

/** Do half-open intervals [aStart,aEnd) and [bStart,bEnd) overlap? */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
