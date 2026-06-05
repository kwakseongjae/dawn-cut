import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const ROOT = process.cwd();
const MAIN = resolve(ROOT, 'apps/desktop/out/main/index.js');
const PORTRAIT = resolve(process.env.HOME ?? '', 'Desktop/패스트캠퍼스/당근.mp4');
const VIDEO = existsSync(PORTRAIT) ? PORTRAIT : resolve(ROOT, 'output/sources/ko-talk.mp4');
const shot = (n: string) => resolve(ROOT, `output/icons/${n}`);

test('아이콘 버튼(추가/삭제/닫기)이 lucide로 깔끔하게 렌더', async () => {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [MAIN],
    env: { ...process.env, DAWN_ADVANCED: '1', DAWN_DISABLE_LLM: '1' },
  });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1040, height: 720 });
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() =>
      Boolean((window as unknown as { __editor?: unknown }).__editor),
    );
    await win.evaluate(
      (p) =>
        (
          window as unknown as { __editor: { importPath: (p: string) => Promise<void> } }
        ).__editor.importPath(p),
      VIDEO,
    );
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 90_000 });
    await win.evaluate(() => {
      const ed = (window as unknown as { __editor: { addManualCue: (t: string) => void } })
        .__editor;
      ed.addManualCue('무신사 파이팅');
      ed.addManualCue('지금 바로 구경하기');
    });
    await win.waitForTimeout(400);
    // 우측 패널을 수기 자막 편집기까지 스크롤.
    await win.locator('.transcript-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await win.waitForTimeout(300);

    // 모든 아이콘 버튼은 <svg>(lucide)를 품고 raw '✕' 텍스트가 없어야 한다.
    const noGlyphs = await win.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('.x, .manual-cue [data-testid="manual-cue-remove"]'),
      );
      return {
        count: buttons.length,
        allHaveSvg: buttons.every((b) => b.querySelector('svg')),
        anyRawGlyph: buttons.some((b) => (b.textContent ?? '').includes('✕')),
      };
    });
    expect(
      noGlyphs.allHaveSvg,
      `every .x button has an svg icon: ${JSON.stringify(noGlyphs)}`,
    ).toBe(true);
    expect(noGlyphs.anyRawGlyph, 'no raw ✕ glyph remains').toBe(false);

    await win.screenshot({ path: shot('01-manual-cue-editor.png') });
    // 좌측 미디어 카드 영역 별도 캡쳐(clear-media X 아이콘 확인).
    await win
      .locator('.asset-card')
      .first()
      .screenshot({ path: shot('02-left-card.png') });
  } finally {
    await app.close();
  }
});
