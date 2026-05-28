import { snapToFrame } from './time.js';
import { clipDuration, recomputeDuration, videoClips } from './timeline.js';
import type { Clip, CommandResult, TimelineModel, Track, TranscriptModel } from './types.js';

/** Deep clone via structuredClone (global in Node 18+/browsers — portable). */
function clone<T>(x: T): T {
  return structuredClone(x);
}

/** Rebuild a single-video-track timeline gapless from 0 (enforces TL-INV-2). */
function rebuildGapless(model: TimelineModel, orderedClips: Clip[]): TimelineModel {
  const clips: Record<string, Clip> = {};
  let cursor = 0;
  const ids: string[] = [];
  for (const c of orderedClips) {
    const placed: Clip = { ...c, timelineStart: cursor };
    clips[placed.id] = placed;
    ids.push(placed.id);
    cursor += clipDuration(placed);
  }
  const videoTrack: Track = {
    id: model.tracks.find((t) => t.kind === 'video')?.id ?? 'video',
    kind: 'video',
    clips: ids,
  };
  const next: TimelineModel = {
    schemaVersion: 1,
    fps: model.fps,
    clips,
    tracks: [videoTrack],
    durationProgram: cursor,
  };
  next.durationProgram = recomputeDuration(next);
  return next;
}

function clampSnap(t: number, fps: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, snapToFrame(t, fps)));
}

/**
 * Remove a source interval [a,b) for `mediaId`: find the covering live clip,
 * split into left/right, drop the gap, ripple to stay gapless. Pure (returns
 * a fresh timeline). No-op (returns a clone) when nothing covers [a,b).
 * This is the shared core of text-based cuts and silence removal.
 */
export function cutSourceRange(
  timeline: TimelineModel,
  mediaId: string,
  a: number,
  b: number,
): TimelineModel {
  const clips = videoClips(timeline);
  const target = clips.find((c) => c.mediaId === mediaId && a >= c.sourceStart && b <= c.sourceEnd);
  if (!target) return clone(timeline);

  const cutStart = clampSnap(a, timeline.fps, target.sourceStart, target.sourceEnd);
  const cutEnd = clampSnap(b, timeline.fps, target.sourceStart, target.sourceEnd);
  if (cutEnd <= cutStart) return clone(timeline);

  const rebuilt: Clip[] = [];
  for (const c of clips) {
    if (c.id !== target.id) {
      rebuilt.push(c);
      continue;
    }
    if (c.sourceStart < cutStart) {
      rebuilt.push({ ...c, id: `${c.id}-L`, sourceStart: c.sourceStart, sourceEnd: cutStart });
    }
    if (cutEnd < c.sourceEnd) {
      rebuilt.push({ ...c, id: `${c.id}-R`, sourceStart: cutEnd, sourceEnd: c.sourceEnd });
    }
  }
  return rebuildGapless(timeline, rebuilt);
}

/**
 * deleteWordRange — the core of text-based editing (R2). (01-POC-DESIGN §6)
 * Unions the source interval [a,b) of words [fromWordId..toWordId] and cuts it.
 * Does NOT mutate input.
 */
export function deleteWordRange(
  timeline: TimelineModel,
  transcript: TranscriptModel,
  fromWordId: string,
  toWordId: string,
): CommandResult {
  const before = clone(timeline);

  const fromIdx = transcript.order.indexOf(fromWordId);
  const toIdx = transcript.order.indexOf(toWordId);
  if (fromIdx < 0 || toIdx < 0) return noop(before);
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);

  let a = Number.POSITIVE_INFINITY;
  let b = Number.NEGATIVE_INFINITY;
  let mediaId = '';
  for (let i = lo; i <= hi; i++) {
    const w = transcript.words[transcript.order[i]!]!;
    a = Math.min(a, w.sourceStart);
    b = Math.max(b, w.sourceEnd);
    mediaId = w.mediaId;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return noop(before);

  const after = cutSourceRange(timeline, mediaId, a, b);
  return { before, after, removedProgramUs: before.durationProgram - after.durationProgram };
}

/**
 * removeSilences — drop detected silent source intervals, shrinking each by
 * `padUs` on both sides to preserve a little speech head/tail. Applies cuts in
 * source order. Does NOT mutate input. (G5)
 */
export function removeSilences(
  timeline: TimelineModel,
  mediaId: string,
  silences: ReadonlyArray<{ start: number; end: number }>,
  padUs = 0,
): CommandResult {
  const before = clone(timeline);
  let working = before;
  const sorted = [...silences].sort((x, y) => x.start - y.start);
  for (const s of sorted) {
    const a = s.start + padUs;
    const b = s.end - padUs;
    if (b > a) working = cutSourceRange(working, mediaId, a, b);
  }
  return {
    before,
    after: working,
    removedProgramUs: before.durationProgram - working.durationProgram,
  };
}

function noop(before: TimelineModel): CommandResult {
  return { before, after: clone(before), removedProgramUs: 0 };
}

/** Undo restores the captured pre-command snapshot. */
export function undo(result: CommandResult): TimelineModel {
  return clone(result.before);
}
