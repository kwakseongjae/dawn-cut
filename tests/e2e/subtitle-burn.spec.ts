import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const exec = promisify(execFile);
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const PLAIN = resolve(ROOT, 'artifacts/g17-plain.mp4');
const SUBBED = resolve(ROOT, 'artifacts/g17-subbed.mp4');

type Auto = {
  __editor: { importPath: (p: string) => Promise<void>; exportTo: (p: string) => Promise<void> };
};

/** Sum of RGB averages of a cropped region of `video` at `atSec`. */
async function regionBrightness(video: string, atSec: string, crop: string): Promise<number> {
  const { stdout } = (await exec(
    'ffmpeg',
    [
      '-y',
      '-ss',
      atSec,
      '-i',
      video,
      '-vf',
      `crop=${crop},scale=1:1`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 1_000_000 },
  )) as unknown as { stdout: Buffer };
  return (stdout[0] ?? 0) + (stdout[1] ?? 0) + (stdout[2] ?? 0);
}

// Subtitle burn-in (G17b): rasterized cue PNGs composited onto the video.
test.skip(!existsSync(WHISPER_BIN), 'whisper.cpp not built');
test('subtitle burn-in changes the bottom-center pixels of the exported video', async () => {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [mainEntry],
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() =>
      Boolean((window as unknown as { __editor?: unknown }).__editor),
    );
    await win.evaluate((p) => (window as unknown as Auto).__editor.importPath(p), FIXTURE);
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 60_000 });

    // control export (no subtitles)
    await win.evaluate((p) => (window as unknown as Auto).__editor.exportTo(p), PLAIN);
    await expect(win.getByTestId('status')).toHaveText('exported', { timeout: 60_000 });

    // burn subtitles, then export
    await win.getByTestId('burn-subtitles').click();
    await expect(win.getByTestId('burn-subtitles')).toHaveText(/입힘/, { timeout: 30_000 });
    await win.evaluate((p) => (window as unknown as Auto).__editor.exportTo(p), SUBBED);
    await expect(win.getByTestId('status')).toHaveText('exported', { timeout: 60_000 });

    // the bottom subtitle band must differ once subtitles are burned in
    // sample.mp4 640x360; bottom-center over the (auto-wrapped, 2-line) subtitle text.
    const crop = '300:70:170:288';
    const plain = await regionBrightness(PLAIN, '0.5', crop);
    const subbed = await regionBrightness(SUBBED, '0.5', crop);
    expect(Math.abs(subbed - plain)).toBeGreaterThan(30);
  } finally {
    await app.close();
  }
});
