import { describe, expect, it } from 'vitest';
import { scene } from './_testkit.js';
import { deleteWordRange } from './commands.js';
import { formatSrt, transcriptToCues, validateCues } from './subtitles.js';

describe('subtitles (SUB-INV)', () => {
  it('builds cues for every live word, in program order, valid', () => {
    const { transcript, timeline } = scene(); // 5 words [k*100ms, +90ms)
    const cues = transcriptToCues(transcript, timeline, { maxGapUs: 50_000, maxWordsPerCue: 8 });
    expect(cues.length).toBeGreaterThan(0);
    expect(validateCues(cues, timeline)).toEqual([]);
    // all 5 words present across cues
    const text = cues.map((c) => c.text).join(' ');
    for (const w of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) expect(text).toContain(w);
  });

  it('breaks a cue at a program gap caused by a cut', () => {
    const { transcript, timeline } = scene();
    const mid = transcript.order[2]!; // remove charlie → gap in the middle
    const { after } = deleteWordRange(timeline, transcript, mid, mid);
    const cues = transcriptToCues(transcript, after, { maxGapUs: 50_000, maxWordsPerCue: 8 });
    expect(validateCues(cues, after)).toEqual([]);
    // charlie removed → not present
    expect(cues.map((c) => c.text).join(' ')).not.toContain('charlie');
  });

  it('formatSrt emits well-formed timestamps', () => {
    const srt = formatSrt([
      { index: 1, startUs: 0, endUs: 1_500_000, text: 'hello world' },
      { index: 2, startUs: 2_000_000, endUs: 3_250_000, text: 'second cue' },
    ]);
    expect(srt).toContain('00:00:00,000 --> 00:00:01,500');
    expect(srt).toContain('00:00:02,000 --> 00:00:03,250');
    expect(srt).toContain('hello world');
  });

  it('detects SUB-INV-2 (empty / inverted cue)', () => {
    const { timeline } = scene();
    const bad = [{ index: 1, startUs: 100, endUs: 100, text: 'x' }];
    expect(validateCues(bad, timeline).some((e) => e.startsWith('SUB-INV-2'))).toBe(true);
  });
});
