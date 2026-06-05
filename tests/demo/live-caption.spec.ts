import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const ROOT = process.cwd();
const MAIN = resolve(ROOT, 'apps/desktop/out/main/index.js');
// 무음 영상(수기 자막 대상) — 세로 당근 우선, 없으면 ko-talk.
const PORTRAIT = resolve(process.env.HOME ?? '', 'Desktop/패스트캠퍼스/당근.mp4');
const VIDEO = existsSync(PORTRAIT) ? PORTRAIT : resolve(ROOT, 'output/sources/ko-talk.mp4');
const shot = (n: string) => resolve(ROOT, `output/live-caption/${n}`);

test('수기 자막이 영상 위에 라이브로 떠 "들어가는지" 눈으로 보인다', async () => {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [MAIN],
    env: { ...process.env, DAWN_ADVANCED: '1', DAWN_DISABLE_LLM: '1' },
  });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1180, height: 820 });
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
    // 실제 <video>가 떠 프레임이 잡힐 때까지 대기(프록시 변환 포함).
    await win.waitForTimeout(3000);

    // 수기 자막 1개 추가(현재 playhead=0 근처) → playhead를 그 구간 안으로.
    await win.evaluate(() => {
      const ed = (
        window as unknown as {
          __editor: { addManualCue: (t: string) => void; setPlayhead: (us: number) => void };
        }
      ).__editor;
      ed.addManualCue('무신사 파이팅');
      ed.setPlayhead(500_000); // 0.5s — 기본 cue(0~2.5s) 안
    });
    await win.waitForTimeout(500);

    // 영상 위 라이브 자막 캔버스가 실제로 그려졌는가(있고, 크기 > 0, 프레임 안에 위치).
    const live = await win.locator('[data-testid="live-caption"]').evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const frame = c.parentElement as HTMLElement;
      const r = c.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      return {
        present: true,
        painted: c.width > 0 && c.height > 0,
        withinFrame:
          r.left >= fr.left - 1 &&
          r.right <= fr.right + 1 &&
          r.top >= fr.top - 1 &&
          r.bottom <= fr.bottom + 1,
      };
    });
    expect(live.present && live.painted, `live caption must paint: ${JSON.stringify(live)}`).toBe(
      true,
    );
    expect(
      live.withinFrame,
      `live caption must sit inside video frame: ${JSON.stringify(live)}`,
    ).toBe(true);
    await win.screenshot({ path: shot('01-live-on-video.png') });

    // playhead를 cue 밖(5s)으로 옮기면 라이브 자막이 사라진다(WYSIWYG: "지금 보일 자막"만).
    await win.evaluate(() =>
      (
        window as unknown as { __editor: { setPlayhead: (us: number) => void } }
      ).__editor.setPlayhead(5_000_000),
    );
    await win.waitForTimeout(400);
    const gone = await win.locator('[data-testid="live-caption"]').count();
    expect(gone, 'live caption should disappear outside the cue window').toBe(0);
    await win.screenshot({ path: shot('02-outside-cue.png') });
  } finally {
    await app.close();
  }
});
