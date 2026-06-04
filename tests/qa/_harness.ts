import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type ElectronApplication,
  type Locator,
  type Page,
  _electron as electron,
} from '@playwright/test';
import electronPath from 'electron';

export const ROOT = process.cwd();
const MAIN = resolve(ROOT, 'apps/desktop/out/main/index.js');
const HOME = process.env.HOME ?? '';

// 실제(외부 포함) 미디어 — import/preview의 핵심 엣지케이스를 커버.
export const MEDIA = {
  koTalk: resolve(ROOT, 'output/sources/ko-talk.mp4'), // 한국어 오디오, h264 L3.2 네이티브 재생
  koCook: resolve(ROOT, 'output/sources/ko-cook.mp4'), // AV1 → 프리뷰 프록시 경로
  noAudio: resolve(HOME, 'Desktop/패스트캠퍼스/당근.mp4'), // 무음 + h264 L5.2 세로 → 프록시+무음
  short: resolve(ROOT, 'demo/talk.mp4'), // 23s 짧은 클립(내보내기 시간 단축용)
  photo1: resolve(ROOT, 'demo/photo1.jpg'),
  photo2: resolve(ROOT, 'demo/photo2.jpg'),
  gif: resolve(ROOT, 'output/sources/earth.gif'),
};

export interface Step {
  step: string;
  note?: string;
  shot?: string;
}
export interface FeatureCtx {
  win: Page;
  dir: string;
  shot: (name: string, loc?: Locator) => Promise<void>;
  note: (step: string, note?: string) => void;
  /** window.__editor.<method>(...args) 호출 */
  editor: (method: string, ...args: unknown[]) => Promise<unknown>;
  /** 현재 store 상태에서 일부 필드 읽기(검증용) */
  state: () => Promise<Record<string, unknown>>;
  /** 타임라인 블록(testid)을 레인 가로비율 from→to로 드래그 */
  dragBlock: (testid: string, fromFrac: number, toFrac: number) => Promise<void>;
}

// __editor 자동화 훅 + (검증용) store 상태 노출. 렌더러 번들에 이미 window.__editor가 있다.
type AutoWin = {
  __editor: Record<string, (...a: unknown[]) => unknown>;
  __dawnState?: () => Record<string, unknown>;
};

/**
 * 한 기능 시나리오를 실제 앱에서 구동하며 스크린샷 + 콘솔에러 + 관찰결과(JSON)를
 * output/qa/<id>/ 에 남긴다. body가 던져도 결과를 기록하고 계속 진행(스위트는 끝까지 돈다).
 */
export async function runFeature(
  id: string,
  title: string,
  body: (ctx: FeatureCtx) => Promise<void>,
): Promise<void> {
  const dir = resolve(ROOT, `output/qa/${id}`);
  mkdirSync(dir, { recursive: true });
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const steps: Step[] = [];
  let status: 'ok' | 'error' = 'ok';
  let error: string | undefined;

  const app: ElectronApplication = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [MAIN],
    env: { ...process.env, DAWN_ADVANCED: '1', DAWN_DISABLE_LLM: '1' },
  });
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 500));
    });
    win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 500)));
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => Boolean((window as unknown as AutoWin).__editor), null, {
      timeout: 20_000,
    });

    const shot = async (name: string, loc?: Locator) => {
      const file = `${steps.length.toString().padStart(2, '0')}-${name}.png`;
      try {
        await (loc ?? win).screenshot({ path: resolve(dir, file) });
        steps.push({ step: name, shot: file });
      } catch (e) {
        steps.push({ step: name, note: `shot failed: ${String(e).slice(0, 120)}` });
      }
    };
    const note = (step: string, n?: string) => steps.push({ step, note: n });
    const editor = (method: string, ...args: unknown[]) =>
      win.evaluate(
        ([m, a]) => {
          const fn = (window as unknown as AutoWin).__editor[m as string];
          return Promise.resolve(fn(...(a as unknown[])));
        },
        [method, args] as const,
      );
    const state = () =>
      win.evaluate(() => (window as unknown as AutoWin).__dawnState?.() ?? {}) as Promise<
        Record<string, unknown>
      >;
    const dragBlock = async (testid: string, fromFrac: number, toFrac: number) => {
      const lane = win.locator(`[data-testid="${testid}"]`).first();
      const box = await lane.boundingBox();
      const laneBox = await lane.locator('xpath=..').boundingBox();
      if (!box || !laneBox) return;
      const y = box.y + box.height / 2;
      const x0 = box.x + box.width / 2;
      const x1 = laneBox.x + laneBox.width * toFrac;
      await win.mouse.move(x0, y);
      await win.mouse.down();
      await win.mouse.move(x1, y, { steps: 8 });
      await win.mouse.up();
    };

    await body({ win, dir, shot, note, editor, state, dragBlock });
  } catch (e) {
    status = 'error';
    error = e instanceof Error ? `${e.message}\n${e.stack ?? ''}`.slice(0, 1500) : String(e);
  } finally {
    writeFileSync(
      resolve(dir, 'result.json'),
      JSON.stringify({ id, title, status, error, consoleErrors, pageErrors, steps }, null, 2),
    );
    await app.close();
  }
}
