import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const ROOT = process.cwd();
const MAIN = resolve(ROOT, 'apps/desktop/out/main/index.js');
const PORTRAIT = resolve(process.env.HOME ?? '', 'Desktop/패스트캠퍼스/당근.mp4');
const VIDEO = existsSync(PORTRAIT) ? PORTRAIT : resolve(ROOT, 'output/sources/ko-talk.mp4');
const shot = (n: string) => resolve(ROOT, `output/sticker-subtitles/${n}`);

test('스티커형 자막: 여러 개 동시 + 위치 프리셋 + 드래그 + 타임라인 병렬 행', async () => {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [MAIN],
    env: { ...process.env, DAWN_ADVANCED: '1', DAWN_DISABLE_LLM: '1' },
  });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1240, height: 880 });
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
    await win.waitForTimeout(2800); // 실제 <video> 프레임이 잡힐 때까지

    // 같은 시간대(0~2.5s)에 겹치는 수기 자막 2개 → 동시 표시 대상.
    await win.evaluate(() => {
      const ed = (
        window as unknown as {
          __editor: { addManualCue: (t: string) => void; setPlayhead: (us: number) => void };
        }
      ).__editor;
      ed.setPlayhead(0);
      ed.addManualCue('화자 1 자막');
      ed.addManualCue('화자 2 자막');
      ed.setPlayhead(600_000); // 두 cue 안
    });
    await win.waitForTimeout(400);

    // 첫 cue를 상단(tc)으로 → 두 자막이 위/아래로 분리.
    await win.locator('.cue-pos-grid').first().locator('button').nth(1).click(); // tl,tc(1),tr...
    await win.waitForTimeout(400);

    // (1) 두 라이브 자막이 동시에, 서로 다른 세로 위치에 뜬다.
    const caps = win.locator('[data-testid="live-caption"]');
    await expect(caps).toHaveCount(2);
    const tops = await caps.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)).sort((a, b) => a - b),
    );
    expect(
      tops[1] - tops[0],
      `two captions should be vertically separated: ${tops}`,
    ).toBeGreaterThan(60);
    await win.screenshot({ path: shot('01-two-captions.png') });

    // (2) 위쪽(상단) 자막을 아래로 드래그 → 위치가 실제로 바뀐다(스티커처럼).
    const top = caps.first();
    const box = await top.boundingBox();
    if (!box) throw new Error('no caption box');
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 150, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(300);
    const movedTop = await caps.first().evaluate((e) => Math.round(e.getBoundingClientRect().top));
    expect(movedTop, `dragged caption should move down from ${tops[0]}`).toBeGreaterThan(
      tops[0] + 40,
    );
    await win.screenshot({ path: shot('02-after-drag.png') });

    // (3) 타임라인 자막 트랙: 겹치는 두 cue가 서로 다른 행(병렬).
    const blockTops = await win
      .locator('[data-testid="sub-block"]')
      .evaluateAll((els) => Array.from(new Set(els.map((e) => Math.round(e.offsetTop)))));
    expect(
      blockTops.length,
      `overlapping cues should occupy 2 rows: ${blockTops}`,
    ).toBeGreaterThanOrEqual(2);
    await win.locator('.timeline').screenshot({ path: shot('03-timeline-rows.png') });
  } finally {
    await app.close();
  }
});
