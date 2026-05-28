import { validateSync } from './sync.js';
import { validateTimeline } from './timeline.js';
import { validateTranscript } from './transcript.js';
import type { TimelineModel, TranscriptModel } from './types.js';

/** A persisted dawn-cut project (.dawn = this JSON). */
export interface Project {
  schemaVersion: 1;
  mediaPath: string;
  transcript: TranscriptModel;
  timeline: TimelineModel;
}

export function makeProject(
  mediaPath: string,
  transcript: TranscriptModel,
  timeline: TimelineModel,
): Project {
  return { schemaVersion: 1, mediaPath, transcript, timeline };
}

/** Serialize a project to a .dawn JSON string. */
export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

/**
 * Parse + validate a .dawn document. Throws if the schema is wrong or any
 * model invariant is violated (a corrupt project must not load silently).
 */
export function deserializeProject(json: string): Project {
  const raw = JSON.parse(json) as Partial<Project>;
  if (raw.schemaVersion !== 1)
    throw new Error(`unsupported project schemaVersion: ${raw.schemaVersion}`);
  if (typeof raw.mediaPath !== 'string') throw new Error('project: missing mediaPath');
  if (!raw.transcript || !raw.timeline) throw new Error('project: missing transcript/timeline');
  const p = raw as Project;
  const errors = validateProject(p);
  if (errors.length) throw new Error(`invalid project:\n${errors.join('\n')}`);
  return p;
}

/** Returns a list of violations ([] == valid): model invariants + sync. */
export function validateProject(p: Project): string[] {
  return [
    ...validateTranscript(p.transcript),
    ...validateTimeline(p.timeline),
    ...validateSync(p.timeline, p.transcript),
  ];
}
