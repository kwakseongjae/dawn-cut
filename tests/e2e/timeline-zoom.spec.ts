import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// 타임라인 v2(B1) — 시간 눈금 + 줌(버튼) + 가로 스크롤. 실앱 검증 + 스크린샷 아카이브.
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');

type Auto = {
  __editor: { importPath: (p: string) => Promise<void> };
};

test('시간 눈금 렌더 → 줌 인(스크롤 폭 증가) → 맞춤 복귀 — 시킹 무회귀', async () => {
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

    // ① 눈금: 0:00 라벨을 포함한 주눈금이 렌더된다.
    const ruler = win.getByTestId('tl-ruler');
    await expect(ruler).toBeVisible();
    expect(await ruler.locator('.tick-label').count()).toBeGreaterThanOrEqual(2);
    await expect(ruler.locator('.tick-label').first()).toHaveText(/^0:00(\.0)?$/);

    const scrollState = () =>
      win.evaluate(() => {
        const el = document.querySelector('.tracks') as HTMLElement;
        return { scrollW: el.scrollWidth, clientW: el.clientWidth };
      });

    // ② 기본(맞춤)에선 가로 스크롤 없음.
    const s0 = await scrollState();
    expect(s0.scrollW).toBeLessThanOrEqual(s0.clientW + 2);
    await expect(win.getByTestId('tl-zoom-val')).toHaveText('100%');

    // ③ 줌 인 ×2 → 225%, 스크롤 폭이 뷰포트를 넘는다. 눈금 간격은 더 촘촘해진다(라벨 수 증가).
    const labels0 = await ruler.locator('.tick-label').count();
    await win.getByTestId('tl-zoom-in').click();
    await win.getByTestId('tl-zoom-in').click();
    await expect(win.getByTestId('tl-zoom-val')).toHaveText('225%');
    const s1 = await scrollState();
    expect(s1.scrollW).toBeGreaterThan(s1.clientW * 2);
    expect(await ruler.locator('.tick-label').count()).toBeGreaterThanOrEqual(labels0);
    await win.screenshot({ path: 'artifacts/b1-timeline-zoom.png' });

    // ④ 줌 상태에서 눈금 클릭 = 시킹(플레이헤드 이동) 무회귀.
    await ruler.click({ position: { x: 200, y: 12 } });
    const playheadLeft = await win
      .getByTestId('tl-video-track')
      .locator('.playhead')
      .evaluate((el) => Number.parseFloat((el as HTMLElement).style.left));
    expect(playheadLeft).toBeGreaterThan(0);

    // ⑤ 맞춤 → 100%, 스크롤 소멸.
    await win.getByTestId('tl-zoom-fit').click();
    await expect(win.getByTestId('tl-zoom-val')).toHaveText('100%');
    const s2 = await scrollState();
    expect(s2.scrollW).toBeLessThanOrEqual(s2.clientW + 2);
  } finally {
    await app.close();
  }
});
