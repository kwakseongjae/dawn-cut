import { describe, expect, it } from 'vitest';
import { scene } from './_testkit.js';
import { deleteWordRange, removeSilences, undo } from './commands.js';
import { liveWords, validateSync } from './sync.js';
import { createInitialTimeline, validateTimeline } from './timeline.js';

describe('deleteWordRange (concrete)', () => {
  it('deleting the middle word ripples the timeline and drops it from live words', () => {
    const { transcript, timeline } = scene(); // 5 words, [k*100ms, +90ms), source 500ms
    const mid = transcript.order[2]!; // "charlie" [200ms,290ms)
    const res = deleteWordRange(timeline, transcript, mid, mid);

    expect(res.removedProgramUs).toBeGreaterThan(0);
    expect(res.after.durationProgram).toBe(res.before.durationProgram - res.removedProgramUs);
    expect(validateTimeline(res.after)).toEqual([]);
    expect(validateSync(res.after, transcript)).toEqual([]);
    expect(liveWords(res.after, transcript)).not.toContain(mid);
    // undo restores
    expect(undo(res)).toEqual(res.before);
  });
});

describe('removeSilences (concrete)', () => {
  it('removes two silent intervals and conserves duration', () => {
    const timeline = createInitialTimeline('m1', 1_000_000, 30); // 1s
    const res = removeSilences(
      timeline,
      'm1',
      [
        { start: 200_000, end: 300_000 },
        { start: 600_000, end: 800_000 },
      ],
      0,
    );
    expect(validateTimeline(res.after)).toEqual([]);
    // ~300ms removed (±2 frames for snapping)
    expect(Math.abs(res.removedProgramUs - 300_000)).toBeLessThanOrEqual(3 * 33_333);
    expect(undo(res)).toEqual(res.before);
  });
});
