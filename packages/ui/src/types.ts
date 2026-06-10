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
    opts?: { rate?: number; pitch?: number; volume?: number; style?: string },
  ) => Promise<{
    wavPath: string;
    engine: string;
    voice: string;
    durationUs: number;
    /** 클라우드 합성 실패 → 로컬 폴백 시 사유(사람이 읽을 메시지). */
    cloudError?: string;
  }>;
  /** 설치된 TTS 보이스 목록(언어 태그 포함). macOS `say -v '?'`. */
  listTtsVoices: () => Promise<{ name: string; lang: string }[]>;
  /** 클라우드 보이스 카탈로그('던' 시그니처 등) — opt-in 시 보이스 셀렉트에 노출. */
  cloudTtsVoices?: () => Promise<{ id: string; label: string }[]>;
  /** 설정(API 키는 보유 여부만 노출 — 원문은 main에만). */
  getSettings?: () => Promise<{ ttsEngine: 'local' | 'cloud'; hasOpenaiKey: boolean }>;
  setSettings?: (patch: {
    openaiApiKey?: string | null;
    ttsEngine?: 'local' | 'cloud';
  }) => Promise<{ ttsEngine: 'local' | 'cloud'; hasOpenaiKey: boolean }>;
  /** 번들된 모션 스티커(애니 GIF) 목록 — 로컬 생성·번들(클라우드 의존 없음). 절대경로. */
  motionStickers: () => Promise<{ name: string; path: string }[]>;
  /** TTS 엔진 상태 — 뉴럴(Piper) 사용 가능 여부. 미설치면 macOS say 폴백. */
  ttsEngineStatus: () => Promise<{
    available: boolean;
    binPath: string;
    modelPath: string;
    reason?: string;
  }>;
  saveProject: (path: string, content: string) => Promise<{ path: string }>;
  openProject: (path: string) => Promise<string>;
  /** 작업 현황 저장 — tmp 에셋(PNG/wav)을 .dawn 옆 .assets/로 복사, {원경로→새경로} 반환. */
  archiveAssets: (dawnPath: string, files: string[]) => Promise<Record<string, string>>;
  /** 자동저장(단일 슬롯, userData/autosave.dawn) — 비정상 종료 복구용. */
  autosaveWrite: (content: string) => Promise<{ path: string; savedAtMs: number }>;
  autosaveRead: () => Promise<{ content: string; savedAtMs: number; path: string } | null>;
  autosaveClear: () => Promise<{ ok: boolean }>;
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
      addManualCue: (text: string) => void;
      setPlayhead: (us: number) => void;
      addOverlaySrc: (kind: 'image' | 'gif' | 'video', name: string, path: string) => void;
    };
    // QA/검증용 읽기 스냅샷(상태 단언). 무해한 자동화 표면.
    __dawnState?: () => Record<string, unknown>;
  }
}
