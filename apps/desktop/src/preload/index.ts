import type { Edl, OverlayClip, VideoStats } from '@dawn-cut/core';
import type { LlmStatus, ProbeResult, SilenceInterval, TranscribeResult } from '@dawn-cut/ui';
import { contextBridge, ipcRenderer, webUtils } from 'electron';

type RenderOpts = {
  subtitlesPath?: string;
  format?: 'mp4' | 'gif';
  overlays?: OverlayClip[];
  frameW?: number;
  frameH?: number;
  reframe?: 'source' | '9:16' | '1:1';
  voicePath?: string;
  voiceStartUs?: number;
};

// Typed bridge. contextIsolation=true, nodeIntegration=false. Mirrors DawnBridge in @dawn-cut/ui.
const bridge = {
  // 쇼케이스/프로덕션 페이스 게이트 — DAWN_ADVANCED=1이면 전체(고급) UI, 아니면 단순 와우셋만 노출.
  advanced: process.env.DAWN_ADVANCED === '1',
  // 드래그앤드롭 파일의 실제 경로. Electron 32+에서 File.path가 제거돼 webUtils.getPathForFile이 유일.
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  ping: (): Promise<string> => ipcRenderer.invoke('app:ping'),
  probe: (path: string): Promise<ProbeResult> => ipcRenderer.invoke('media:probe', path),
  extractAudio: (path: string): Promise<{ wavPath: string }> =>
    ipcRenderer.invoke('media:extractAudio', path),
  transcribe: (wavPath: string, mediaId: string): Promise<TranscribeResult> =>
    ipcRenderer.invoke('stt:transcribe', wavPath, mediaId),
  detectSilences: (
    path: string,
    opts?: { noiseDb?: number; minSilenceUs?: number },
  ): Promise<SilenceInterval[]> => ipcRenderer.invoke('analyze:silence', path, opts),
  analyzeVideo: (path: string): Promise<VideoStats> => ipcRenderer.invoke('analyze:video', path),
  makePreviewProxy: (path: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('preview:proxy', path),
  render: (
    edl: Edl,
    outPath: string,
    opts?: RenderOpts,
  ): Promise<{ outPath: string; actualDurationUs: number }> =>
    ipcRenderer.invoke('export:render', edl, outPath, opts),
  writeSrt: (path: string, content: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('subtitle:write', path, content),
  writeAsset: (dataUrl: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('asset:writeImage', dataUrl),
  synthesizeTts: (
    text: string,
    voice: string,
    opts?: { rate?: number; pitch?: number; volume?: number },
  ): Promise<{ wavPath: string; engine: string; voice: string; durationUs: number }> =>
    ipcRenderer.invoke('tts:synthesize', text, voice, opts),
  listTtsVoices: (): Promise<{ name: string; lang: string }[]> => ipcRenderer.invoke('tts:voices'),
  motionStickers: (): Promise<{ name: string; path: string }[]> =>
    ipcRenderer.invoke('assets:motionStickers'),
  saveProject: (path: string, content: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('project:save', path, content),
  openProject: (path: string): Promise<string> => ipcRenderer.invoke('project:open', path),
  openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:saveFile'),
  revealItem: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
  llmAvailable: (): Promise<LlmStatus> => ipcRenderer.invoke('llm:available'),
  llmWarmup: (): Promise<{ ready: boolean; ms: number; reason?: string }> =>
    ipcRenderer.invoke('llm:warmup'),
  llmPlan: (prompt: string): Promise<{ text: string; ms: number }> =>
    ipcRenderer.invoke('llm:plan', prompt),
};

contextBridge.exposeInMainWorld('dawn', bridge);
