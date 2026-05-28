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
const OUT = resolve(ROOT, 'artifacts/g23-broll.mp4');

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

describe('G23 multi-track B-roll — a video overlay only plays during its time window', () => {
  let broll = '';
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g23-'));
    broll = join(dir, 'broll.mp4');
    // 2-second red B-roll clip — a separate video track composited over the main video
    await exec(FFMPEG, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-t',
      '2',
      '-i',
      'color=c=red:s=240x240:r=30',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      broll,
    ]);
  });

  it('B-roll video composites within [1s,3s] only', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const overlay: OverlayClip = {
      id: 'broll',
      kind: 'video',
      src: broll,
      x: 0.6,
      y: 0.05,
      scale: 0.3,
      opacity: 1,
      startUs: 1_000_000,
      endUs: 3_000_000,
      z: 0,
    };
    const edl = timelineToEdl(timeline, SAMPLE);
    await renderEdl(edl, OUT, { overlays: [overlay], frameW: 640, frameH: 360 });
    expect(existsSync(OUT)).toBe(true);

    // overlay position: x∈[384,576], y∈[18,210]. center: (480, 114).
    const insideCrop = '40:40:440:80'; // inside the overlay region
    // during enable window (t=2.0s): red
    const during = await regionRGB(OUT, '2.0', insideCrop);
    expect(during[0]).toBeGreaterThan(150);
    // outside enable window (t=5.0s): navy (overlay gone)
    const after = await regionRGB(OUT, '5.0', insideCrop);
    expect(after[0]).toBeLessThan(60);
  });
});
