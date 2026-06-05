import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const ROOT = process.cwd();
const MAIN = resolve(ROOT, 'apps/desktop/out/main/index.js');
const PORTRAIT = resolve(process.env.HOME ?? '', 'Desktop/패스트캠퍼스/당근.mp4');
const VIDEO = existsSync(PORTRAIT) ? PORTRAIT : resolve(ROOT, 'output/sources/ko-talk.mp4');
const IMG = resolve(ROOT, 'output/korean/caption-keyword.png');
const GIF = resolve(ROOT, 'assets/gif/wave.gif');
const shot = (n: string) => resolve(ROOT, `output/media-icons/${n}`);

test('미디어 패널 썸네일이 기본 이모지가 아니라 lucide SVG로 렌더', async () => {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [MAIN],
    env: { ...process.env, DAWN_ADVANCED: '1', DAWN_DISABLE_LLM: '1' },
  });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1200, height: 840 });
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

    // 이미지 오버레이 + GIF 오버레이 추가(드롭존 대신 자동화 표면).
    await win.evaluate(
      ([img, gif]) => {
        const ed = (
          window as unknown as {
            __editor: {
              addImageOverlay: (p: string) => Promise<void>;
              addOverlaySrc: (k: 'image' | 'gif' | 'video', n: string, p: string) => void;
            };
          }
        ).__editor;
        ed.addOverlaySrc('gif', 'wave.gif', gif);
        return ed.addImageOverlay(img);
      },
      [IMG, GIF],
    );
    await win.waitForTimeout(600);

    // 미디어 카드 썸네일들이 모두 <svg>(lucide)를 품고, 텍스트 이모지(🎬/🖼)가 없다.
    const thumbs = await win.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.asset-card .thumb'));
      return {
        count: els.length,
        allSvg: els.every((t) => t.querySelector('svg')),
        anyEmoji: els.some((t) => /[🎬🖼🎞]/u.test(t.textContent ?? '')),
      };
    });
    expect(thumbs.allSvg, `every media thumb should be an svg: ${JSON.stringify(thumbs)}`).toBe(
      true,
    );
    expect(thumbs.anyEmoji, 'no basic media emoji left in thumbs').toBe(false);
    expect(thumbs.count, 'video card + image overlay + gif overlay').toBeGreaterThanOrEqual(2);

    await win.locator('.dock-body').screenshot({ path: shot('01-media-panel.png') });
    await win.locator('.timeline').screenshot({ path: shot('02-timeline-blocks.png') });
  } finally {
    await app.close();
  }
});
