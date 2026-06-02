import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Edl } from '@dawn-cut/core';
import {
  analyzeVideo,
  detectSilences,
  extractAudio,
  makePreviewProxy,
  probeMedia,
  renderEdl,
  writeSrt,
} from '@dawn-cut/sidecar-ffmpeg';
import { isLlmAvailable, llmComplete, shutdownLlm, warmupLlm } from '@dawn-cut/sidecar-llm';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { synthesizeTts } from '@dawn-cut/sidecar-tts';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ── IPC handlers (typed channels; renderer has no node access) ──
ipcMain.handle('app:ping', () => 'pong');

ipcMain.handle('media:probe', (_e, path: string) => probeMedia(path));

ipcMain.handle('media:extractAudio', async (_e, path: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'dawn-extract-'));
  const wavPath = join(dir, 'audio.wav');
  await extractAudio(path, wavPath);
  return { wavPath };
});

ipcMain.handle('stt:transcribe', (_e, wavPath: string, mediaId: string) =>
  transcribe(wavPath, { mediaId }),
);

ipcMain.handle(
  'analyze:silence',
  (_e, path: string, opts?: { noiseDb?: number; minSilenceUs?: number }) =>
    detectSilences(path, {
      noiseDb: opts?.noiseDb ?? -30,
      minSilenceUs: opts?.minSilenceUs ?? 500_000,
    }),
);

ipcMain.handle(
  'export:render',
  async (_e, edl: Edl, outPath: string, opts?: Parameters<typeof renderEdl>[2]) => {
    await renderEdl(edl, outPath, opts ?? {});
    const probed = await probeMedia(outPath);
    return { outPath, actualDurationUs: probed.durationUs };
  },
);

ipcMain.handle('subtitle:write', (_e, path: string, content: string) => writeSrt(path, content));

// 적응형 자동 보정 입력: 영상 통계(signalstats). 계산(autoEnhanceParams)·적용(command bus)은 renderer가 core로.
ipcMain.handle('analyze:video', (_e, path: string) => analyzeVideo(path));

// 미리보기 프록시 — 고레벨/초고해상도/비-web 코덱이 검은 화면이 될 때, 확실히 재생되는 작은 H.264로
// 재인코딩해 미리보기에만 쓴다(편집·내보내기는 원본). 임시 폴더에 생성.
ipcMain.handle('preview:proxy', async (_e, path: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'dawn-proxy-'));
  const out = join(dir, 'preview.mp4');
  await makePreviewProxy(path, out);
  return { path: out };
});

// P3 로컬 LLM 플래너(llama.cpp). renderer가 buildPlanPrompt로 만든 프롬프트를 받아 raw 텍스트를
// 돌려준다(파싱/dryRun은 renderer가 core로). DAWN_DISABLE_LLM이 set이면 가용성 false로 강제해
// 결정적 룰 경로(e2e/CI)를 보장한다. 부재/오류 시 renderer가 룰 플래너로 폴백한다.
ipcMain.handle('llm:available', () => {
  if (process.env.DAWN_DISABLE_LLM) {
    return { available: false, binPath: '', modelPath: '', reason: '비활성화(DAWN_DISABLE_LLM)' };
  }
  return isLlmAvailable();
});

// 상주 서버를 미리 기동(앱 마운트 시 호출 → 첫 요청이 콜드 ~9s 대신 웜 ~0.1–0.5s).
ipcMain.handle('llm:warmup', () => {
  if (process.env.DAWN_DISABLE_LLM)
    return { ready: false, ms: 0, reason: '비활성화(DAWN_DISABLE_LLM)' };
  return warmupLlm();
});

ipcMain.handle('llm:plan', (_e, prompt: string) => {
  // kill-switch 심층방어: 렌더러는 llmReady일 때만 호출하지만, IPC 직접 호출/테스트가
  // 우회해 상주 서버를 spawn하지 못하게 여기서도 막는다.
  if (process.env.DAWN_DISABLE_LLM) throw new Error('LLM 비활성화(DAWN_DISABLE_LLM)');
  return llmComplete(prompt);
});

ipcMain.handle('tts:synthesize', async (_e, text: string, voice: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'dawn-voice-'));
  const out = join(dir, 'voice.wav');
  return synthesizeTts(text, out, { voice });
});

// Rasterized sticker/asset PNG (data URL → temp file) for real compositing.
ipcMain.handle('asset:writeImage', async (_e, dataUrl: string) => {
  const m = /^data:image\/png;base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error('asset:writeImage expects a PNG data URL');
  const dir = mkdtempSync(join(tmpdir(), 'dawn-asset-'));
  const p = join(dir, `asset-${randomUUID().slice(0, 8)}.png`);
  await writeFile(p, Buffer.from(m[1]!, 'base64'));
  return { path: p };
});

ipcMain.handle('project:save', async (_e, path: string, content: string) => {
  await writeFile(path, content, 'utf8');
  return { path };
});

ipcMain.handle('project:open', (_e, path: string) => readFile(path, 'utf8'));

// 내보낸 파일을 Finder/탐색기에서 보여준다(완료 카드 '폴더에서 보기').
ipcMain.handle('shell:reveal', (_e, path: string) => {
  shell.showItemInFolder(path);
});

ipcMain.handle('dialog:openFile', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      {
        name: 'Media',
        // ffmpeg/ffprobe가 읽는 컨테이너 전반(가져오기). 미리보기 재생은 코덱이 Chromium 지원일 때만
        // (H.264/VP9/AV1 등; HEVC/ProRes는 디코드 안 될 수 있음) — 편집·내보내기는 코덱 무관.
        extensions: [
          'mp4',
          'mov',
          'm4v',
          'mkv',
          'webm',
          'avi',
          'flv',
          'ts',
          'mpg',
          'mpeg',
          'wmv',
          '3gp',
          'wav',
          'mp3',
          'm4a',
          'aac',
          'flac',
          'ogg',
        ],
      },
    ],
  });
  return r.canceled ? null : (r.filePaths[0] ?? null);
});

ipcMain.handle('dialog:saveFile', async () => {
  const r = await dialog.showSaveDialog({
    defaultPath: `dawn-export-${randomUUID().slice(0, 8)}.mp4`,
  });
  return r.canceled ? null : (r.filePath ?? null);
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'dawn-cut',
    show: false,
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(resolve(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 상주 llama-server를 앱 종료 시 정리(orphan 방지).
app.on('will-quit', () => shutdownLlm());
