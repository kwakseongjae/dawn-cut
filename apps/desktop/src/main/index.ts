import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Edl } from '@dawn-cut/core';
import {
  detectSilences,
  extractAudio,
  probeMedia,
  renderEdl,
  writeSrt,
} from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { synthesizeTts } from '@dawn-cut/sidecar-tts';
import { BrowserWindow, app, dialog, ipcMain } from 'electron';

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

ipcMain.handle('analyze:silence', (_e, path: string) =>
  detectSilences(path, { noiseDb: -30, minSilenceUs: 500_000 }),
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

ipcMain.handle('dialog:openFile', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'wav', 'mp3'] }],
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
