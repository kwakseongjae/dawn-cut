import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
// 실제 한국어 영상(외부 에셋)으로 검증.
const VIDEO = [
  resolve(ROOT, 'output/sources/ko-talk.mp4'),
  resolve(ROOT, 'output/sources/korean-talk.mp4'),
  resolve(ROOT, 'demo/talk.mp4'),
].find((p) => existsSync(p))!;
const PHOTO1 = resolve(ROOT, 'demo/photo1.jpg');
const PHOTO2 = resolve(ROOT, 'demo/photo2.jpg');
const shot = (n: string) => resolve(ROOT, `output/ux-overhaul/${n}`);

type Auto = {
  __editor: {
    importPath: (p: string) => Promise<void>;
    addImageOverlay: (p: string) => Promise<void>;
  };
};

test('UX overhaul: icons, subtitle card, Korean TTS, draggable voice', async () => {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [mainEntry],
    env: { ...process.env, DAWN_ADVANCED: '1', DAWN_DISABLE_LLM: '1' },
  });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() =>
      Boolean((window as unknown as { __editor?: unknown }).__editor),
    );

    // 1) 가져오기 전 — 새 rail/toolbar 아이콘(lucide) 확인
    await win.waitForTimeout(300);
    await win.screenshot({ path: shot('01-launch.png') });

    // 2) 실제 한국어 영상 가져오기
    await win.evaluate((p) => (window as unknown as Auto).__editor.importPath(p), VIDEO);
    await expect(win.getByTestId('status')).toHaveText('ready', { timeout: 90_000 });
    await win.waitForTimeout(700);
    await win.screenshot({ path: shot('02-imported.png') });

    // 3) 자막 미리보기 카드(재설계) — 트랜스크립트 컬럼의 카드를 단독 캡쳐
    const subCard = win.getByTestId('subtitle-pos');
    await subCard.scrollIntoViewIfNeeded();
    await subCard.screenshot({ path: shot('03-subtitle-card.png') });
    // 세부 스타일 디스클로저 펼친 모습도
    await subCard.getByText('세부 스타일', { exact: false }).click();
    await win.waitForTimeout(200);
    await subCard.screenshot({ path: shot('03b-subtitle-card-open.png') });

    // 4) 음성·TTS 패널 — 한국어 보이스가 목록에 있는지
    await win.getByTestId('rail-text').click();
    await win.waitForTimeout(400);
    const voiceOpts = await win.locator('#tts-voice option').allInnerTexts();
    const hasKorean = voiceOpts.some((t) => t.includes('한국어'));
    expect(hasKorean, `voice list should include a Korean voice: ${voiceOpts.join(' | ')}`).toBe(
      true,
    );
    await win.locator('.dock-body').screenshot({ path: shot('04-tts-panel.png') });

    // 5) 한국어 보이스 생성 → 실제 say(Yuna) 합성, 타임라인 보이스 블록 생김
    await win.locator('#tts-text').fill('안녕하세요. 던컷으로 만든 한국어 음성입니다.');
    await win.getByTestId('generate-voiceover').click();
    await expect(win.getByTestId('status')).toHaveText('voice ready', { timeout: 60_000 });
    await win.waitForTimeout(300);
    await win.locator('.dock-body').screenshot({ path: shot('05-voice-generated.png') });

    // 6) 같은 시점에 이미지 2개 → 겹쳐서 2행 색상 블록. + 보이스 블록까지 타임라인 캡쳐
    if (existsSync(PHOTO1) && existsSync(PHOTO2)) {
      await win.evaluate((p) => (window as unknown as Auto).__editor.addImageOverlay(p), PHOTO1);
      await win.evaluate((p) => (window as unknown as Auto).__editor.addImageOverlay(p), PHOTO2);
      await win.waitForTimeout(300);
    }
    await win.locator('.timeline').screenshot({ path: shot('06-timeline.png') });

    // 7) 전체 앱 최종(가져옴 + 오버레이 + 보이스)
    await win.screenshot({ path: shot('07-full.png') });
  } finally {
    await app.close();
  }
});
