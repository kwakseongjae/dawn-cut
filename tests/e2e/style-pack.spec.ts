import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// 스타일 팩 1클릭이 실제 앱에서 command bus를 거쳐 적용되는지(감사로그 증가) e2e로 검증.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');

type Auto = { __editor: { importAndTranscribe: (p: string) => Promise<void> } };

test.skip(!existsSync(WHISPER_BIN), 'whisper.cpp not built');
test('스타일 팩 1클릭(UI) → command bus 적용(감사 3) + 자막 자동 번인', async () => {
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

    // 스타일 팩 선택기가 보인다.
    await expect(win.getByTestId('style-pack-bar')).toBeVisible();
    expect(await num(win.getByTestId('audit-count'))).toBe(0);

    // 진짜 1클릭: UI 선택기로 팩 적용. viral-punch = 3 commands(replaceSubtitleStyle +
    // applyColorgrade + removeFillers) → 감사 3건 + 자막 자동 번인.
    await win.getByTestId('style-pack').selectOption('viral-punch');
    expect(await num(win.getByTestId('audit-count'))).toBe(3);
    // applyPackAndBurn이 doBurn까지 호출 → 자막 번인 상태('입힘')가 된다(D1 해소).
    await expect(win.getByTestId('burn-subtitles')).toHaveText(/입힘/, { timeout: 30_000 });
  } finally {
    await app.close();
  }
});

const num = async (loc: { innerText: () => Promise<string> }) =>
  Number((await loc.innerText()).trim());
