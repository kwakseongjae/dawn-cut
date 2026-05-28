import { describe, expect, it } from 'vitest';
import { scene } from './_testkit.js';
import { liveWords, programToWord, validateSync, wordToProgram } from './sync.js';

describe('SyncMap (SYNC-INV)', () => {
  it('initial timeline: each word maps to its source interval (offset 0)', () => {
    const { transcript, timeline } = scene();
    for (const id of transcript.order) {
      const w = transcript.words[id]!;
      const p = wordToProgram(timeline, w);
      expect(p).not.toBeNull();
      // single clip starts at source 0, timeline 0 → program == source
      expect(p!.start).toBe(w.sourceStart);
      expect(p!.end).toBe(w.sourceEnd);
    }
  });

  it('SYNC-INV-1: programToWord roundtrips at each word start', () => {
    const { transcript, timeline } = scene();
    for (const id of transcript.order) {
      const w = transcript.words[id]!;
      const p = wordToProgram(timeline, w)!;
      expect(programToWord(timeline, transcript, p.start)).toBe(id);
    }
  });

  it('programToWord returns null between words', () => {
    const { transcript, timeline } = scene();
    // word0 = [0,90ms), gap [90ms,100ms)
    expect(programToWord(timeline, transcript, 95_000)).toBeNull();
  });

  it('liveWords equals transcript order on the initial timeline', () => {
    const { transcript, timeline } = scene();
    expect(liveWords(timeline, transcript)).toEqual(transcript.order);
  });

  it('validateSync passes on the initial (uncut) timeline', () => {
    const { transcript, timeline } = scene();
    expect(validateSync(timeline, transcript)).toEqual([]);
  });
});
