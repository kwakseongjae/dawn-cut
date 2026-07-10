/**
 * Data contracts — see docs/poc/04-DATA-CONTRACTS.md (single source of truth).
 * Time is integer microseconds (µs). Intervals are half-open [start, end).
 */
import type { ClipEffect } from './effects.js';

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
  // 렌더 이펙트(펀치인 줌·색보정). 길이를 바꾸지 않는 픽셀 메타라 TL/SYNC/EDL 불변식 무영향.
  effects?: ClipEffect[];
  /** B5 배속(0.5~3, 생략=1). 프로그램 길이 = round(소스 길이 / speed) — clipProgramDuration이 단일 산식. */
  speed?: number;
}

export interface Track {
  id: string;
  kind: 'video' | 'audio';
  clips: string[]; // Clip.id, ascending timelineStart
}

// ── 전환(B4/#8) — 경계 장식. 프로그램 길이·클립 좌표 완전 불변(렌더에서만 소스 핸들 오버랩) ──
export type TransitionKind = 'crossfade' | 'dipToBlack';
export interface Transition {
  id: string;
  /** 경계 주소 = 앞 클립 id (그 클립 '뒤' 경계). 마지막 클립 뒤는 불가(TL-INV-5). */
  afterClipId: string;
  kind: TransitionKind;
  durationUs: number; // 전환 총 길이(경계 양쪽에서 D/2씩)
}

export interface TimelineModel {
  schemaVersion: 1;
  fps: number;
  clips: Record<string, Clip>;
  tracks: Track[];
  durationProgram: number; // derived cache = max(clipTimelineEnd)
  /** 경계 전환(없으면 undefined — 전환 없는 렌더 인자 바이트 동일 보장) */
  transitions?: Transition[];
}

// ── §5 EDL (Export Decision List) ───────────────────────────────────
export interface EdlSegment {
  mediaPath: string;
  sourceStart: number; // µs
  sourceEnd: number; // µs
  programStart: number; // µs (B5: 프로그램 길이 = round(소스 길이/speed)로 적층)
  effects?: ClipEffect[]; // 클립 이펙트를 EDL로 전달 → 렌더러가 세그먼트별 필터 적용
  /** B5 배속(생략=1) — 렌더러가 setpts/atempo로 구현 */
  speed?: number;
}

export interface Edl {
  fps: number;
  segments: EdlSegment[]; // ascending programStart, contiguous
  totalDuration: number; // µs == Σ segment length (EDL-INV-1)
  /** 경계 전환 — afterIndex = 앞 세그먼트 인덱스(0..n-2). 렌더러가 xfade/fade로 구현 */
  transitions?: Array<{ afterIndex: number; kind: TransitionKind; durationUs: number }>;
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
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back';
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
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back';
  }>;
  /** Constant rotation in degrees (optional). */
  rotation?: number;
  /** GPU-style blend mode (optional). Defaults to plain alpha overlay. */
  blend?: 'normal' | 'screen' | 'multiply' | 'overlay' | 'lighten' | 'darken';
}

// ── §4 EditCommand ──────────────────────────────────────────────────
// EditCommand(직렬화 명령 유니언)와 디스패처는 edit-command.ts로 이전됨
// (Zod 단일 진실원천 → 타입·런타임가드·JSON스키마 파생). CommandResult는 유지.

export interface CommandResult {
  before: TimelineModel;
  after: TimelineModel;
  removedProgramUs: number;
}
