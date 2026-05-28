import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInitialTimeline, drawSubtitle, timelineToEdl } from '@dawn-cut/core';
import type { DrawCtx, OverlayClip } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { createCanvas } from '@napi-rs/canvas';
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

describe('G27 subtitle position — anchor moves the burned band (pixel-verified)', () => {
  let subPng = '';
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g27-'));
    subPng = join(dir, 'subtitle.png');
    const c = createCanvas(1000, 150);
    const ctx = c.getContext('2d') as unknown as DrawCtx;
    drawSubtitle(ctx, 1000, 150, 'top vs bottom');
    writeFileSync(subPng, c.toBuffer('image/png'));
  });

  it('changing y from bottom to top moves the dark subtitle band', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const make = (y: number): OverlayClip[] => [
      {
        id: 'sub',
        kind: 'subtitle',
        src: subPng,
        x: 0.1,
        y,
        scale: 0.8,
        opacity: 1,
        startUs: 0,
        endUs: timeline.durationProgram,
        z: 10,
      },
    ];
    const edl = timelineToEdl(timeline, SAMPLE);
    const outBottom = resolve(ROOT, 'artifacts/g27-sub-bottom.mp4');
    const outTop = resolve(ROOT, 'artifacts/g27-sub-top.mp4');
    await renderEdl(edl, outBottom, { overlays: make(0.8), frameW: 640, frameH: 360 });
    await renderEdl(edl, outTop, { overlays: make(0.02), frameW: 640, frameH: 360 });

    // Probe the SAME region in both renders. If subtitle moves, that region's
    // pixels must differ in the render where the band is over it vs not.
    // Top band region (y≈40) is hit by y=0.02 render but not y=0.8 render.
    const topRegion = '460:30:90:40';
    // Bottom band region (y≈320) is hit by y=0.8 render but not y=0.02 render.
    const bottomRegion = '460:30:90:320';
    const dist = (a: [number, number, number], b: [number, number, number]) =>
      Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

    const [topInTop, topInBot, botInTop, botInBot] = await Promise.all([
      regionRGB(outTop, '0.5', topRegion),
      regionRGB(outBottom, '0.5', topRegion),
      regionRGB(outTop, '0.5', bottomRegion),
      regionRGB(outBottom, '0.5', bottomRegion),
    ]);

    // Top region must differ significantly between the two y positions.
    expect(dist(topInTop, topInBot)).toBeGreaterThan(30);
    // Bottom region likewise.
    expect(dist(botInTop, botInBot)).toBeGreaterThan(30);
  });
});
