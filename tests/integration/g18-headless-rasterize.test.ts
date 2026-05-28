import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInitialTimeline, drawEmoji, drawSubtitle, timelineToEdl } from '@dawn-cut/core';
import type { DrawCtx, OverlayClip } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { createCanvas } from '@napi-rs/canvas';
import { beforeAll, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const OUT = resolve(ROOT, 'artifacts/g18-headless.mp4');

/** Rasterize via @napi-rs/canvas using the SAME core draw primitive as the renderer. */
function rasterize(
  w: number,
  h: number,
  draw: (ctx: DrawCtx, w: number, h: number) => void,
  path: string,
) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d') as unknown as DrawCtx;
  draw(ctx, w, h);
  writeFileSync(path, c.toBuffer('image/png'));
}

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

describe('G18 headless rasterization → ffmpeg overlay (pixel-verified)', () => {
  let subPng = '';
  let emojiPng = '';
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g18-'));
    subPng = join(dir, 'subtitle.png');
    emojiPng = join(dir, 'emoji.png');
    rasterize(
      1000,
      150,
      (ctx, w, h) => drawSubtitle(ctx, w, h, 'dawn cut composites for real'),
      subPng,
    );
    rasterize(256, 256, (ctx, w, h) => drawEmoji(ctx, w, h, '🔥'), emojiPng);
  });

  it('headless-rasterized subtitle + emoji compose into the exported frame', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const overlays: OverlayClip[] = [
      {
        id: 'sub',
        kind: 'subtitle',
        src: subPng,
        x: 0.1,
        y: 0.8,
        scale: 0.8,
        opacity: 1,
        startUs: 0,
        endUs: timeline.durationProgram,
        z: 10,
      },
      {
        id: 'fire',
        kind: 'sticker',
        src: emojiPng,
        x: 0.05,
        y: 0.05,
        scale: 0.2,
        opacity: 1,
        startUs: 0,
        endUs: timeline.durationProgram,
        z: 20,
      },
    ];
    const edl = timelineToEdl(timeline, SAMPLE);
    await renderEdl(edl, OUT, { overlays, frameW: 640, frameH: 360 });
    expect(existsSync(OUT)).toBe(true);

    // subtitle band must darken/differ from navy (sample bg is navy ~r16 g35 b63)
    const sub = await regionRGB(OUT, '0.5', '460:34:90:300');
    const subBrightness = sub[0] + sub[1] + sub[2];
    expect(subBrightness).toBeLessThan(90); // bar darkens the region; navy alone sums ~114

    // emoji bounding box at (32,18) size 128×128 (scale 0.2 of 640).
    // navy alone averages R≈16; the rasterized flame must push R far above that.
    const fire = await regionRGB(OUT, '0.5', '128:128:32:18');
    expect(fire[0]).toBeGreaterThan(50); // flame red present (>>navy R≈16)
    expect(fire[0] + fire[1]).toBeGreaterThan(100); // red+yellow energy clearly non-navy
  });
});
