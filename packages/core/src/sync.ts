import { clipDuration, clipTimelineEnd, videoClips } from './timeline.js';
import type { TimelineModel, TranscriptModel, Word } from './types.js';

/**
 * Map a word's source interval to program coordinates given the current edit
 * state. Returns null when the word has been cut away (no live clip covers it).
 * (04 §3 SyncMap)
 */
export function wordToProgram(
  timeline: TimelineModel,
  word: Word,
): { start: number; end: number } | null {
  for (const c of videoClips(timeline)) {
    if (c.mediaId !== word.mediaId) continue;
    // word source interval contained in this clip's source interval
    if (word.sourceStart >= c.sourceStart && word.sourceEnd <= c.sourceEnd) {
      const start = c.timelineStart + (word.sourceStart - c.sourceStart);
      const end = c.timelineStart + (word.sourceEnd - c.sourceStart);
      return { start, end };
    }
  }
  return null;
}

/** Program time → the word playing at that instant, or null. */
export function programToWord(
  timeline: TimelineModel,
  transcript: TranscriptModel,
  tProgram: number,
): string | null {
  for (const c of videoClips(timeline)) {
    if (tProgram < c.timelineStart || tProgram >= clipTimelineEnd(c)) continue;
    const src = c.sourceStart + (tProgram - c.timelineStart);
    for (const id of transcript.order) {
      const w = transcript.words[id]!;
      if (w.mediaId === c.mediaId && src >= w.sourceStart && src < w.sourceEnd) {
        return id;
      }
    }
    return null; // inside a clip but between words
  }
  return null;
}

/** Words still present in the timeline, in program order. */
export function liveWords(timeline: TimelineModel, transcript: TranscriptModel): string[] {
  const live: { id: string; start: number }[] = [];
  for (const id of transcript.order) {
    const p = wordToProgram(timeline, transcript.words[id]!);
    if (p) live.push({ id, start: p.start });
  }
  live.sort((a, b) => a.start - b.start);
  return live.map((x) => x.id);
}

/** Returns a list of SYNC-INV violations ([] == valid). */
export function validateSync(timeline: TimelineModel, transcript: TranscriptModel): string[] {
  const errors: string[] = [];

  // SYNC-INV-1: roundtrip for every live word
  for (const id of transcript.order) {
    const w = transcript.words[id]!;
    const p = wordToProgram(timeline, w);
    if (!p) continue;
    const back = programToWord(timeline, transcript, p.start);
    if (back !== id) errors.push(`SYNC-INV-1: roundtrip failed for ${id} (got ${back})`);
  }

  // SYNC-INV-2: live words' program order is a subsequence of transcript.order
  const live = liveWords(timeline, transcript);
  if (!isSubsequence(live, transcript.order)) {
    errors.push('SYNC-INV-2: live word order is not a subsequence of transcript.order');
  }

  // SYNC-INV-3: durationProgram == Σ live clip durations
  const sumLive = videoClips(timeline).reduce((acc, c) => acc + clipDuration(c), 0);
  if (timeline.durationProgram !== sumLive) {
    errors.push(`SYNC-INV-3: durationProgram(${timeline.durationProgram}) != Σ clips(${sumLive})`);
  }

  return errors;
}

function isSubsequence(sub: string[], full: string[]): boolean {
  let i = 0;
  for (const x of full) {
    if (i < sub.length && sub[i] === x) i++;
  }
  return i === sub.length;
}
