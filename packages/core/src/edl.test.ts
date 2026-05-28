import { describe, expect, it } from 'vitest';
import { scene } from './_testkit.js';
import { deleteWordRange } from './commands.js';
import { timelineToEdl, validateEdl } from './edl.js';

describe('EDL (EDL-INV)', () => {
  it('initial timeline → single contiguous segment, valid', () => {
    const { timeline } = scene();
    const edl = timelineToEdl(timeline, '/x/sample.mp4');
    expect(edl.segments).toHaveLength(1);
    expect(edl.totalDuration).toBe(timeline.durationProgram);
    expect(validateEdl(edl, timeline)).toEqual([]);
  });

  it('after a cut → multiple segments, Σ == totalDuration == durationProgram', () => {
    const { transcript, timeline } = scene();
    const mid = transcript.order[2]!;
    const { after } = deleteWordRange(timeline, transcript, mid, mid);
    const edl = timelineToEdl(after, '/x/sample.mp4');

    const sum = edl.segments.reduce((a, s) => a + (s.sourceEnd - s.sourceStart), 0);
    expect(sum).toBe(edl.totalDuration); // EDL-INV-1
    expect(edl.totalDuration).toBe(after.durationProgram); // EDL-INV-2
    expect(validateEdl(edl, after)).toEqual([]);
  });

  it('detects EDL-INV-2 violation when totalDuration is tampered', () => {
    const { timeline } = scene();
    const edl = timelineToEdl(timeline, '/x/sample.mp4');
    const broken = { ...edl, totalDuration: edl.totalDuration + 1 };
    expect(validateEdl(broken, timeline).some((e) => e.startsWith('EDL-INV-1'))).toBe(true);
  });
});
