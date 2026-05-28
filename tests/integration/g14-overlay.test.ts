import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInitialTimeline, timelineToEdl, validateOverlays } from '@dawn-cut/core';
import type { OverlayClip } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { beforeAll, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4'); // 640x360
const OUT = resolve(ROOT, 'artifacts/g14-overlay.mp4');

/** Average RGB of a cropped region of `video` at ~mid time, as [r,g,b]. */
async function regionRGB(video: string, crop: string): Promise<[number, number, number]> {
  const { stdout } = (await exec(
    FFMPEG,
    [
      '-y',
      '-ss',
      '1',
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

describe('G14 overlay compositing — pixel-verified (real ffmpeg)', () => {
  let red = '';
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g14-'));
    red = join(dir, 'red.png');
    await exec(FFMPEG, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=200x200',
      '-frames:v',
      '1',
      red,
    ]);
  });

  it('burns a red image overlay into the top-left of the output frame', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const overlay: OverlayClip = {
      id: 'ov',
      kind: 'image',
      src: red,
      x: 0,
      y: 0,
      scale: 0.3,
      opacity: 1,
      startUs: 0,
      endUs: timeline.durationProgram,
      z: 0,
    };
    expect(validateOverlays([overlay], timeline.durationProgram)).toEqual([]);

    const edl = timelineToEdl(timeline, SAMPLE);
    await renderEdl(edl, OUT, { overlays: [overlay], frameW: 640, frameH: 360 });
    expect(existsSync(OUT)).toBe(true);

    // top-left region must now be RED (overlay composited)
    const [r, g, b] = await regionRGB(OUT, '60:60:10:10');
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(100);
    expect(b).toBeLessThan(100);

    // bottom-right region must remain the navy source (control: not red)
    const [r2] = await regionRGB(OUT, '60:60:560:280');
    expect(r2).toBeLessThan(120);

    // overlay does not change duration (OVL-INV-3)
    const out = await probeMedia(OUT);
    expect(Math.abs(out.durationUs - edl.totalDuration)).toBeLessThanOrEqual(33_333);
  });
});
