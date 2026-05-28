import type { Edl } from './types.js';

/**
 * Preview playback logic (01-POC-DESIGN §8): one HTML5 <video> plays the source,
 * and we seek across cut boundaries so the cut program plays back seamlessly.
 * Pure functions — the UI binds these to a real <video>.
 */

/** Index of the EDL segment covering a program time, or -1 if out of range. */
export function programToSegment(edl: Edl, tProgram: number): number {
  let cursor = 0;
  for (let i = 0; i < edl.segments.length; i++) {
    const len = edl.segments[i]!.sourceEnd - edl.segments[i]!.sourceStart;
    if (tProgram >= cursor && tProgram < cursor + len) return i;
    cursor += len;
  }
  return -1;
}

/** Source media time to display for a given program time, or null if past end. */
export function programToSource(edl: Edl, tProgram: number): number | null {
  let cursor = 0;
  for (const s of edl.segments) {
    const len = s.sourceEnd - s.sourceStart;
    if (tProgram >= cursor && tProgram < cursor + len) {
      return s.sourceStart + (tProgram - cursor);
    }
    cursor += len;
  }
  return null;
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
