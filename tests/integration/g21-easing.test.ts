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

describe('G21 easing — easeOut overlay overtakes linear at the same instant (pixel-verified)', () => {
  let red = '';
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g21-'));
    red = join(dir, 'red.png');
    await exec(FFMPEG, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=120x120',
      '-frames:v',
      '1',
      red,
    ]);
  });

  it('at t=2s the easeOut overlay is past the linear position', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const mk = (id: string, easing: 'linear' | 'easeOut'): OverlayClip => ({
      id,
      kind: 'image',
      src: red,
      x: 0.05,
      y: 0.4,
      scale: 0.15,
      opacity: 1,
      startUs: 0,
      endUs: timeline.durationProgram,
      z: 0,
      to: { x: 0.7, easing },
    });
    const edl = timelineToEdl(timeline, SAMPLE);

    const linOut = resolve(ROOT, 'artifacts/g21-linear.mp4');
    const easeOutOut = resolve(ROOT, 'artifacts/g21-easeout.mp4');
    await renderEdl(edl, linOut, { overlays: [mk('l', 'linear')], frameW: 640, frameH: 360 });
    await renderEdl(edl, easeOutOut, { overlays: [mk('e', 'easeOut')], frameW: 640, frameH: 360 });

    // at t=2s (u=0.25):
    //   linear: x ≈ 32 + 416*0.25 = 136   → red around x∈[136,232]
    //   easeOut: x ≈ 32 + 416*(1-(1-0.25)^2) = 32 + 416*0.4375 = 214 → red ∈ [214,310]
    // crop x=260..280, y=160..180: NO red for linear, RED for easeOut.
    const linear = await regionRGB(linOut, '2.0', '20:20:260:160');
    const eased = await regionRGB(easeOutOut, '2.0', '20:20:260:160');
    expect(linear[0]).toBeLessThan(60);
    expect(eased[0]).toBeGreaterThan(150);
  });
});
