import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const ROOT = process.cwd();
const MAIN = resolve(ROOT, 'apps/desktop/out/main/index.js');
// 세로(portrait) 영상이 타임라인을 뚫던 케이스를 직접 재현 — 있으면 당근(세로), 없으면 ko-talk.
const PORTRAIT = resolve(process.env.HOME ?? '', 'Desktop/패스트캠퍼스/당근.mp4');
const VIDEO = existsSync(PORTRAIT) ? PORTRAIT : resolve(ROOT, 'output/sources/ko-talk.mp4');
const shot = (n: string) => resolve(ROOT, `output/responsive/${n}`);

test('작은 창: 우측 패널 스크롤 + 가운데 미리보기 맞춤', async () => {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [MAIN],
    env: { ...process.env, DAWN_ADVANCED: '1', DAWN_DISABLE_LLM: '1' },
  });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1000, height: 680 }); // 사용자 스샷과 유사한 작은 창
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
    await win.waitForTimeout(900);
    await win.screenshot({ path: shot('01-small-top.png') });

    // 우측 패널이 실제로 '스크롤 가능'한가(콘텐츠 > 영역) + 끝까지 스크롤 → 갤러리 하단까지 보임
    const scroller = win.locator('.transcript-scroll');
    const metrics = await scroller.evaluate((el) => ({
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      scrollable: el.scrollHeight > el.clientHeight + 4,
    }));
    expect(
      metrics.scrollable,
      `transcript-scroll should overflow: ${JSON.stringify(metrics)}`,
    ).toBe(true);
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await win.waitForTimeout(300);
    await win.screenshot({ path: shot('02-small-scrolled.png') });

    // 프록시 변환이 끝나 실제 <video>가 뜰 때까지 잠깐 대기(세로 영상 오버플로 재현 조건).
    await win.waitForTimeout(2500);
    await win.screenshot({ path: shot('03-portrait-fit.png') });
    // 미리보기 프레임이 스테이지 안에 맞고, 타임라인을 뚫지 않는다(하단 침범 없음).
    const fit = await win.locator('.video-frame').evaluate((el) => {
      const stage = el.closest('.stage') as HTMLElement;
      const timeline = document.querySelector('.timeline') as HTMLElement;
      const r = el.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      return {
        withinW: r.width <= s.width + 1,
        withinH: r.height <= s.height + 1,
        aboveTimeline:
          r.bottom <= (timeline?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY) + 1,
      };
    });
    expect(fit.withinW && fit.withinH, `preview must fit stage: ${JSON.stringify(fit)}`).toBe(true);
    expect(fit.aboveTimeline, `preview must not punch into timeline: ${JSON.stringify(fit)}`).toBe(
      true,
    );
    // 재생바(play/scrub)가 잘리지 않고 온전히 타임라인 위에 보인다.
    const controls = await win.locator('.controls').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const tl = (document.querySelector('.timeline') as HTMLElement).getBoundingClientRect();
      return { bottom: r.bottom, tlTop: tl.top, visible: r.bottom <= tl.top + 1 && r.height > 30 };
    });
    expect(
      controls.visible,
      `play controls must be fully visible: ${JSON.stringify(controls)}`,
    ).toBe(true);
  } finally {
    await app.close();
  }
});
