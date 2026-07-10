import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// B5 — 배속: 효과 패널에서 2× 적용 → 길이 절반·감사 +1·클립 라벨 2× → 1×로 원복.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');

type Auto = {
  __editor: { importPath: (p: string) => Promise<void> };
  __dawnState: () => { durationProgramUs: number; auditLog: number };
};

test('배속 2× 적용 → 길이 절반 → 1× 원복', async () => {
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
    const state = () => win.evaluate(() => (window as unknown as Auto).__dawnState());
    const s0 = await state();

    await win.getByTestId('rail-effect').click();
    await win.getByTestId('speed-select').click();
    await win.locator('.kselect-opt[data-value="2"]').click();
    await win.getByTestId('speed-apply').click();

    const s1 = await state();
    expect(Math.abs(s1.durationProgramUs - s0.durationProgramUs / 2)).toBeLessThan(2);
    expect(s1.auditLog).toBe(s0.auditLog + 1);
    await expect(win.getByTestId('tl-video-track').locator('.clip-label')).toContainText('2×');

    // 1× 원복.
    await win.getByTestId('speed-select').click();
    await win.locator('.kselect-opt[data-value="1"]').click();
    await win.getByTestId('speed-apply').click();
    const s2 = await state();
    expect(s2.durationProgramUs).toBe(s0.durationProgramUs);
    await win.screenshot({ path: 'artifacts/b5-speed-panel.png' });
  } finally {
    await app.close();
  }
});
