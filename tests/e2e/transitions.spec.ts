import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// B4 — 전환: 효과 패널에서 크로스페이드 일괄 적용 → 버스 경유(감사 +1) + 타임라인 경계 배지.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');

type Auto = {
  __editor: { importPath: (p: string) => Promise<void>; setPlayhead: (us: number) => void };
  __dawnState: () => { clipCount: number; durationProgramUs: number; auditLog: number };
};

test('⌘B 분할 → 효과 패널 전환 적용 → 배지·감사·길이 불변 → 없음으로 제거', async () => {
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

    // 분할해서 경계를 만든다.
    await win
      .locator('body')
      .click({ position: { x: 5, y: 5 } })
      .catch(() => {});
    await win.evaluate(
      (us) => (window as unknown as Auto).__editor.setPlayhead(us),
      Math.round(s0.durationProgramUs / 2),
    );
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyB' : 'Control+KeyB');
    await expect.poll(async () => (await state()).clipCount).toBe(2);
    const s1 = await state();

    // 효과 패널 → 전환 크로스페이드 → 적용.
    await win.getByTestId('rail-effect').click();
    await win.getByTestId('transition-kind').click();
    await win.locator('.kselect-opt[data-value="crossfade"]').click();
    await win.getByTestId('transition-apply').click();

    await expect(win.getByTestId('transition-badge')).toHaveCount(1);
    const s2 = await state();
    expect(s2.durationProgramUs).toBe(s1.durationProgramUs); // 길이 완전 불변
    expect(s2.auditLog).toBe(s1.auditLog + 1); // 버스 경유 증거

    // '없음'으로 제거.
    await win.getByTestId('transition-kind').click();
    await win.locator('.kselect-opt[data-value="none"]').click();
    await win.getByTestId('transition-apply').click();
    await expect(win.getByTestId('transition-badge')).toHaveCount(0);
    expect((await state()).auditLog).toBe(s2.auditLog + 1);

    await win.screenshot({ path: 'artifacts/b4-transitions-panel.png' });
  } finally {
    await app.close();
  }
});
