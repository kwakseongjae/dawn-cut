import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const exec = promisify(execFile);
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const TALK = resolve(ROOT, 'demo/talk.mp4');
const PHOTO1 = resolve(ROOT, 'demo/photo1.jpg');
const PHOTO2 = resolve(ROOT, 'demo/photo2.jpg');
const shot = (n: string) => resolve(ROOT, `demo-output/${n}`);

type Auto = {
  __editor: {
    importPath: (p: string) => Promise<void>;
    addImageOverlay: (p: string) => Promise<void>;
    exportTo: (p: string) => Promise<void>;
  };
};

test.skip(!existsSync(TALK), 'run scripts/make-demo-assets.sh first');
test('GUI demo: import real video + attach images, capture screenshots', async () => {
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

    // import the real narrated demo video
    await win.evaluate((p) => (window as unknown as Auto).__editor.importPath(p), TALK);
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 90_000 });
    await win.waitForTimeout(400);
    await win.screenshot({ path: shot('ui-1-imported.png') });

    // attach two real photos as overlays
    await win.evaluate((p) => (window as unknown as Auto).__editor.addImageOverlay(p), PHOTO1);
    await win.evaluate((p) => (window as unknown as Auto).__editor.addImageOverlay(p), PHOTO2);
    await win.waitForTimeout(300);
    await win.screenshot({ path: shot('ui-2-overlays.png') });

    // text-based edit: select first 3 words, delete, then remove silences
    const words = win.getByTestId('word');
    for (let i = 0; i < 3; i++) await words.nth(i).click();
    await win.getByTestId('delete-selection').click();
    await win.getByTestId('remove-silences').click();
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 30_000 });
    await win.waitForTimeout(300);
    await win.screenshot({ path: shot('ui-3-edited.png') });

    // add a sticker (emoji rasterized → PNG → composited overlay)
    await win.getByTitle('Sticker · GIF').click();
    await win.getByRole('button', { name: '🔥' }).click();
    await win.getByRole('button', { name: '💯' }).click();
    await win.waitForTimeout(400);
    await win.screenshot({ path: shot('ui-4-stickers.png') });

    // burn subtitles (rasterized cue PNGs composited onto the video)
    await win.getByTestId('burn-subtitles').click();
    await expect(win.getByTestId('burn-subtitles')).toHaveText(/burned/, { timeout: 30_000 });

    // generate an AI voiceover (mixed into the export)
    await win.getByTitle('Text · TTS').click();
    await win.locator('#tts-text').fill('Try dawn cut, the open source video editor.');
    await win.getByTestId('generate-voiceover').click();
    await expect(win.getByTestId('status')).toHaveText('voice ready', { timeout: 30_000 });
    await win.screenshot({ path: shot('ui-5-subs-voice.png') });

    // export the fully-composited result (photos + stickers + subtitles + voiceover) and capture a frame
    const exportMp4 = shot('ui-export.mp4');
    await win.evaluate((p) => (window as unknown as Auto).__editor.exportTo(p), exportMp4);
    await expect(win.getByTestId('status')).toHaveText('exported', { timeout: 90_000 });
    expect(existsSync(exportMp4)).toBe(true);
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      '0.5',
      '-i',
      exportMp4,
      '-frames:v',
      '1',
      shot('ui-export-frame.png'),
    ]);
    expect(existsSync(shot('ui-export-frame.png'))).toBe(true);
  } finally {
    await app.close();
  }
});
