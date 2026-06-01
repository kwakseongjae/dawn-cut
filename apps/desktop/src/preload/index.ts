import type { Edl, OverlayClip } from '@dawn-cut/core';
import type { LlmStatus, ProbeResult, SilenceInterval, TranscribeResult } from '@dawn-cut/ui';
import { contextBridge, ipcRenderer } from 'electron';

type RenderOpts = {
  subtitlesPath?: string;
  format?: 'mp4' | 'gif';
  overlays?: OverlayClip[];
  frameW?: number;
  frameH?: number;
  voicePath?: string;
  voiceStartUs?: number;
};

// Typed bridge. contextIsolation=true, nodeIntegration=false. Mirrors DawnBridge in @dawn-cut/ui.
const bridge = {
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
  synthesizeTts: (text: string, voice: string): Promise<{ wavPath: string; engine: string }> =>
    ipcRenderer.invoke('tts:synthesize', text, voice),
  saveProject: (path: string, content: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('project:save', path, content),
  openProject: (path: string): Promise<string> => ipcRenderer.invoke('project:open', path),
  openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:saveFile'),
  revealItem: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
  llmAvailable: (): Promise<LlmStatus> => ipcRenderer.invoke('llm:available'),
  llmPlan: (prompt: string): Promise<{ text: string; ms: number }> =>
    ipcRenderer.invoke('llm:plan', prompt),
};

contextBridge.exposeInMainWorld('dawn', bridge);
