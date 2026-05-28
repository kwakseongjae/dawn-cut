import { describe, expect, it } from 'vitest';
import { makeWord, scene } from './_testkit.js';
import { buildTranscriptModel, validateTranscript } from './transcript.js';

describe('TranscriptModel (T-INV)', () => {
  it('builds a valid, ordered model from raw words', () => {
    const { transcript } = scene();
    expect(transcript.order).toHaveLength(5);
    expect(Object.keys(transcript.words)).toHaveLength(5);
    expect(validateTranscript(transcript)).toEqual([]);
  });

  it('sorts words by sourceStart (T-INV-2)', () => {
    const w = [
      makeWord('second', 200_000, 250_000),
      makeWord('first', 0, 50_000),
      makeWord('third', 400_000, 450_000),
    ];
    const m = buildTranscriptModel(w, 'm1', 'en');
    const ordered = m.order.map((id) => m.words[id]!.text);
    expect(ordered).toEqual(['first', 'second', 'third']);
    expect(validateTranscript(m)).toEqual([]);
  });

  it('detects T-INV-1 (order/words mismatch)', () => {
    const { transcript } = scene();
    const broken = { ...transcript, order: transcript.order.slice(0, 3) };
    expect(validateTranscript(broken).some((e) => e.startsWith('T-INV-1'))).toBe(true);
  });

  it('detects T-INV-3 (non-positive duration)', () => {
    const bad = buildTranscriptModel([makeWord('x', 100_000, 100_000)], 'm1', 'en');
    expect(validateTranscript(bad).some((e) => e.startsWith('T-INV-3'))).toBe(true);
  });

  it('detects T-INV-4 (empty text)', () => {
    const bad = buildTranscriptModel([makeWord('   ', 0, 50_000)], 'm1', 'en');
    expect(validateTranscript(bad).some((e) => e.startsWith('T-INV-4'))).toBe(true);
  });
});
