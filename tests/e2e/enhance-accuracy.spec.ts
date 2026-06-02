import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// 고도화 2종을 실제 앱에서 검증:
//  (1) 적응형 자동 보정 — __editor.autoEnhance()가 영상 분석 → applyAutoEnhance를 command bus로
//      적용(감사 +1).  (2) 자막 정확도 — 어절을 더블클릭해 인라인 교정 → 트랜스크립트 반영(감사 +1).
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');

type Auto = {
  __editor: { importAndTranscribe: (p: string) => Promise<void>; autoEnhance: () => Promise<void> };
};

const num = async (loc: { innerText: () => Promise<string> }) =>
  Number((await loc.innerText()).trim());

test.skip(!existsSync(WHISPER_BIN), 'whisper.cpp not built');
test('자동 보정(command bus) + 어절 교정(더블클릭) → 감사 2건', async () => {
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

    await win.evaluate((p) => (window as unknown as Auto).__editor.importAndTranscribe(p), FIXTURE);
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 60_000 });
    expect(await num(win.getByTestId('audit-count'))).toBe(0);

    // (1) 자동 보정 — 실 ffmpeg signalstats 분석 후 applyAutoEnhance 적용(감사 +1).
    await win.evaluate(() => (window as unknown as Auto).__editor.autoEnhance());
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 30_000 });
    expect(await num(win.getByTestId('audit-count'))).toBe(1);

    // (2) 어절 교정 — 첫 어절을 더블클릭 → 인라인 입력 → Enter 커밋(감사 +1, 텍스트 반영).
    const first = win.getByTestId('word').first();
    await first.dblclick();
    const edit = win.getByTestId('word-edit');
    await expect(edit).toBeVisible();
    await edit.fill('정정완료');
    await edit.press('Enter');

    await expect(win.getByTestId('word').filter({ hasText: '정정완료' }).first()).toBeVisible({
      timeout: 10_000,
    });
    expect(await num(win.getByTestId('audit-count'))).toBe(2);
  } finally {
    await app.close();
  }
});
