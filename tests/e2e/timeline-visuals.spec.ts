import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// B2 — 클립 필름스트립·파형. 가져오기 후 비동기 추출이 끝나면 Video 클립에
// 썸네일 img들과 파형 svg가 렌더된다. 분할 후에도 각 클립이 자기 소스 구간을 보인다.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');

type Auto = {
  __editor: { importPath: (p: string) => Promise<void>; setPlayhead: (us: number) => void };
  __dawnState: () => { durationProgramUs: number };
};

test('가져오기 → 필름스트립 + 파형 렌더 → 분할 후에도 클립별 유지', async () => {
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

    // ① 비동기 추출 완료 대기 — 8s fixture면 썸네일 6~12장.
    const track = win.getByTestId('tl-video-track');
    await expect
      .poll(async () => track.locator('.clip .film img').count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(6);
    await expect(track.locator('.clip svg.wave path').first()).toBeVisible();
    const dAttr = await track.locator('.clip svg.wave path').first().getAttribute('d');
    expect(dAttr?.startsWith('M0 1')).toBe(true); // 중앙 대칭 area path

    // ② Cmd+B 분할 → 클립 2개가 각자 필름스트립·파형을 가진다.
    const dur = (await win.evaluate(() => (window as unknown as Auto).__dawnState()))
      .durationProgramUs;
    await win
      .locator('body')
      .click({ position: { x: 5, y: 5 } })
      .catch(() => {});
    await win.evaluate(
      (us) => (window as unknown as Auto).__editor.setPlayhead(us),
      Math.round(dur / 2),
    );
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyB' : 'Control+KeyB');
    await expect(track.locator('.clip')).toHaveCount(2);
    for (const i of [0, 1]) {
      expect(await track.locator('.clip').nth(i).locator('.film img').count()).toBeGreaterThan(1);
      await expect(track.locator('.clip').nth(i).locator('svg.wave path')).toBeVisible();
    }
    await win.screenshot({ path: 'artifacts/b2-timeline-visuals.png' });
  } finally {
    await app.close();
  }
});
