import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// 자동 하이라이트(롱폼→쇼츠) — 실앱에서: 고급 모드 버튼 노출 + command bus 컷(감사 +1).
// 단순 모드에서는 버튼이 숨는다(쇼케이스 게이트). 작은 target으로 짧은 fixture도 확실히 컷.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');

type Auto = {
  __editor: { importPath: (p: string) => Promise<void>; autoHighlight: (s: number) => void };
};
const num = async (loc: { innerText: () => Promise<string> }) =>
  Number((await loc.innerText()).trim());

async function launch(advanced: boolean) {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [mainEntry],
    env: { ...process.env, DAWN_DISABLE_LLM: '1', DAWN_ADVANCED: advanced ? '1' : '' },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => Boolean((window as unknown as { __editor?: unknown }).__editor));
  await win.evaluate((p) => (window as unknown as Auto).__editor.importPath(p), FIXTURE);
  await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 60_000 });
  return { app, win };
}

test.skip(!existsSync(WHISPER_BIN), 'whisper.cpp not built');

test('고급: 자동 하이라이트 버튼 노출 + 컷 적용(감사 +1)', async () => {
  const { app, win } = await launch(true);
  try {
    await expect(win.getByTestId('auto-highlight')).toBeVisible();
    expect(await num(win.getByTestId('audit-count'))).toBe(0);
    // 버튼은 60초 고정이라 짧은 fixture는 그대로 → 컷을 확인하려고 작은 target으로 직접 구동.
    await win.evaluate(() => (window as unknown as Auto).__editor.autoHighlight(2));
    await expect(win.getByTestId('audit-count')).toHaveText('1', { timeout: 15_000 });
  } finally {
    await app.close();
  }
});

test('단순: 자동 하이라이트 버튼 숨김', async () => {
  const { app, win } = await launch(false);
  try {
    await expect(win.getByTestId('auto-highlight')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
