import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInitialTimeline, timelineToEdl } from '@dawn-cut/core';
import type { OverlayClip } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { beforeAll, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');

async function regionRGB(
  video: string,
  atSec: string,
  crop: string,
): Promise<[number, number, number]> {
  const { stdout } = (await exec(
    FFMPEG,
    [
      '-y',
      '-ss',
      atSec,
      '-i',
      video,
      '-vf',
      `crop=${crop},scale=1:1`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 1_000_000 },
  )) as unknown as { stdout: Buffer };
  return [stdout[0] ?? 0, stdout[1] ?? 0, stdout[2] ?? 0];
}

describe('G22 blend modes — screen brightens the overlay region beyond plain alpha (pixel-verified)', () => {
  let gray = '';
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g22-'));
    gray = join(dir, 'gray.png');
    // a 50% gray patch — small but solid, used to differentiate blend modes
    await exec(FFMPEG, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=gray:s=200x200',
      '-frames:v',
      '1',
      gray,
    ]);
  });

  it("'screen' blend yields a brighter overlay region than the default 'normal' overlay", async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const mk = (id: string, blend?: OverlayClip['blend']): OverlayClip => ({
      id,
      kind: 'image',
      src: gray,
      x: 0.3,
      y: 0.3,
      scale: 0.25,
      opacity: 1,
      startUs: 0,
      endUs: timeline.durationProgram,
      z: 0,
      ...(blend ? { blend } : {}),
    });
    const edl = timelineToEdl(timeline, SAMPLE);
    const NORMAL = resolve(ROOT, 'artifacts/g22-normal.mp4');
    const SCREEN = resolve(ROOT, 'artifacts/g22-screen.mp4');
    await renderEdl(edl, NORMAL, { overlays: [mk('n')], frameW: 640, frameH: 360 });
    await renderEdl(edl, SCREEN, { overlays: [mk('s', 'screen')], frameW: 640, frameH: 360 });
    expect(existsSync(NORMAL) && existsSync(SCREEN)).toBe(true);

    // overlay sits at x=0.3*640=192, y=0.3*360=108, size 160×160. sample center inside it.
    const crop = '40:40:240:160';
    const normal = await regionRGB(NORMAL, '1.0', crop);
    const screen = await regionRGB(SCREEN, '1.0', crop);
    // screen of any non-black with anything is at least as bright as the input.
    // gray (128) over navy (~16,35,63) → screen ~ (136,145,159) per channel; normal is plain gray (~128,128,128).
    // Especially B channel must rise notably under screen vs normal.
    expect(screen[2]).toBeGreaterThan(normal[2] + 12); // screen brightens B clearly
    // and overall brightness sum is higher under screen
    expect(screen[0] + screen[1] + screen[2]).toBeGreaterThan(
      normal[0] + normal[1] + normal[2] + 25,
    );
  });
});
