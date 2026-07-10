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
  const edl: Edl = { fps: timeline.fps, segments, totalDuration };
  // B4: 경계 전환을 afterClipId → 세그먼트 인덱스로 매핑(마지막/미존재 경계는 validate가 걸렀다는 전제,
  // 방어적으로 한 번 더 거른다). 전환 없으면 필드 자체가 없어 렌더 인자 바이트 동일.
  if (timeline.transitions && timeline.transitions.length > 0) {
    const order = videoClips(timeline);
    const idxOf = new Map(order.map((c, i) => [c.id, i]));
    const transitions: NonNullable<Edl['transitions']> = [];
    for (const tr of timeline.transitions) {
      const idx = idxOf.get(tr.afterClipId);
      if (idx === undefined || idx >= order.length - 1) continue;
      transitions.push({ afterIndex: idx, kind: tr.kind, durationUs: tr.durationUs });
    }
    transitions.sort((a, b) => a.afterIndex - b.afterIndex);
    if (transitions.length > 0) edl.transitions = transitions;
  }
  return edl;
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

  // B4: 전환은 내부 경계만, D ≤ min(양쪽 세그먼트 길이) — 렌더 전 마지막 게이트.
  for (const tr of edl.transitions ?? []) {
    const a = edl.segments[tr.afterIndex];
    const b = edl.segments[tr.afterIndex + 1];
    if (!a || !b) {
      errors.push(`EDL: transition afterIndex ${tr.afterIndex} out of range`);
      continue;
    }
    const maxD = Math.min(a.sourceEnd - a.sourceStart, b.sourceEnd - b.sourceStart);
    if (tr.durationUs <= 0 || tr.durationUs > maxD) {
      errors.push(`EDL: transition at ${tr.afterIndex} duration ${tr.durationUs} out of range`);
    }
  }

  return errors;
}
