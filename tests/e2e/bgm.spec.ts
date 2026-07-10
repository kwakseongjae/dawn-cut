import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// B7 — BGM 패널: 카탈로그에서 '사용' → Music 레인 블록 + 볼륨/덕킹 조절 → 제거.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');

type Auto = { __editor: { importPath: (p: string) => Promise<void> } };

test('BGM 추가 → Music 레인 블록 → 덕킹 토글 → 제거', async () => {
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
    await win.evaluate((p) => (window as unknown as Auto).__editor.importPath(p), FIXTURE);
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 20_000 });

    // BGM 패널 → 카탈로그 로드 → 첫 트랙 '사용'.
    await win.getByTestId('rail-bgm').click();
    await expect(win.getByTestId('bgm-row-dawn-lofi')).toBeVisible({ timeout: 10_000 });
    await win.getByTestId('bgm-use-dawn-lofi').click();

    await expect(win.getByTestId('bgm-current')).toBeVisible();
    await expect(win.getByTestId('music-block')).toBeVisible();
    await expect(win.getByTestId('music-block')).toContainText('새벽 로파이');
    await expect(win.getByTestId('music-block')).toContainText('덕킹'); // 기본 on

    // 덕킹 토글 off → 라벨에서 사라짐.
    await win.getByTestId('bgm-duck').uncheck();
    await expect(win.getByTestId('music-block')).not.toContainText('덕킹');

    await win.screenshot({ path: 'artifacts/b7-bgm-panel.png' });

    // 제거.
    await win.getByTestId('bgm-remove').click();
    await expect(win.getByTestId('music-block')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
