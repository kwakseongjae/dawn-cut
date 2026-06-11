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
  outHeight?: number;
  quality?: 'high' | 'medium' | 'small';
  inputHasAudio?: boolean;
  outFps?: number;
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
  transcribe: (wavPath: string, mediaId: string, lang?: string): Promise<TranscribeResult> =>
    ipcRenderer.invoke('stt:transcribe', wavPath, mediaId, lang),
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
  renderAudio: (edl: Edl, outPath: string, format: 'mp3' | 'wav'): Promise<{ outPath: string }> =>
    ipcRenderer.invoke('export:audio', edl, outPath, format),
  writeAsset: (dataUrl: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('asset:writeImage', dataUrl),
  synthesizeTts: (
    text: string,
    voice: string,
    opts?: { rate?: number; pitch?: number; volume?: number; style?: string },
  ): Promise<{
    wavPath: string;
    engine: string;
    voice: string;
    durationUs: number;
    cloudError?: string;
  }> => ipcRenderer.invoke('tts:synthesize', text, voice, opts),
  listTtsVoices: (): Promise<{ name: string; lang: string }[]> => ipcRenderer.invoke('tts:voices'),
  cloudTtsVoices: (): Promise<{ id: string; label: string }[]> =>
    ipcRenderer.invoke('tts:cloudVoices'),
  getSettings: (): Promise<{
    ttsEngine: 'local' | 'cloud';
    hasOpenaiKey: boolean;
    hasElevenKey: boolean;
    hasOpenrouterKey: boolean;
  }> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: {
    openaiApiKey?: string | null;
    elevenlabsApiKey?: string | null;
    openrouterApiKey?: string | null;
    ttsEngine?: 'local' | 'cloud';
  }): Promise<{
    ttsEngine: 'local' | 'cloud';
    hasOpenaiKey: boolean;
    hasElevenKey: boolean;
    hasOpenrouterKey: boolean;
  }> => ipcRenderer.invoke('settings:set', patch),
  motionStickers: (): Promise<{ name: string; path: string }[]> =>
    ipcRenderer.invoke('assets:motionStickers'),
  ttsEngineStatus: (): Promise<{
    available: boolean;
    binPath: string;
    modelPath: string;
    reason?: string;
  }> => ipcRenderer.invoke('tts:engineStatus'),
  saveProject: (path: string, content: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('project:save', path, content),
  openProject: (path: string): Promise<string> => ipcRenderer.invoke('project:open', path),
  archiveAssets: (dawnPath: string, files: string[]): Promise<Record<string, string>> =>
    ipcRenderer.invoke('project:archiveAssets', dawnPath, files),
  autosaveWrite: (content: string): Promise<{ path: string; savedAtMs: number }> =>
    ipcRenderer.invoke('autosave:write', content),
  autosaveRead: (): Promise<{ content: string; savedAtMs: number; path: string } | null> =>
    ipcRenderer.invoke('autosave:read'),
  autosaveClear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('autosave:clear'),
  openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:saveFile'),
  revealItem: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
  llmAvailable: (): Promise<LlmStatus> => ipcRenderer.invoke('llm:available'),
  llmWarmup: (): Promise<{ ready: boolean; ms: number; reason?: string }> =>
    ipcRenderer.invoke('llm:warmup'),
  llmPlan: (prompt: string): Promise<{ text: string; ms: number }> =>
    ipcRenderer.invoke('llm:plan', prompt),
  // whisper 모델 온보딩(issue #19) — 1.6GB라 동봉 불가, 첫 자막 생성 전에 다운로드.
  modelStatus: (): Promise<{ present: boolean; path: string | null; sizeMb: number }> =>
    ipcRenderer.invoke('stt:modelStatus'),
  downloadModel: (): Promise<{ path: string }> => ipcRenderer.invoke('stt:downloadModel'),
  onModelProgress: (
    cb: (p: { receivedMb: number; totalMb: number; done?: boolean }) => void,
  ): (() => void) => {
    const handler = (_e: unknown, p: { receivedMb: number; totalMb: number; done?: boolean }) =>
      cb(p);
    ipcRenderer.on('model:progress', handler);
    return () => ipcRenderer.removeListener('model:progress', handler);
  },
};

contextBridge.exposeInMainWorld('dawn', bridge);
