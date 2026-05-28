import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';

// Playwright runs from the repo root.
const mainEntry = resolve(process.cwd(), 'apps/desktop/out/main/index.js');

// G0 smoke (V02): the real Electron app boots, renders the title, and the
// typed IPC bridge (contextIsolation=true, nodeIntegration=false) round-trips.
test('smoke: app boots, title renders, IPC ping/pong works', async () => {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [mainEntry],
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expect(win).toHaveTitle('dawn-cut');
    await expect(win.getByTestId('app-title')).toHaveText('dawn-cut');

    // typed IPC bridge: renderer → main → renderer
    await win.getByTestId('ping-button').click();
    await expect(win.getByTestId('pong')).toHaveText('pong');

    await win.screenshot({ path: resolve(process.cwd(), 'artifacts/g0-smoke.png') });
  } finally {
    await app.close();
  }
});
