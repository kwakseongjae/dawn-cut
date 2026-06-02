import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// 쇼케이스 게이트: 기본(단순) 모드는 고급/실험적 UI를 숨기고, DAWN_ADVANCED=1이면 노출.
// 첫 사용자/테스터에게는 와우 루프(자막·보정·스타일팩)만, 개발/데모에는 전체.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');

async function launch(advanced: boolean) {
  // 빈 문자열이면 preload의 `=== '1'` 체크가 false → 단순 모드(부모 셸에 값이 있어도 무력화).
  const env = { ...process.env, DAWN_DISABLE_LLM: '1', DAWN_ADVANCED: advanced ? '1' : '' };
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [mainEntry],
    env,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => Boolean((window as unknown as { __editor?: unknown }).__editor));
  return { app, win };
}

test('단순(기본) 모드: 고급/실험 UI(NL 바·스티커 레일)는 숨고, 와우셋은 보인다', async () => {
  const { app, win } = await launch(false);
  try {
    // 프로덕션 와우셋은 항상 보인다.
    await expect(win.getByTestId('rail-effect')).toBeVisible();
    // 실험적(자연어 편집)·고급(스티커/TTS 레일) UI는 숨는다.
    await expect(win.getByTestId('nl-bar')).toHaveCount(0);
    await expect(win.getByTestId('rail-sticker')).toHaveCount(0);
    await expect(win.getByTestId('rail-text')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('고급(DAWN_ADVANCED=1) 모드: 전체 UI 노출', async () => {
  const { app, win } = await launch(true);
  try {
    await expect(win.getByTestId('rail-sticker')).toBeVisible();
    await expect(win.getByTestId('rail-text')).toBeVisible();
    await expect(win.getByTestId('rail-effect')).toBeVisible();
  } finally {
    await app.close();
  }
});
