import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// P3 MVP: 자연어 명령 → 룰 플래너 → dryRun 제안 카드 → 승인 → command bus commit.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');

type Auto = {
  __editor: { importPath: (p: string) => Promise<void>; planAndPreview: (s: string) => void };
};

test.skip(!existsSync(WHISPER_BIN), 'whisper.cpp not built');
test('NL command: "시네마틱하게" → 제안 카드 → 승인 → 편집 기록 1', async () => {
  // 결정적·빠른 룰 경로를 검증한다(로컬 LLM은 별도 데모/통합에서). LLM이 빌드돼 있어도 끈다.
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
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 60_000 });

    // 자연어 입력창이 보인다.
    await expect(win.getByTestId('nl-bar')).toBeVisible();
    expect(await num(win.getByTestId('audit-count'))).toBe(0);

    // 자연어 명령 → 룰 플래너가 색보정 plan을 제안(상태는 아직 불변).
    await win.evaluate(
      (s) => (window as unknown as Auto).__editor.planAndPreview(s),
      '시네마틱하게',
    );
    const card = win.getByTestId('plan-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('색보정');
    const approve = win.getByTestId('plan-approve');
    await expect(approve).toBeEnabled();

    // 승인 → command bus commit → 감사 로그 1건, 카드 사라짐.
    await approve.click();
    await expect(win.getByTestId('plan-card')).toHaveCount(0);
    expect(await num(win.getByTestId('audit-count'))).toBe(1);
  } finally {
    await app.close();
  }
});

const num = async (loc: { innerText: () => Promise<string> }) =>
  Number((await loc.innerText()).trim());
