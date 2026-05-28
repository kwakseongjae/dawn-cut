import type { SubtitleStyle } from './draw.js';
import { validateSync } from './sync.js';
import { validateTimeline } from './timeline.js';
import { validateTranscript } from './transcript.js';
import type { TimelineModel, TranscriptModel } from './types.js';

export interface SubtitlePos {
  x: number;
  y: number;
  scale: number;
}

/** A persisted dawn-cut project (.dawn = this JSON). schemaVersion 1 = pre-subtitleSettings. */
export interface Project {
  schemaVersion: 1 | 2;
  mediaPath: string;
  transcript: TranscriptModel;
  timeline: TimelineModel;
  subtitlePos?: SubtitlePos;
  subtitleStyle?: SubtitleStyle;
}

export function makeProject(
  mediaPath: string,
  transcript: TranscriptModel,
  timeline: TimelineModel,
  extras?: { subtitlePos?: SubtitlePos; subtitleStyle?: SubtitleStyle },
): Project {
  return {
    schemaVersion: 2,
    mediaPath,
    transcript,
    timeline,
    ...(extras?.subtitlePos ? { subtitlePos: extras.subtitlePos } : {}),
    ...(extras?.subtitleStyle ? { subtitleStyle: extras.subtitleStyle } : {}),
  };
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
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2)
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
