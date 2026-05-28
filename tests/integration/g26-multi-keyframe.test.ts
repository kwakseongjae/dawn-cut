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
const OUT = resolve(ROOT, 'artifacts/g26-multi-kf.mp4');

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

describe('G26 multi-keyframe — 3 keyframes trace an L-shape path no 2-keyframe lerp can match', () => {
  let red = '';
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g26-'));
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

  it('overlay follows base→top→right corners at the expected timestamps', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const overlay: OverlayClip = {
      id: 'l-shape',
      kind: 'image',
      src: red,
      x: 0.05,
      y: 0.4,
      scale: 0.15,
      opacity: 1,
      startUs: 0,
      endUs: timeline.durationProgram,
      z: 0,
      keyframes: [
        { u: 0.5, x: 0.05, y: 0.05 }, // mid: still left, but UP
        { u: 1.0, x: 0.7, y: 0.4 }, // end: right, back at original y
      ],
    };
    const edl = timelineToEdl(timeline, SAMPLE);
    await renderEdl(edl, OUT, { overlays: [overlay], frameW: 640, frameH: 360 });
    expect(existsSync(OUT)).toBe(true);

    // overlay 96×96. At t=2s (u=0.25): between base→mid → roughly (32, ~81). RED at (60,90).
    const earlyTopLeft = await regionRGB(OUT, '2.0', '40:40:50:80');
    expect(earlyTopLeft[0]).toBeGreaterThan(150);

    // a straight 2-keyframe lerp (left→right) would put the overlay at ~(136, 144) at t=2s.
    // The L-shape DOESN'T visit that point — assert it's still navy there.
    const earlyLinearGhost = await regionRGB(OUT, '2.0', '40:40:160:160');
    expect(earlyLinearGhost[0]).toBeLessThan(60);

    // At t=6s (u=0.75): between mid→end → roughly (240, ~81). RED there.
    const lateMid = await regionRGB(OUT, '6.0', '40:40:260:80');
    expect(lateMid[0]).toBeGreaterThan(150);

    // and the bottom-left (where base position was) is now empty
    const lateBaseGhost = await regionRGB(OUT, '6.0', '40:40:50:160');
    expect(lateBaseGhost[0]).toBeLessThan(60);
  });
});
