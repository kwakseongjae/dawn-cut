import { segmentProgramDuration } from './edl.js';
import type { Edl } from './types.js';

/**
 * Preview playback logic (01-POC-DESIGN §8): one HTML5 <video> plays the source,
 * and we seek across cut boundaries so the cut program plays back seamlessly.
 * Pure functions — the UI binds these to a real <video>.
 * B5: 세그먼트 배속(speed) 반영 — 프로그램 길이 = round(소스/speed), 소스 환산 = Δ×speed.
 */

/** Index of the EDL segment covering a program time, or -1 if out of range. */
export function programToSegment(edl: Edl, tProgram: number): number {
  let cursor = 0;
  for (let i = 0; i < edl.segments.length; i++) {
    const len = segmentProgramDuration(edl.segments[i]!);
    if (tProgram >= cursor && tProgram < cursor + len) return i;
    cursor += len;
  }
  return -1;
}

/** Source media time to display for a given program time, or null if past end. */
export function programToSource(edl: Edl, tProgram: number): number | null {
  let cursor = 0;
  for (const s of edl.segments) {
    const len = segmentProgramDuration(s);
    if (tProgram >= cursor && tProgram < cursor + len) {
      const sp = s.speed && s.speed > 0 ? s.speed : 1;
      return s.sourceStart + Math.round((tProgram - cursor) * sp);
    }
    cursor += len;
  }
  return null;
}

/** 프로그램 시각의 세그먼트 배속(프리뷰 <video>.playbackRate 계수). 범위 밖 = 1. */
export function programToSpeed(edl: Edl, tProgram: number): number {
  const i = programToSegment(edl, tProgram);
  if (i < 0) return 1;
  const sp = edl.segments[i]!.speed;
  return sp && sp > 0 ? sp : 1;
}

/** Source time to seek to at the start of each segment (one per segment). */
export function segmentSeekPoints(edl: Edl): number[] {
  return edl.segments.map((s) => s.sourceStart);
}

/**
 * Simulate stepping a playhead across the whole program, returning the source
 * times at which a seek is required (segment entry / discontinuity). Used by
 * the preview component and by tests to assert cut-skipping behavior.
 */
export function simulateSeeks(edl: Edl, stepUs: number): number[] {
  const seeks: number[] = [];
  let lastSegment = -1;
  for (let t = 0; t < edl.totalDuration; t += stepUs) {
    const seg = programToSegment(edl, t);
    if (seg !== lastSegment && seg >= 0) {
      seeks.push(edl.segments[seg]!.sourceStart);
      lastSegment = seg;
    }
  }
  return seeks;
}
