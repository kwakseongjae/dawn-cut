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
const OUT = resolve(ROOT, 'artifacts/g19-keyframe.mp4');

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

describe('G19 keyframe animation — overlay position animates over time (pixel-verified)', () => {
  let red = '';
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g19-'));
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

  it('animates an overlay from left to right; pixels confirm the movement', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const overlay: OverlayClip = {
      id: 'mover',
      kind: 'image',
      src: red,
      x: 0.05,
      y: 0.4,
      scale: 0.15,
      opacity: 1,
      startUs: 0,
      endUs: timeline.durationProgram,
      z: 0,
      to: { x: 0.7 }, // linear lerp left→right
    };
    const edl = timelineToEdl(timeline, SAMPLE);
    await renderEdl(edl, OUT, { overlays: [overlay], frameW: 640, frameH: 360 });
    expect(existsSync(OUT)).toBe(true);

    // sample 640x360, overlay 96×96 (scale 0.15). y_norm=0.4 → y∈[144,240].
    // at t=0.5s, x≈58 → red occupies x∈[58,154]; sample crop center inside it.
    // at t=6.0s, x≈344 → red occupies x∈[344,440].
    const LEFT = '60:60:70:160'; // inside the left-position red square
    const RIGHT = '60:60:370:160'; // inside the right-position red square

    const earlyLeft = await regionRGB(OUT, '0.5', LEFT);
    const earlyRight = await regionRGB(OUT, '0.5', RIGHT);
    const lateLeft = await regionRGB(OUT, '6.0', LEFT);
    const lateRight = await regionRGB(OUT, '6.0', RIGHT);

    // early: overlay on the LEFT
    expect(earlyLeft[0]).toBeGreaterThan(150); // strong red on the left at t=0.5
    expect(earlyRight[0]).toBeLessThan(60); // navy on the right
    // late: overlay on the RIGHT
    expect(lateRight[0]).toBeGreaterThan(150); // strong red on the right at t=6.0
    expect(lateLeft[0]).toBeLessThan(60); // navy on the left
  });
});
