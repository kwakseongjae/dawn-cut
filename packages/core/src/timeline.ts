import { randomUUID } from './id.js';
import { frameUs, snapToFrame } from './time.js';
import type { Clip, TimelineModel, Track, Transition } from './types.js';

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

  // TL-INV-5(B4): 전환은 존재하는 클립의 '뒤' 경계만, 경계당 1개, D ≤ min(양쪽 길이).
  if (m.transitions && m.transitions.length > 0) {
    const order = videoClips(m);
    const idxOf = new Map(order.map((c, i) => [c.id, i]));
    const seen = new Set<string>();
    for (const tr of m.transitions) {
      const i = idxOf.get(tr.afterClipId);
      if (i === undefined) {
        errors.push(`TL-INV-5: transition ${tr.id} references missing clip ${tr.afterClipId}`);
        continue;
      }
      if (i >= order.length - 1) {
        errors.push(`TL-INV-5: transition ${tr.id} after last clip`);
        continue;
      }
      if (seen.has(tr.afterClipId)) {
        errors.push(`TL-INV-5: duplicate transition at boundary ${tr.afterClipId}`);
      }
      seen.add(tr.afterClipId);
      const maxD = Math.min(clipDuration(order[i]!), clipDuration(order[i + 1]!));
      if (tr.durationUs < frameUs(m.fps) || tr.durationUs > maxD) {
        errors.push(`TL-INV-5: transition ${tr.id} duration ${tr.durationUs} out of range`);
      }
    }
  }

  return errors;
}

/**
 * 구조 편집(컷/분할/리플) 후 전환 정합 — 깨진 참조·마지막 경계·중복은 버리고,
 * 과대 D는 min(양쪽 길이)로 프레임 스냅 클램프(1프레임 미만이 되면 버림). 결정적.
 */
export function reconcileTransitions(
  transitions: Transition[] | undefined,
  m: TimelineModel,
): Transition[] | undefined {
  if (!transitions || transitions.length === 0) return undefined;
  const order = videoClips(m);
  const idxOf = new Map(order.map((c, i) => [c.id, i]));
  const seen = new Set<string>();
  const out: Transition[] = [];
  for (const tr of transitions) {
    const i = idxOf.get(tr.afterClipId);
    if (i === undefined || i >= order.length - 1 || seen.has(tr.afterClipId)) continue;
    const maxD = Math.min(clipDuration(order[i]!), clipDuration(order[i + 1]!));
    const d = snapToFrame(Math.min(tr.durationUs, maxD), m.fps);
    if (d < frameUs(m.fps)) continue;
    seen.add(tr.afterClipId);
    out.push(d === tr.durationUs ? tr : { ...tr, durationUs: d });
  }
  return out.length > 0 ? out : undefined;
}
