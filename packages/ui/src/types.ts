import type { Edl, OverlayClip, VideoStats, Word } from '@dawn-cut/core';

// Structural mirrors of the sidecar return types (ui must not depend on node sidecars).
export interface ProbeResult {
  durationUs: number;
  fps: number;
  hasAudio: boolean;
  width: number;
  height: number;
  vcodec: string; // 비디오 코덱(h264/hevc/…)
  level: number; // H.264 level×10 (5.2→52)
}
export interface SilenceInterval {
  start: number;
  end: number;
}
export interface TranscribeResult {
  language: string;
  words: Word[];
}
/** Structural mirror of @dawn-cut/sidecar-llm LlmStatus (ui must not depend on node sidecars). */
export interface LlmStatus {
  available: boolean;
  binPath: string;
  modelPath: string;
  reason?: string;
}
/** Typed IPC bridge exposed by the Electron preload (contextBridge). */
export interface DawnBridge {
  /** 고급(전체) UI 노출 여부 — DAWN_ADVANCED=1. false면 쇼케이스용 단순 UI. */
  advanced: boolean;
  /** 드래그앤드롭 File의 실제 경로(Electron webUtils.getPathForFile). */
  pathForFile: (file: File) => string;
  ping: () => Promise<string>;
  probe: (path: string) => Promise<ProbeResult>;
  extractAudio: (path: string) => Promise<{ wavPath: string }>;
  transcribe: (wavPath: string, mediaId: string) => Promise<TranscribeResult>;
  detectSilences: (
    path: string,
    opts?: { noiseDb?: number; minSilenceUs?: number },
  ) => Promise<SilenceInterval[]>;
  analyzeVideo: (path: string) => Promise<VideoStats>;
  makePreviewProxy: (path: string) => Promise<{ path: string }>;
  render: (
    edl: Edl,
    outPath: string,
    opts?: {
      subtitlesPath?: string;
      format?: 'mp4' | 'gif';
      overlays?: OverlayClip[];
      frameW?: number;
      frameH?: number;
      reframe?: 'source' | '9:16' | '1:1';
      voicePath?: string;
      voiceStartUs?: number;
    },
  ) => Promise<{ outPath: string; actualDurationUs: number }>;
  writeSrt: (path: string, content: string) => Promise<{ path: string }>;
  writeAsset: (dataUrl: string) => Promise<{ path: string }>;
  synthesizeTts: (
    text: string,
    voice: string,
  ) => Promise<{ wavPath: string; engine: string; voice: string; durationUs: number }>;
  /** 설치된 TTS 보이스 목록(언어 태그 포함). macOS `say -v '?'`. */
  listTtsVoices: () => Promise<{ name: string; lang: string }[]>;
  saveProject: (path: string, content: string) => Promise<{ path: string }>;
  openProject: (path: string) => Promise<string>;
  openFile: () => Promise<string | null>;
  saveFile: () => Promise<string | null>;
  revealItem: (path: string) => Promise<void>;
  // P3 LLM: 로컬 플래너(llama.cpp). 부재/비활성 시 store가 룰 플래너로 폴백한다.
  llmAvailable: () => Promise<LlmStatus>;
  llmWarmup: () => Promise<{ ready: boolean; ms: number; reason?: string }>;
  llmPlan: (prompt: string) => Promise<{ text: string; ms: number }>;
}

declare global {
  interface Window {
    dawn?: DawnBridge;
    // automation surface for E2E (path-dependent steps); harmless in production.
    __editor?: {
      importPath: (path: string) => Promise<void>;
      transcribe: () => Promise<void>;
      importAndTranscribe: (path: string) => Promise<void>;
      exportTo: (path: string) => Promise<void>;
      exportSrt: (path: string) => Promise<void>;
      saveProject: (path: string) => Promise<void>;
      openProject: (path: string) => Promise<void>;
      exportGif: (path: string) => Promise<void>;
      addImageOverlay: (path: string) => Promise<void>;
      planAndPreview: (input: string) => Promise<void>;
      approvePlan: () => void;
      rejectPlan: () => void;
      applyStylePack: (id: string) => void;
      autoEnhance: () => Promise<void>;
      correctWord: (wordId: string, text: string) => void;
      autoHighlight: (targetSeconds: number) => void;
      detectLlm: () => Promise<void>;
    };
    // QA/검증용 읽기 스냅샷(상태 단언). 무해한 자동화 표면.
    __dawnState?: () => Record<string, unknown>;
  }
}
