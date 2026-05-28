import { describe, expect, it } from 'vitest';
import { scene } from './_testkit.js';
import { deleteWordRange } from './commands.js';
import { timelineToEdl } from './edl.js';
import { programToSegment, programToSource, simulateSeeks } from './preview.js';

describe('preview (EDL playback, cut skipping)', () => {
  it('programToSource skips the cut region', () => {
    const { transcript, timeline } = scene(); // 5 words, source 500ms
    const mid = transcript.order[2]!; // remove charlie [200ms,290ms)
    const { after } = deleteWordRange(timeline, transcript, mid, mid);
    const edl = timelineToEdl(after, '/x/sample.mp4');

    // first segment is [0, 200ms) snapped; program time 0 → source 0
    expect(programToSource(edl, 0)).toBe(0);
    // a program time just after the cut maps into the right segment's source
    // (which starts at ~290ms snapped), i.e. source jumps forward past the cut.
    const sourceAfterCut = programToSource(
      edl,
      edl.segments[0]!.sourceEnd - edl.segments[0]!.sourceStart,
    );
    expect(sourceAfterCut).toBe(edl.segments[1]!.sourceStart);
    expect(edl.segments[1]!.sourceStart).toBeGreaterThan(edl.segments[0]!.sourceEnd);
  });

  it('issues one seek per segment when stepping through the program', () => {
    const { transcript, timeline } = scene();
    const mid = transcript.order[2]!;
    const { after } = deleteWordRange(timeline, transcript, mid, mid);
    const edl = timelineToEdl(after, '/x/sample.mp4');

    const seeks = simulateSeeks(edl, 5_000); // 5ms steps
    expect(seeks).toHaveLength(edl.segments.length);
    expect(seeks).toEqual(edl.segments.map((s) => s.sourceStart));
  });

  it('programToSegment returns -1 past the end', () => {
    const { timeline } = scene();
    const edl = timelineToEdl(timeline, '/x/sample.mp4');
    expect(programToSegment(edl, edl.totalDuration + 1)).toBe(-1);
  });
});
