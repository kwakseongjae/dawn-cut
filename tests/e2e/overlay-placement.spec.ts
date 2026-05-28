import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const exec = promisify(execFile);
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');

type Auto = {
  __editor: {
    importPath: (p: string) => Promise<void>;
    addImageOverlay: (p: string) => Promise<void>;
  };
};

// Manual overlay placement (G15): drag to move, drag handle to resize.
test.skip(!existsSync(WHISPER_BIN), 'whisper.cpp not built');
test('overlay manual placement: drag moves (x changes), handle resizes (scale changes)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dawn-ovl-'));
  const png = join(dir, 'red.png');
  await exec('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=120x120',
    '-frames:v',
    '1',
    png,
  ]);

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

    await win.evaluate((p) => (window as unknown as Auto).__editor.addImageOverlay(p), png);
    const ov = win.getByTestId('overlay').first();
    await expect(ov).toBeVisible();

    const x0 = Number(await ov.getAttribute('data-x'));
    // select + drag left by ~90px
    const box = (await ov.boundingBox())!;
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2, { steps: 6 });
    await win.mouse.up();
    const x1 = Number(await ov.getAttribute('data-x'));
    expect(x1).toBeLessThan(x0); // moved left

    // resize via the handle (drag right → larger scale)
    const scale0 = Number(await ov.getAttribute('data-scale'));
    const handle = win.getByTestId('overlay-resize');
    const hb = (await handle.boundingBox())!;
    await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await win.mouse.down();
    await win.mouse.move(hb.x + hb.width / 2 + 70, hb.y + hb.height / 2, { steps: 6 });
    await win.mouse.up();
    const scale1 = Number(await ov.getAttribute('data-scale'));
    expect(scale1).toBeGreaterThan(scale0); // bigger

    await win.screenshot({ path: resolve(ROOT, 'artifacts/g15-placement.png') });
  } finally {
    await app.close();
  }
});
