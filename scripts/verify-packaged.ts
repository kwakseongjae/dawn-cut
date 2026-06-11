// 패키징 앱 '깨끗한 Mac' 시뮬레이션 검증(issue #19) —
// PATH에서 brew를 제거한 채 release/의 실제 .app을 구동해 골든패스를 돌린다:
// 가져오기(동봉 ffprobe) → 자막 생성(동봉 whisper-cli + userData 모델) → 내보내기(동봉 ffmpeg).
// 모델은 1.6GB 재다운로드 대신 dev 모델을 userData/models로 시딩(다운로드 IPC는 별도 검증).
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron } from '@playwright/test';

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const APP_BIN = join(ROOT, 'apps/desktop/release/mac-arm64/dawn-cut.app/Contents/MacOS/dawn-cut');
const SAMPLE = join(ROOT, 'fixtures/sample.mp4');
const OUT = join(ROOT, 'output/packaged-verify');
mkdirSync(OUT, { recursive: true });

async function main() {
  if (!existsSync(APP_BIN)) throw new Error(`패키징 앱 없음: ${APP_BIN} — pnpm dist:mac 먼저`);

  // 모델 시딩 — 패키징 앱 userData(productName=dawn-cut).
  const userData = join(homedir(), 'Library/Application Support/dawn-cut');
  mkdirSync(join(userData, 'models'), { recursive: true });
  const devModel = join(ROOT, 'vendor/whisper.cpp/models/ggml-large-v3-turbo.bin');
  const seeded = join(userData, 'models/ggml-large-v3-turbo.bin');
  if (!existsSync(seeded)) copyFileSync(devModel, seeded);

  // ★ 깨끗한 Mac 시뮬레이션: brew 경로 제거 — PATH의 ffmpeg/whisper는 절대 못 찾는다.
  const app = await electron.launch({
    executablePath: APP_BIN,
    args: [],
    env: {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: homedir(),
      DAWN_ADVANCED: '1',
    } as Record<string, string>,
  });
  try {
    const win = await app.firstWindow();
    await win.waitForFunction(() => Boolean((window as { __editor?: unknown }).__editor), null, {
      timeout: 30_000,
    });
    const state = () =>
      win.evaluate(() =>
        (window as unknown as { __dawnState: () => Record<string, unknown> }).__dawnState(),
      );

    console.log('1) 가져오기(동봉 ffprobe)…');
    await win.evaluate(
      (p) =>
        (
          window as unknown as { __editor: { importPath: (p: string) => Promise<void> } }
        ).__editor.importPath(p),
      SAMPLE,
    );
    await win.waitForFunction(
      () =>
        (window as unknown as { __dawnState: () => { status: string } }).__dawnState().status ===
        'ready',
      null,
      { timeout: 60_000 },
    );
    console.log('   ✓ ready');

    console.log('2) 자막 생성(동봉 whisper + 시딩 모델)…');
    await win.evaluate(() =>
      (
        window as unknown as { __editor: { transcribe: () => Promise<void> } }
      ).__editor.transcribe(),
    );
    await win.waitForFunction(
      () =>
        ((window as unknown as { __dawnState: () => { words: number } }).__dawnState().words ?? 0) >
        0,
      null,
      { timeout: 180_000 },
    );
    const s1 = await state();
    console.log(`   ✓ 어절 ${s1.words}`);

    console.log('3) 내보내기(동봉 ffmpeg + videotoolbox 인코더)…');
    const outMp4 = join(OUT, 'packaged-export.mp4');
    await win.evaluate(
      (p) =>
        (
          window as unknown as { __editor: { exportTo: (p: string) => Promise<void> } }
        ).__editor.exportTo(p),
      outMp4,
    );
    await win.waitForFunction(
      () =>
        (window as unknown as { __dawnState: () => { status: string } }).__dawnState().status ===
        'exported',
      null,
      { timeout: 120_000 },
    );
    // 산출물 코덱 확인(동봉 ffprobe로!)
    const bundledProbe = join(ROOT, 'vendor/dist-bin/ffprobe');
    const { stdout } = await exec(bundledProbe, [
      '-v',
      'error',
      '-select_streams',
      'v',
      '-show_entries',
      'stream=codec_name',
      '-of',
      'csv=p=0',
      outMp4,
    ]);
    console.log(`   ✓ exported codec=${stdout.trim()}`);
    await win.screenshot({ path: join(OUT, 'packaged-app.png') });
    console.log('✅ 깨끗한 Mac 시뮬레이션 골든패스 통과');
  } finally {
    await app.close().catch(() => {});
  }
}
void main();
