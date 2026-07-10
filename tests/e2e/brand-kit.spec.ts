import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// D7 — 브랜드 킷: 로고 설정 → 워터마크(오버레이) → 아웃트로 카드 → 브랜드 자막색(버스·감사).
const ROOT = process.cwd();
const mainEntry = resolve(ROOT, 'apps/desktop/out/main/index.js');
const FIXTURE = resolve(ROOT, 'fixtures/sample.mp4');

// 테스트 로고 — 1x1 아닌 실제 보이는 PNG(80x40 빨강)를 즉석 생성.
function makeLogo(): string {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEklEQVR4nGP8z8Dwn4GBgYEBAA0GAgGjZUCyAAAAAElFTkSuQmCC',
    'base64',
  );
  const p = join(tmpdir(), `dawn-brand-logo-${Date.now()}.png`);
  writeFileSync(p, png);
  return p;
}

type Auto = {
  __editor: {
    importPath: (p: string) => Promise<void>;
    setBrandKit: (patch: Record<string, unknown>) => void;
    applyBrandWatermark: () => void;
    applyBrandColors: () => void;
  };
  __dawnState: () => { auditLog: number };
};

test('브랜드 킷: 워터마크 → 아웃트로 → 자막 색(감사 +1)', async () => {
  const logo = makeLogo();
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

    // 브랜드 설정 주입(파일 input 대신 자동화 표면) + 패널 확인.
    await win.evaluate(
      (p) =>
        (window as unknown as Auto).__editor.setBrandKit({
          logoPath: p,
          name: '던컷',
          tagline: '영상이 기기를 떠나지 않는 AI 편집',
          accentColor: '#ffd54f',
        }),
      logo,
    );
    await win.getByTestId('rail-effect').click();
    await expect(win.getByTestId('brand-logo-set')).toBeVisible();

    // ① 워터마크 — 오버레이 1개(brand-wm), 재적용해도 1개(교체).
    await win.getByTestId('brand-watermark-apply').click();
    await expect(win.getByTestId('ov-block')).toHaveCount(1);
    await win.getByTestId('brand-watermark-apply').click();
    await expect(win.getByTestId('ov-block')).toHaveCount(1);

    // ② 아웃트로 — 카드 래스터 → 오버레이 2개.
    await win.getByTestId('brand-outro-apply').click();
    await expect(win.getByTestId('ov-block')).toHaveCount(2, { timeout: 10_000 });

    // ③ 브랜드 자막색 — 버스 경유 = 감사 +1.
    const a0 = (await win.evaluate(() => (window as unknown as Auto).__dawnState())).auditLog;
    await win.getByTestId('brand-color-apply').click();
    await expect
      .poll(
        async () => (await win.evaluate(() => (window as unknown as Auto).__dawnState())).auditLog,
      )
      .toBe(a0 + 1);

    await win.screenshot({ path: 'artifacts/d7-brand-kit.png' });
  } finally {
    await app.close();
  }
});
