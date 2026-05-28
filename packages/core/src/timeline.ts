import { randomUUID } from './id.js';
import type { Clip, TimelineModel, Track } from './types.js';

export function clipDuration(c: Clip): number {
  return c.sourceEnd - c.sourceStart;
}

export function clipTimelineEnd(c: Clip): number {
  return c.timelineStart + clipDuration(c);
}

/** Video clips of a timeline in program order. */
export function videoClips(m: TimelineModel): Clip[] {
  const track = m.tracks.find((t) => t.kind === 'video');
  if (!track) return [];
  return track.clips.map((id) => m.clips[id]!).filter(Boolean);
}

/** Recompute durationProgram cache from clips (max timelineEnd). */
export function recomputeDuration(m: TimelineModel): number {
  let max = 0;
  for (const id of Object.keys(m.clips)) {
    const end = clipTimelineEnd(m.clips[id]!);
    if (end > max) max = end;
  }
  return max;
}

/**
 * Initial timeline: one video track with one clip spanning the whole source.
 * (04 §2 — PoC single track / single source.)
 */
export function createInitialTimeline(
  mediaId: string,
  sourceDurationUs: number,
  fps: number,
): TimelineModel {
  const clip: Clip = {
    id: randomUUID(),
    mediaId,
    sourceStart: 0,
    sourceEnd: sourceDurationUs,
    timelineStart: 0,
  };
  const track: Track = { id: randomUUID(), kind: 'video', clips: [clip.id] };
  return {
    schemaVersion: 1,
    fps,
    clips: { [clip.id]: clip },
    tracks: [track],
    durationProgram: sourceDurationUs,
  };
}

/** Returns a list of TL-INV violations ([] == valid). */
export function validateTimeline(m: TimelineModel): string[] {
  const errors: string[] = [];

  for (const t of m.tracks) {
    const clips = t.clips.map((id) => m.clips[id]).filter(Boolean) as Clip[];
    if (clips.length !== t.clips.length) errors.push(`TL: track ${t.id} references missing clip`);

    for (let i = 0; i < clips.length; i++) {
      const c = clips[i]!;
      // TL-INV-3
      if (c.sourceEnd <= c.sourceStart)
        errors.push(`TL-INV-3: clip ${c.id} sourceEnd<=sourceStart`);
      if (c.timelineStart < 0) errors.push(`TL-INV-3: clip ${c.id} timelineStart<0`);

      if (i > 0) {
        const prev = clips[i - 1]!;
        // TL-INV-1: no overlap
        if (clipTimelineEnd(prev) > c.timelineStart) {
          errors.push(`TL-INV-1: clips ${prev.id}/${c.id} overlap`);
        }
        // TL-INV-2: gapless (ripple) — only enforced on video track for PoC
        if (t.kind === 'video' && clipTimelineEnd(prev) !== c.timelineStart) {
          errors.push(`TL-INV-2: gap between ${prev.id} and ${c.id}`);
        }
      }
    }
  }

  // TL-INV-4: durationProgram cache correct
  if (m.durationProgram !== recomputeDuration(m)) {
    errors.push('TL-INV-4: durationProgram stale');
  }

  return errors;
}
