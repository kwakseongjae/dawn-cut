import { createInitialTimeline } from './timeline.js';
import { buildTranscriptModel } from './transcript.js';
import type { TimelineModel, TranscriptModel, Word } from './types.js';

let counter = 0;
/** Deterministic id (tests don't need real UUIDs). */
export function tid(prefix = 'w'): string {
  counter += 1;
  return `${prefix}${counter}`;
}

export function makeWord(text: string, startUs: number, endUs: number, mediaId = 'm1'): Word {
  return { id: tid(), text, sourceStart: startUs, sourceEnd: endUs, confidence: 1, mediaId };
}

/**
 * A simple scene: 5 contiguous words on one media, fps 30, single-clip timeline.
 * Word k occupies [k*100ms, k*100ms+90ms).
 */
export function scene(): {
  words: Word[];
  transcript: TranscriptModel;
  timeline: TimelineModel;
} {
  const texts = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
  const words = texts.map((t, k) => makeWord(t, k * 100_000, k * 100_000 + 90_000));
  const sourceDuration = 500_000; // 0.5s
  const transcript = buildTranscriptModel(words, 'm1', 'en');
  const timeline = createInitialTimeline('m1', sourceDuration, 30);
  return { words, transcript, timeline };
}
