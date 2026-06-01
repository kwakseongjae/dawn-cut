import { clipDuration, videoClips } from './timeline.js';
import type { Edl, TimelineModel } from './types.js';

/**
 * Convert the current timeline into an Export Decision List.
 * One segment per live video clip, in program order. (04 §5)
 */
export function timelineToEdl(timeline: TimelineModel, mediaPath: string): Edl {
  const segments = videoClips(timeline).map((c) => ({
    mediaPath,
    sourceStart: c.sourceStart,
    sourceEnd: c.sourceEnd,
    programStart: c.timelineStart,
    ...(c.effects && c.effects.length > 0 ? { effects: c.effects } : {}),
  }));
  const totalDuration = segments.reduce((acc, s) => acc + (s.sourceEnd - s.sourceStart), 0);
  return { fps: timeline.fps, segments, totalDuration };
}

/** Returns a list of EDL-INV violations ([] == valid). EDL-INV-1, EDL-INV-2. */
export function validateEdl(edl: Edl, timeline: TimelineModel): string[] {
  const errors: string[] = [];

  const sum = edl.segments.reduce((acc, s) => acc + (s.sourceEnd - s.sourceStart), 0);
  if (sum !== edl.totalDuration) errors.push('EDL-INV-1: Σ segment lengths != totalDuration');

  if (edl.totalDuration !== timeline.durationProgram) {
    errors.push('EDL-INV-2: totalDuration != timeline.durationProgram');
  }

  // contiguous, ascending programStart
  let cursor = 0;
  for (const s of edl.segments) {
    if (s.programStart !== cursor) errors.push(`EDL: non-contiguous segment at ${s.programStart}`);
    if (s.sourceEnd <= s.sourceStart) errors.push('EDL: non-positive segment');
    cursor += s.sourceEnd - s.sourceStart;
  }

  // sanity: durationProgram equals Σ clip durations (defensive)
  const clipSum = videoClips(timeline).reduce((a, c) => a + clipDuration(c), 0);
  if (clipSum !== timeline.durationProgram) errors.push('EDL: timeline duration mismatch');

  return errors;
}
