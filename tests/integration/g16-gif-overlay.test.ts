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
const OUT = resolve(ROOT, 'artifacts/g16-gif-overlay.mp4');

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
const sat = (c: [number, number, number]) => Math.max(...c);

describe('G16 animated GIF overlay (real ffmpeg)', () => {
  let gif = '';
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g16-'));
    const fr1 = join(dir, 'fr1.png');
    const fr2 = join(dir, 'fr2.png');
    gif = join(dir, 'anim.gif');
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
      fr1,
    ]);
    await exec(FFMPEG, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=120x120',
      '-frames:v',
      '1',
      fr2,
    ]);
    // 2-frame animated gif at 2fps (each frame 0.5s), looping
    await exec(FFMPEG, [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      '2',
      '-i',
      join(dir, 'fr%d.png'),
      '-loop',
      '0',
      gif,
    ]);
  });

  it('composites an ANIMATED gif overlay (frame colors change over time)', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const overlay: OverlayClip = {
      id: 'g',
      kind: 'gif',
      src: gif,
      x: 0,
      y: 0,
      scale: 0.3,
      opacity: 1,
      startUs: 0,
      endUs: timeline.durationProgram,
      z: 0,
    };
    const edl = timelineToEdl(timeline, SAMPLE);
    await renderEdl(edl, OUT, { overlays: [overlay], frameW: 640, frameH: 360 });
    expect(existsSync(OUT)).toBe(true);

    const early = await regionRGB(OUT, '0.2', '40:40:10:10'); // gif frame 0 (red)
    const later = await regionRGB(OUT, '0.7', '40:40:10:10'); // gif frame 1 (blue)

    // composited (saturated, not navy background ~max 63)
    expect(sat(early)).toBeGreaterThan(150);
    expect(sat(later)).toBeGreaterThan(150);
    // animated: the two frames differ
    const diff = Math.abs(early[0] - later[0]) + Math.abs(early[2] - later[2]);
    expect(diff).toBeGreaterThan(120);
  });
});
