import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// A1 — 게이트 철거 후 시맨틱: 환경변수 없이도 전 패널·NL바가 보이고,
// '밀도 높은 도구'(감사로그·자막 세부·사전)만 인앱 간단↔프로 토글이 조절한다.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');

type Auto = { __editor: { importAndTranscribe: (p: string) => Promise<void> } };

async function launch() {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [mainEntry],
    env: { ...process.env, DAWN_DISABLE_LLM: '1' }, // ★ DAWN_ADVANCED 없음 — 게이트 철거 검증
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => Boolean((window as unknown as { __editor?: unknown }).__editor));
  return { app, win };
}

test('기본 실행(환경변수 없음): 전 패널 레일 + NL 바 노출, 밀도 도구는 간단 모드에서 숨김', async () => {
  const { app, win } = await launch();
  try {
    // 레일 전 패널 상시 노출(구 쇼케이스 게이트 철거).
    for (const id of ['media', 'text', 'sticker', 'bgm', 'effect']) {
      await expect(win.getByTestId(`rail-${id}`)).toBeVisible();
    }
    // localStorage 영속(이전 세션의 '프로')에 좌우되지 않게 결정적으로 간단으로 맞춘다.
    if ((await win.getByTestId('ui-mode').innerText()) === '프로') {
      await win.getByTestId('ui-mode').click();
    }
    await expect(win.getByTestId('ui-mode')).toHaveText('간단');
    // 바이브 편집(NL 바)은 자막 생성 후 모드와 무관하게 보인다.
    await win.evaluate((p) => (window as unknown as Auto).__editor.importAndTranscribe(p), FIXTURE);
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 60_000 });
    await expect(win.getByTestId('nl-bar')).toBeVisible();
    // 밀도 높은 도구는 간단 모드에서 숨김.
    await expect(win.getByTestId('subtitle-pos')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('간단 → 프로 토글: 자막 세부(subtitle-pos)가 나타난다', async () => {
  const { app, win } = await launch();
  try {
    await win.evaluate((p) => (window as unknown as Auto).__editor.importAndTranscribe(p), FIXTURE);
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 60_000 });
    if ((await win.getByTestId('ui-mode').innerText()) === '간단') {
      await win.getByTestId('ui-mode').click();
    }
    await expect(win.getByTestId('ui-mode')).toHaveText('프로');
    // 다음 실행의 test 1을 위해 상태를 남기지 않도록 마지막에 간단으로 복귀하지 않는다 —
    // test 1이 스스로 간단으로 맞추므로 안전(결정적).
    await expect(win.getByTestId('subtitle-pos')).toBeVisible();
    await win.screenshot({ path: 'artifacts/a1-pro-mode.png' });
  } finally {
    await app.close();
  }
});
