import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');

test.skip(!existsSync(WHISPER_BIN), 'whisper.cpp not built');
test('keyboard shortcuts: ArrowRight advances playhead, Home rewinds', async () => {
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

    type Auto = { importPath: (p: string) => Promise<void> };
    await win.evaluate(async (p: string) => {
      await (window as unknown as { __editor: Auto }).__editor.importPath(p);
    }, FIXTURE);
    await expect(win.getByTestId('status')).toHaveText('ready');

    const readPlayhead = () =>
      win.evaluate(() => {
        const ed = (
          window as unknown as {
            __store?: { getState: () => { playheadUs: number } };
          }
        ).__store;
        if (ed) return ed.getState().playheadUs;
        // fallback: read via DOM time text "0:00.00 / 0:08.00" — parse left side
        const t = document.querySelector('.preview .time')?.textContent ?? '0:00.00';
        const left = t.split('/')[0]?.trim() ?? '0:00.00';
        const [m, s] = left.split(':');
        return Math.round((Number(m) * 60 + Number(s)) * 1_000_000);
      });

    const start = await readPlayhead();
    expect(start).toBe(0);

    // ArrowRight should advance by ~100ms
    await win.locator('body').press('ArrowRight');
    await win.locator('body').press('ArrowRight');
    const advanced = await readPlayhead();
    expect(advanced).toBeGreaterThan(start);

    // Home should snap back to 0
    await win.locator('body').press('Home');
    const home = await readPlayhead();
    expect(home).toBe(0);
  } finally {
    await app.close();
  }
});
