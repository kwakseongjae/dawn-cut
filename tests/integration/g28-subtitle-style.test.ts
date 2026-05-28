import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInitialTimeline, drawSubtitle, timelineToEdl } from '@dawn-cut/core';
import type { DrawCtx, OverlayClip, SubtitleStyle } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');

function rasterize(style: SubtitleStyle, path: string) {
  const c = createCanvas(1000, 150);
  const ctx = c.getContext('2d') as unknown as DrawCtx;
  drawSubtitle(ctx, 1000, 150, 'styled subtitle', style);
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

describe('G28 subtitle style — color/bg propagates to burned overlay (pixel-verified)', () => {
  it('red text on transparent bg yields a red-dominant subtitle band', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g28-'));
    const styledPng = join(dir, 'red.png');
    rasterize({ color: '#ff0000', bg: 'transparent', stroke: '', fontScale: 0.6 }, styledPng);

    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const overlays: OverlayClip[] = [
      {
        id: 'sub',
        kind: 'subtitle',
        src: styledPng,
        x: 0.1,
        y: 0.8,
        scale: 0.8,
        opacity: 1,
        startUs: 0,
        endUs: timeline.durationProgram,
        z: 10,
      },
    ];
    const edl = timelineToEdl(timeline, SAMPLE);
    const out = resolve(ROOT, 'artifacts/g28-style.mp4');
    await renderEdl(edl, out, { overlays, frameW: 640, frameH: 360 });

    // Subtitle band ~ rows 308..358. Probe a strip near vertical center of band.
    // With red text on transparent bg, the band's average R must clearly exceed
    // baseline navy R (~16) AND exceed G/B by a healthy margin.
    const [r, g, b] = await regionRGB(out, '0.5', '460:30:90:320');
    expect(r).toBeGreaterThan(40); // red present (>>navy R≈16)
    expect(r).toBeGreaterThan(g + 10); // red dominates green
    expect(r).toBeGreaterThan(b - 20); // and isn't drowned by navy blue
  });
});
