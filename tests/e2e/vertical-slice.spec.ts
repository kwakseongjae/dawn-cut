import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { frameUs } from '@dawn-cut/core';
import { probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');
const OUT = resolve(ROOT, 'artifacts/g8-final.mp4');
const OUT_SRT = resolve(ROOT, 'artifacts/g8-final.srt');
const PROJECT = resolve(ROOT, 'artifacts/g10-project.dawn');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const FRAME = frameUs(30);

const num = async (loc: { innerText: () => Promise<string> }) =>
  Number((await loc.innerText()).trim());

// Full clickable slice (V13/G8 = PoC DoD). Needs whisper; self-skips otherwise.
test.skip(!existsSync(WHISPER_BIN), 'whisper.cpp not built');
test('vertical slice: import → transcript → delete words → remove silences → export', async () => {
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

    // 1) import (drive the path-dependent step via the automation surface)
    type Auto = {
      __editor: {
        importPath: (p: string) => Promise<void>;
        exportTo: (p: string) => Promise<void>;
        exportSrt: (p: string) => Promise<void>;
        saveProject: (p: string) => Promise<void>;
        openProject: (p: string) => Promise<void>;
      };
    };
    await win.evaluate((p) => (window as unknown as Auto).__editor.importPath(p), FIXTURE);
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 60_000 });

    const words = win.getByTestId('word');
    expect(await words.count()).toBeGreaterThan(3);
    await expect(win.getByTestId('clip-count')).toHaveText('1');
    const dur0 = await num(win.getByTestId('duration'));
    expect(dur0).toBeGreaterThan(0);

    // 2) select and delete the first 3 words → duration shrinks, words struck through
    for (let i = 0; i < 3; i++) await words.nth(i).click();
    await win.getByTestId('delete-selection').click();
    const dur1 = await num(win.getByTestId('duration'));
    expect(dur1).toBeLessThan(dur0);
    expect(
      await win.locator('[data-testid="word"][data-dead="true"]').count(),
    ).toBeGreaterThanOrEqual(1);

    // 2b) undo restores full duration; redo re-applies the cut (G11)
    await win.getByTestId('undo').click();
    expect(await num(win.getByTestId('duration'))).toBe(dur0);
    await win.getByTestId('redo').click();
    expect(await num(win.getByTestId('duration'))).toBe(dur1);

    // 3) remove silences → duration shrinks further
    await win.getByTestId('remove-silences').click();
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 30_000 });
    const dur2 = await num(win.getByTestId('duration'));
    expect(dur2).toBeLessThan(dur1);

    // 4) export → file exists, length == UI duration ±1 frame
    await win.evaluate((p) => (window as unknown as Auto).__editor.exportTo(p), OUT);
    await expect(win.getByTestId('status')).toHaveText('exported', { timeout: 60_000 });
    await win.screenshot({ path: resolve(ROOT, 'artifacts/g8-final.png') });

    expect(existsSync(OUT)).toBe(true);
    const probed = await probeMedia(OUT);
    expect(Math.abs(probed.durationUs - dur2)).toBeLessThanOrEqual(FRAME);

    // 5) export subtitles (.srt) → file exists, well-formed SRT (G9)
    await win.evaluate((p) => (window as unknown as Auto).__editor.exportSrt(p), OUT_SRT);
    await expect(win.getByTestId('status')).toHaveText('srt exported', { timeout: 30_000 });
    expect(existsSync(OUT_SRT)).toBe(true);
    expect(readFileSync(OUT_SRT, 'utf8')).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> /);

    // 6) save .dawn → re-import (resets to full) → open .dawn → state restored (G10)
    await win.evaluate((p) => (window as unknown as Auto).__editor.saveProject(p), PROJECT);
    expect(existsSync(PROJECT)).toBe(true);

    await win.evaluate((p) => (window as unknown as Auto).__editor.importPath(p), FIXTURE);
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 60_000 });
    expect(await num(win.getByTestId('duration'))).toBeGreaterThan(dur2); // back to full

    await win.evaluate((p) => (window as unknown as Auto).__editor.openProject(p), PROJECT);
    await expect(win.getByTestId('status')).toHaveText('opened', { timeout: 30_000 });
    expect(await num(win.getByTestId('duration'))).toBe(dur2); // edited state restored
  } finally {
    await app.close();
  }
});
