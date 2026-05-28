/**
 * Data contracts — see docs/poc/04-DATA-CONTRACTS.md (single source of truth).
 * Time is integer microseconds (µs). Intervals are half-open [start, end).
 */

// ── §1 TranscriptModel ──────────────────────────────────────────────
export interface Word {
  id: string;
  text: string;
  sourceStart: number; // µs, in source media timeline
  sourceEnd: number; // µs, sourceEnd > sourceStart (T-INV-3)
  confidence: number; // 0..1
  mediaId: string;
}

export interface TranscriptSegment {
  id: string;
  words: string[]; // Word.id, in order
  speaker?: string;
}

export interface TranscriptModel {
  schemaVersion: 1;
  mediaId: string;
  language: string;
  words: Record<string, Word>;
  order: string[]; // global display order of Word.id
  segments: TranscriptSegment[];
}

// ── §2 TimelineModel ────────────────────────────────────────────────
export interface Clip {
  id: string;
  mediaId: string;
  sourceStart: number; // µs (source coords)
  sourceEnd: number; // µs (source coords)
  timelineStart: number; // µs (program coords)
}

export interface Track {
  id: string;
  kind: 'video' | 'audio';
  clips: string[]; // Clip.id, ascending timelineStart
}

export interface TimelineModel {
  schemaVersion: 1;
  fps: number;
  clips: Record<string, Clip>;
  tracks: Track[];
  durationProgram: number; // derived cache = max(clipTimelineEnd)
}

// ── §5 EDL (Export Decision List) ───────────────────────────────────
export interface EdlSegment {
  mediaPath: string;
  sourceStart: number; // µs
  sourceEnd: number; // µs
  programStart: number; // µs
}

export interface Edl {
  fps: number;
  segments: EdlSegment[]; // ascending programStart, contiguous
  totalDuration: number; // µs == Σ segment length (EDL-INV-1)
}

// ── Overlay compositing (image/sticker/gif) ────────────────────────
export interface OverlayClip {
  id: string;
  kind: 'image' | 'sticker' | 'gif' | 'subtitle' | 'video';
  src: string; // file path (image/gif) or rasterized PNG path (sticker)
  x: number; // normalized top-left 0..1
  y: number; // normalized top-left 0..1
  scale: number; // overlay width as fraction of frame width, (0,1]
  opacity: number; // 0..1
  startUs: number; // program coords
  endUs: number; // program coords
  z: number; // stacking order (lower = below)
  /** 2-keyframe shortcut: animate base→to over [startUs,endUs]. */
  to?: {
    x?: number;
    y?: number;
    scale?: number;
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  };
  /**
   * Multi-keyframe motion path. Each entry has `u` in [0,1] (normalized progress
   * over [startUs,endUs]). Missing fields carry forward. Takes precedence over `to`.
   */
  keyframes?: Array<{
    u: number;
    x?: number;
    y?: number;
    scale?: number;
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  }>;
  /** Constant rotation in degrees (optional). */
  rotation?: number;
  /** GPU-style blend mode (optional). Defaults to plain alpha overlay. */
  blend?: 'normal' | 'screen' | 'multiply' | 'overlay' | 'lighten' | 'darken';
}

// ── §4 EditCommand ──────────────────────────────────────────────────
export type EditCommand =
  | { type: 'deleteWordRange'; fromWordId: string; toWordId: string }
  | { type: 'removeSilences'; minSilenceUs: number; padUs: number };

export interface CommandResult {
  before: TimelineModel;
  after: TimelineModel;
  removedProgramUs: number;
}
