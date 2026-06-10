import type { SubtitleStyle } from './draw.js';
import type { ColorEq } from './effects.js';
import type { GlossaryPair } from './glossary.js';
import { validateSync } from './sync.js';
import { validateTimeline } from './timeline.js';
import { validateTranscript } from './transcript.js';
import type { OverlayClip, TimelineModel, TranscriptModel } from './types.js';

export interface SubtitlePos {
  x: number;
  y: number;
  scale: number;
}

/** 저장되는 오버레이 — core OverlayClip + UI 표시 필드(name/text/cueStyle). */
export interface ProjectOverlay extends OverlayClip {
  name?: string;
  text?: string;
  cueStyle?: SubtitleStyle;
}

/** 저장되는 수기 자막 cue(프로그램 µs + cue별 위치). */
export interface ProjectManualCue {
  id: string;
  text: string;
  startUs: number;
  endUs: number;
  pos?: SubtitlePos;
}

/** 저장되는 TTS 클립(재합성 대비 합성 파라미터 포함). */
export interface ProjectTtsClip {
  id: string;
  voice: string;
  text: string;
  wavPath?: string;
  startUs: number;
  endUs: number;
  opts?: { rate?: number; pitch?: number; style?: string };
}

/**
 * A persisted dawn-cut project (.dawn = this JSON).
 * schemaVersion 1 = pre-subtitleSettings, 2 = +subtitlePos/Style,
 * 3 = 작업 현황 전체(overlays/manualCues/ttsClips/reframe/색/사전) — issue #17.
 * v1/v2 문서는 그대로 읽힌다(신규 필드 전부 optional).
 */
export interface Project {
  schemaVersion: 1 | 2 | 3;
  mediaPath: string;
  transcript: TranscriptModel;
  timeline: TimelineModel;
  subtitlePos?: SubtitlePos;
  subtitleStyle?: SubtitleStyle;
  // ── v3 작업 현황(전부 optional — 하위호환) ──
  overlays?: ProjectOverlay[];
  manualCues?: ProjectManualCue[];
  ttsClips?: ProjectTtsClip[];
  reframe?: 'source' | '9:16' | '1:1';
  /** UI 미러용(렌더 진실원천은 timeline clip effects). */
  colorPreset?: string;
  autoEnhanceEq?: ColorEq | null;
  glossary?: GlossaryPair[];
}

export interface ProjectExtras {
  subtitlePos?: SubtitlePos;
  subtitleStyle?: SubtitleStyle;
  overlays?: ProjectOverlay[];
  manualCues?: ProjectManualCue[];
  ttsClips?: ProjectTtsClip[];
  reframe?: 'source' | '9:16' | '1:1';
  colorPreset?: string;
  autoEnhanceEq?: ColorEq | null;
  glossary?: GlossaryPair[];
}

export function makeProject(
  mediaPath: string,
  transcript: TranscriptModel,
  timeline: TimelineModel,
  extras?: ProjectExtras,
): Project {
  return {
    schemaVersion: 3,
    mediaPath,
    transcript,
    timeline,
    ...(extras?.subtitlePos ? { subtitlePos: extras.subtitlePos } : {}),
    ...(extras?.subtitleStyle ? { subtitleStyle: extras.subtitleStyle } : {}),
    ...(extras?.overlays?.length ? { overlays: extras.overlays } : {}),
    ...(extras?.manualCues?.length ? { manualCues: extras.manualCues } : {}),
    ...(extras?.ttsClips?.length ? { ttsClips: extras.ttsClips } : {}),
    ...(extras?.reframe && extras.reframe !== 'source' ? { reframe: extras.reframe } : {}),
    ...(extras?.colorPreset && extras.colorPreset !== 'none'
      ? { colorPreset: extras.colorPreset }
      : {}),
    ...(extras?.autoEnhanceEq ? { autoEnhanceEq: extras.autoEnhanceEq } : {}),
    ...(extras?.glossary?.length ? { glossary: extras.glossary } : {}),
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
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3)
    throw new Error(`unsupported project schemaVersion: ${raw.schemaVersion}`);
  if (typeof raw.mediaPath !== 'string') throw new Error('project: missing mediaPath');
  if (!raw.transcript || !raw.timeline) throw new Error('project: missing transcript/timeline');
  const p = raw as Project;
  const errors = validateProject(p);
  if (errors.length) throw new Error(`invalid project:\n${errors.join('\n')}`);
  return p;
}

/** Returns a list of violations ([] == valid): model invariants + sync + v3 작업 현황 기본 검증. */
export function validateProject(p: Project): string[] {
  const errors = [
    ...validateTranscript(p.transcript),
    ...validateTimeline(p.timeline),
    ...validateSync(p.timeline, p.transcript),
  ];
  // v3 작업 현황 — 시간 구간 양수 검증(파손 파일이 조용히 로드되지 않게).
  for (const o of p.overlays ?? []) {
    if (!(o.endUs > o.startUs)) errors.push(`PRJ-OVL: overlay ${o.id} has non-positive span`);
  }
  for (const c of p.manualCues ?? []) {
    if (!(c.endUs > c.startUs)) errors.push(`PRJ-CUE: manualCue ${c.id} has non-positive span`);
  }
  for (const t of p.ttsClips ?? []) {
    if (!(t.endUs > t.startUs)) errors.push(`PRJ-TTS: ttsClip ${t.id} has non-positive span`);
  }
  return errors;
}
