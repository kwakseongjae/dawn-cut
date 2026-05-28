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
const OUT = resolve(ROOT, 'artifacts/g20-rotation.mp4');

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

describe('G20 rotation — overlay rotation changes the composited geometry (pixel-verified)', () => {
  let bar = '';
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g20-'));
    bar = join(dir, 'bar.png');
    // a wide horizontal bar — clearly distinguishable from its 90°-rotated form
    await exec(FFMPEG, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=100x20',
      '-frames:v',
      '1',
      bar,
    ]);
  });

  it('rotation=90 makes a horizontal bar appear vertical in the output frame', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const overlay: OverlayClip = {
      id: 'rot',
      kind: 'image',
      src: bar,
      x: 0.2,
      y: 0.5,
      scale: 100 / 640,
      opacity: 1,
      startUs: 0,
      endUs: timeline.durationProgram,
      z: 0,
      rotation: 90,
    };
    const edl = timelineToEdl(timeline, SAMPLE);
    await renderEdl(edl, OUT, { overlays: [overlay], frameW: 640, frameH: 360 });

    // unrotated bar would occupy x[128,228]×y[180,200] (horizontal). 90° rotation flips it
    // to x[128,148]×y[180,280] (vertical). Verify both consequences:
    //  - the original horizontal region (further right) is now NAVY (no red where the bar used to be)
    const wasBar = await regionRGB(OUT, '1.0', '20:8:190:185'); // x190..210, y185..193: middle of old bar
    expect(wasBar[0]).toBeLessThan(80);
    //  - the new vertical region (below the original) is RED
    const nowBar = await regionRGB(OUT, '1.0', '8:30:132:230'); // x132..140, y230..260: lower in vertical bar
    expect(nowBar[0]).toBeGreaterThan(150);
  });
});
