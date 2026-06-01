import type { Edl, OverlayClip, Word } from '@dawn-cut/core';

// Structural mirrors of the sidecar return types (ui must not depend on node sidecars).
export interface ProbeResult {
  durationUs: number;
  fps: number;
  hasAudio: boolean;
  width: number;
  height: number;
}
export interface SilenceInterval {
  start: number;
  end: number;
}
export interface TranscribeResult {
  language: string;
  words: Word[];
}
/** Typed IPC bridge exposed by the Electron preload (contextBridge). */
export interface DawnBridge {
  ping: () => Promise<string>;
  probe: (path: string) => Promise<ProbeResult>;
  extractAudio: (path: string) => Promise<{ wavPath: string }>;
  transcribe: (wavPath: string, mediaId: string) => Promise<TranscribeResult>;
  detectSilences: (
    path: string,
    opts?: { noiseDb?: number; minSilenceUs?: number },
  ) => Promise<SilenceInterval[]>;
  render: (
    edl: Edl,
    outPath: string,
    opts?: {
      subtitlesPath?: string;
      format?: 'mp4' | 'gif';
      overlays?: OverlayClip[];
      frameW?: number;
      frameH?: number;
      voicePath?: string;
      voiceStartUs?: number;
    },
  ) => Promise<{ outPath: string; actualDurationUs: number }>;
  writeSrt: (path: string, content: string) => Promise<{ path: string }>;
  writeAsset: (dataUrl: string) => Promise<{ path: string }>;
  synthesizeTts: (text: string, voice: string) => Promise<{ wavPath: string; engine: string }>;
  saveProject: (path: string, content: string) => Promise<{ path: string }>;
  openProject: (path: string) => Promise<string>;
  openFile: () => Promise<string | null>;
  saveFile: () => Promise<string | null>;
  revealItem: (path: string) => Promise<void>;
}

declare global {
  interface Window {
    dawn?: DawnBridge;
    // automation surface for E2E (path-dependent steps); harmless in production.
    __editor?: {
      importPath: (path: string) => Promise<void>;
      exportTo: (path: string) => Promise<void>;
      exportSrt: (path: string) => Promise<void>;
      saveProject: (path: string) => Promise<void>;
      openProject: (path: string) => Promise<void>;
      exportGif: (path: string) => Promise<void>;
      addImageOverlay: (path: string) => Promise<void>;
      planAndPreview: (input: string) => void;
      approvePlan: () => void;
      rejectPlan: () => void;
    };
  }
}
