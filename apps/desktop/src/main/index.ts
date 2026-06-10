import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
import {
  CLOUD_VOICES,
  isPiperAvailable,
  listVoices,
  synthesizeCloudTts,
  synthesizeTts,
} from '@dawn-cut/sidecar-tts';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ★ 하드웨어 비디오 디코드 비활성화(소프트웨어 디코드 강제). 일부 Mac+GPU 조합에서 Chromium의
// 하드웨어 디코더가 표준 H.264조차 디코드하지 못해(로그: "Unsupported pixel format: -1") 미리보기가
// 검게 나오는 문제를 해결한다. 미리보기는 작은 프록시라 소프트웨어 디코드로 충분히 매끄럽다.
// (app.ready 이전, 모듈 로드 시점에 호출해야 적용된다.)
app.disableHardwareAcceleration();

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

// ── 설정(userData/settings.json) — API 키는 main에만 머물고 렌더러엔 보유 여부만 노출 ──
type DawnSettings = { openaiApiKey?: string; ttsEngine?: 'local' | 'cloud' };
const settingsPath = () => join(app.getPath('userData'), 'settings.json');
async function readSettings(): Promise<DawnSettings> {
  try {
    return JSON.parse(await readFile(settingsPath(), 'utf8')) as DawnSettings;
  } catch {
    return {};
  }
}
ipcMain.handle('settings:get', async () => {
  const s = await readSettings();
  // 키 원문은 절대 렌더러로 보내지 않는다(웹 컨텐츠 노출 면적 최소화).
  return { ttsEngine: s.ttsEngine ?? 'local', hasOpenaiKey: Boolean(s.openaiApiKey) };
});
ipcMain.handle(
  'settings:set',
  async (_e, patch: { openaiApiKey?: string | null; ttsEngine?: 'local' | 'cloud' }) => {
    const s = await readSettings();
    if (patch.openaiApiKey !== undefined) {
      // null/빈 문자열 = 키 제거(undefined 대입 — JSON.stringify가 필드를 떨어뜨린다).
      s.openaiApiKey = patch.openaiApiKey || undefined;
    }
    if (patch.ttsEngine) s.ttsEngine = patch.ttsEngine;
    await writeFile(settingsPath(), JSON.stringify(s, null, 2), 'utf8');
    return { ttsEngine: s.ttsEngine ?? 'local', hasOpenaiKey: Boolean(s.openaiApiKey) };
  },
);
ipcMain.handle('tts:cloudVoices', () => CLOUD_VOICES.map(({ id, label }) => ({ id, label })));

ipcMain.handle(
  'tts:synthesize',
  async (
    _e,
    text: string,
    voice: string,
    opts?: { rate?: number; pitch?: number; volume?: number; style?: string },
  ) => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-voice-'));
    const out = join(dir, 'voice.wav');
    // 클라우드 opt-in + 키 보유 시에만 클라우드(BYOK). 실패하면 로컬 say로 폴백하고 사유 전달.
    const settings = await readSettings();
    let res: { wavPath: string; engine: string; voice: string };
    let cloudError: string | undefined;
    if (settings.ttsEngine === 'cloud' && settings.openaiApiKey) {
      try {
        res = await synthesizeCloudTts(text, out, {
          apiKey: settings.openaiApiKey,
          voice,
          rate: opts?.rate,
          style: opts?.style,
        });
      } catch (e) {
        cloudError = e instanceof Error ? e.message : String(e);
        res = await synthesizeTts(text, out, { ...opts });
      }
    } else {
      res = await synthesizeTts(text, out, { voice, ...opts });
    }
    let durationUs = 0;
    try {
      durationUs = (await probeMedia(res.wavPath)).durationUs;
    } catch {
      /* probe 실패 시 0 → UI가 기본 길이로 대체 */
    }
    return { ...res, durationUs, ...(cloudError ? { cloudError } : {}) };
  },
);

// 설치된 macOS 보이스 목록(언어 태그 포함) — UI 보이스 선택을 동적으로 채운다.
ipcMain.handle('tts:voices', async () => listVoices());

// TTS 엔진 상태(뉴럴 Piper 사용 가능 여부) — UI 배지/안내용. 미설치면 say 폴백.
ipcMain.handle('tts:engineStatus', () => isPiperAvailable());

// 번들된 '모션 스티커'(애니 GIF) 목록 — 로컬 생성·번들, 클라우드 의존 없음. 절대경로를 반환해
// 오버레이로 바로 끼운다(파일이 디스크에 있어 writeAsset 불필요). 패키징: extraResources/gif.
ipcMain.handle('assets:motionStickers', () => {
  // dev(electron-vite preview)=레포 assets/gif, 패키지=resourcesPath/gif.
  const dir = app.isPackaged
    ? join(process.resourcesPath, 'gif')
    : resolve(__dirname, '../../../../assets/gif');
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.gif'))
      .sort()
      .map((f) => ({ name: f.replace(/\.gif$/i, ''), path: join(dir, f) }));
  } catch {
    return [];
  }
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

// 작업 현황 저장(issue #17) — tmp에 래스터된 오버레이 PNG/TTS wav를 .dawn 옆
// '<이름>.assets/'로 복사해 재부팅에도 살아남게 한다. {원경로→새경로} 매핑을 돌려주면
// 렌더러가 src를 바꿔치기해 저장한다. 같은 파일명이 이미 있고 크기가 같으면 재복사 생략(멱등).
ipcMain.handle('project:archiveAssets', async (_e, dawnPath: string, files: string[]) => {
  const dir = `${dawnPath.replace(/\.dawn$/i, '')}.assets`;
  await mkdir(dir, { recursive: true });
  const mapping: Record<string, string> = {};
  for (const src of files) {
    try {
      const st = await stat(src);
      if (!st.isFile()) continue;
      const base = src.split('/').pop()!;
      let target = join(dir, base);
      try {
        const ex = await stat(target);
        if (ex.size !== st.size) target = join(dir, `${randomUUID().slice(0, 8)}-${base}`);
      } catch {
        // 대상 없음 → 그대로 복사
      }
      if (target !== src) await copyFile(src, target);
      mapping[src] = target;
    } catch {
      // 원본이 이미 사라진 에셋은 건너뜀(렌더러가 원경로 유지)
    }
  }
  return mapping;
});

// 자동저장(단일 슬롯) — userData/autosave.dawn. 비정상 종료 후 복구 제안용.
const autosavePath = () => join(app.getPath('userData'), 'autosave.dawn');
ipcMain.handle('autosave:write', async (_e, content: string) => {
  const p = autosavePath();
  await writeFile(p, content, 'utf8');
  return { path: p, savedAtMs: Date.now() };
});
ipcMain.handle('autosave:read', async () => {
  try {
    const p = autosavePath();
    const st = await stat(p);
    const content = await readFile(p, 'utf8');
    return { content, savedAtMs: st.mtimeMs, path: p };
  } catch {
    return null;
  }
});
ipcMain.handle('autosave:clear', async () => {
  try {
    await rm(autosavePath());
  } catch {
    // 이미 없음 — 무시
  }
  return { ok: true };
});

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
