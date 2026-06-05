import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const ROOT = process.cwd();
const MAIN = resolve(ROOT, 'apps/desktop/out/main/index.js');
const PORTRAIT = resolve(process.env.HOME ?? '', 'Desktop/패스트캠퍼스/당근.mp4');
const VIDEO = existsSync(PORTRAIT) ? PORTRAIT : resolve(ROOT, 'output/sources/ko-talk.mp4');
const shot = (n: string) => resolve(ROOT, `output/timeline/${n}`);

test('자막 트랙: cue가 타임라인 블록으로 보이고, 빈 레인 모양이 정상', async () => {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [MAIN],
    env: { ...process.env, DAWN_ADVANCED: '1', DAWN_DISABLE_LLM: '1' },
  });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1200, height: 820 });
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

    // 서로 다른 시점에 수기 자막 3개 → 자막 트랙에 블록 3개.
    await win.evaluate(() => {
      const ed = (
        window as unknown as {
          __editor: { addManualCue: (t: string) => void; setPlayhead: (us: number) => void };
        }
      ).__editor;
      ed.setPlayhead(0);
      ed.addManualCue('첫 번째 자막');
      ed.setPlayhead(4_000_000);
      ed.addManualCue('두 번째 자막');
      ed.setPlayhead(8_000_000);
      ed.addManualCue('세 번째 자막 — 길게 넣어 말줄임 확인');
      ed.setPlayhead(500_000);
    });
    await win.waitForTimeout(500);

    // 자막 트랙에 cue 블록이 보인다.
    const blocks = win.locator('[data-testid="sub-block"]');
    await expect(blocks).toHaveCount(3);

    // 빈 VOICE 레인: 힌트가 레인 폭을 꽉 채우고(예전의 텍스트폭 박스 아님), 자체 테두리가 없다.
    const voice = await win.locator('.voice-lane').evaluate((lane) => {
      const hint = lane.querySelector('.empty-track') as HTMLElement;
      const lr = lane.getBoundingClientRect();
      const hr = hint.getBoundingClientRect();
      const cs = getComputedStyle(hint);
      return {
        fillsWidth: hr.width >= lr.width * 0.85,
        oneLine: hr.height <= 22,
        noOwnBorder: cs.borderTopWidth === '0px' || cs.borderStyle === 'none',
      };
    });
    expect(
      voice.fillsWidth,
      `empty hint should fill lane, not shrink-wrap: ${JSON.stringify(voice)}`,
    ).toBe(true);
    expect(voice.oneLine, `empty hint should be one line: ${JSON.stringify(voice)}`).toBe(true);
    expect(
      voice.noOwnBorder,
      `empty hint should have no box border: ${JSON.stringify(voice)}`,
    ).toBe(true);

    await win.locator('.timeline').screenshot({ path: shot('01-subtitle-track.png') });

    // 블록 클릭 → 해당 cue 시작으로 플레이헤드 이동(8s 블록).
    await blocks.nth(2).click();
    await win.waitForTimeout(300);
    await win.locator('.timeline').screenshot({ path: shot('02-after-click-seek.png') });
  } finally {
    await app.close();
  }
});
