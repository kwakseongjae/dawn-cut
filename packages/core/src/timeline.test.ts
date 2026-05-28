import { describe, expect, it } from 'vitest';
import {
  clipDuration,
  clipTimelineEnd,
  createInitialTimeline,
  recomputeDuration,
  validateTimeline,
} from './timeline.js';
import type { Clip, TimelineModel } from './types.js';

describe('TimelineModel (TL-INV)', () => {
  it('createInitialTimeline: one clip spanning whole source', () => {
    const m = createInitialTimeline('m1', 500_000, 30);
    expect(Object.keys(m.clips)).toHaveLength(1);
    expect(m.durationProgram).toBe(500_000);
    expect(validateTimeline(m)).toEqual([]);
  });

  it('derived clipDuration / clipTimelineEnd', () => {
    const c: Clip = {
      id: 'c',
      mediaId: 'm1',
      sourceStart: 100_000,
      sourceEnd: 250_000,
      timelineStart: 40_000,
    };
    expect(clipDuration(c)).toBe(150_000);
    expect(clipTimelineEnd(c)).toBe(190_000);
  });

  it('valid gapless two-clip timeline passes', () => {
    const c1: Clip = {
      id: 'c1',
      mediaId: 'm1',
      sourceStart: 0,
      sourceEnd: 100_000,
      timelineStart: 0,
    };
    const c2: Clip = {
      id: 'c2',
      mediaId: 'm1',
      sourceStart: 200_000,
      sourceEnd: 300_000,
      timelineStart: 100_000,
    };
    const m: TimelineModel = {
      schemaVersion: 1,
      fps: 30,
      clips: { c1, c2 },
      tracks: [{ id: 't', kind: 'video', clips: ['c1', 'c2'] }],
      durationProgram: 200_000,
    };
    expect(m.durationProgram).toBe(recomputeDuration(m));
    expect(validateTimeline(m)).toEqual([]);
  });

  it('detects TL-INV-1 (overlap)', () => {
    const c1: Clip = {
      id: 'c1',
      mediaId: 'm1',
      sourceStart: 0,
      sourceEnd: 100_000,
      timelineStart: 0,
    };
    const c2: Clip = {
      id: 'c2',
      mediaId: 'm1',
      sourceStart: 0,
      sourceEnd: 100_000,
      timelineStart: 50_000,
    };
    const m: TimelineModel = {
      schemaVersion: 1,
      fps: 30,
      clips: { c1, c2 },
      tracks: [{ id: 't', kind: 'video', clips: ['c1', 'c2'] }],
      durationProgram: 150_000,
    };
    expect(validateTimeline(m).some((e) => e.startsWith('TL-INV-1'))).toBe(true);
  });

  it('detects TL-INV-2 (gap) on video track', () => {
    const c1: Clip = {
      id: 'c1',
      mediaId: 'm1',
      sourceStart: 0,
      sourceEnd: 100_000,
      timelineStart: 0,
    };
    const c2: Clip = {
      id: 'c2',
      mediaId: 'm1',
      sourceStart: 0,
      sourceEnd: 100_000,
      timelineStart: 150_000,
    };
    const m: TimelineModel = {
      schemaVersion: 1,
      fps: 30,
      clips: { c1, c2 },
      tracks: [{ id: 't', kind: 'video', clips: ['c1', 'c2'] }],
      durationProgram: 250_000,
    };
    expect(validateTimeline(m).some((e) => e.startsWith('TL-INV-2'))).toBe(true);
  });

  it('detects TL-INV-4 (stale durationProgram)', () => {
    const m = createInitialTimeline('m1', 500_000, 30);
    m.durationProgram = 999_999;
    expect(validateTimeline(m).some((e) => e.startsWith('TL-INV-4'))).toBe(true);
  });
});
