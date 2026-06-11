import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// CapCut 표준 키맵(issue #6) — Cmd+B 분할 / Q·W 플레이헤드 리플 삭제. 실앱 키 입력 검증.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');

type Auto = {
  __editor: { importPath: (p: string) => Promise<void>; setPlayhead: (us: number) => void };
  __dawnState: () => { clipCount: number; durationProgramUs: number; auditLog: number };
};

test('Cmd+B 분할(길이 불변) → W 플레이헤드 우측 삭제(리플) — undo·감사 포함', async () => {
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
    const dur0 = s0.durationProgramUs;

    // 본문(버튼 아닌 곳) 포커스 보장 후 키 입력.
    await win
      .locator('body')
      .click({ position: { x: 5, y: 5 } })
      .catch(() => {});

    // ① Cmd+B — 플레이헤드(중앙)에서 분할: 클립 2개, 길이 불변, 감사 +1.
    await win.evaluate(
      (us) => (window as unknown as Auto).__editor.setPlayhead(us),
      Math.round(dur0 / 2),
    );
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyB' : 'Control+KeyB');
    await win.waitForTimeout(200);
    const s1 = await state();
    expect(s1.clipCount).toBe(2);
    expect(s1.durationProgramUs).toBe(dur0);
    expect(s1.auditLog).toBe(s0.auditLog + 1);

    // ② W — 플레이헤드(3/4 지점)부터 그 클립 끝까지 삭제 → 길이 감소.
    await win.evaluate(
      (us) => (window as unknown as Auto).__editor.setPlayhead(us),
      Math.round((dur0 * 3) / 4),
    );
    await win.keyboard.press('KeyW');
    await win.waitForTimeout(200);
    const s2 = await state();
    expect(s2.durationProgramUs).toBeLessThan(dur0);
    expect(s2.auditLog).toBe(s1.auditLog + 1);

    // ③ ⌘Z — W 삭제가 undo로 복원된다(분할 직후 길이로).
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyZ' : 'Control+KeyZ');
    await win.waitForTimeout(200);
    const s3 = await state();
    expect(s3.durationProgramUs).toBe(dur0);
  } finally {
    await app.close();
  }
});
