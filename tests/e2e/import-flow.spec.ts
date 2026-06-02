import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// 가져오기 = 프로브만(즉시), 자막은 명시적 '자막 생성' 버튼으로만 — 업로드 시 자동 전사하지 않는다.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');

type Auto = {
  __editor: { importPath: (p: string) => Promise<void>; transcribe: () => Promise<void> };
};

test.skip(!existsSync(WHISPER_BIN), 'whisper.cpp not built');
test('가져오기는 프로브만(자동 전사 없음) → "자막 생성" 버튼 → 명시적 전사 시 자막 생성', async () => {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [mainEntry],
    env: { ...process.env, DAWN_DISABLE_LLM: '1' },
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() =>
      Boolean((window as unknown as { __editor?: unknown }).__editor),
    );

    // 가져오기 = 프로브만. 즉시 ready, 자동 전사하지 않는다.
    await win.evaluate((p) => (window as unknown as Auto).__editor.importPath(p), FIXTURE);
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 20_000 });
    // 자막이 자동 생성되지 않았다(어절 0) + '자막 생성' 버튼이 보인다.
    await expect(win.getByTestId('word')).toHaveCount(0);
    await expect(win.getByTestId('transcribe')).toBeVisible();

    // 명시적 전사 → 자막(어절) 생성됨.
    await win.evaluate(() => (window as unknown as Auto).__editor.transcribe());
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 60_000 });
    expect(await win.getByTestId('word').count()).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
