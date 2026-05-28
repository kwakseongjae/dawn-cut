import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInitialTimeline, drawSubtitle, timelineToEdl } from '@dawn-cut/core';
import type { DrawCtx, OverlayClip } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');

function diffPixelCount(a: Buffer, b: Buffer): number {
  let n = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i + 2 < len; i += 3) {
    const d =
      Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
    if (d > 30) n++;
  }
  return n;
}

async function regionRawRGB(video: string, atSec: string, crop: string): Promise<Buffer> {
  const [w, h] = crop.split(':').map(Number);
  const { stdout } = (await exec(
    FFMPEG,
    [
      '-y',
      '-ss',
      atSec,
      '-i',
      video,
      '-vf',
      `crop=${crop}`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: w! * h! * 3 + 1024 },
  )) as unknown as { stdout: Buffer };
  return stdout;
}

describe('G29 CJK subtitle — Korean text actually renders to pixels', () => {
  it('Korean text produces a band of non-background pixels', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g29-'));
    const png = join(dir, 'kr.png');
    const c = createCanvas(1000, 150);
    const ctx = c.getContext('2d') as unknown as DrawCtx;
    drawSubtitle(ctx, 1000, 150, '안녕하세요 자막 테스트', {
      color: '#ffffff',
      bg: 'transparent',
      stroke: '',
    });
    writeFileSync(png, c.toBuffer('image/png'));

    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const overlays: OverlayClip[] = [
      {
        id: 'sub',
        kind: 'subtitle',
        src: png,
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
    const withSub = resolve(ROOT, 'artifacts/g29-cjk-with.mp4');
    const noSub = resolve(ROOT, 'artifacts/g29-cjk-no.mp4');
    await renderEdl(edl, withSub, { overlays, frameW: 640, frameH: 360 });
    await renderEdl(edl, noSub, { overlays: [], frameW: 640, frameH: 360 });

    // Pixel-diff the subtitle band between (with) and (without) Korean overlay.
    // If the font failed to emit any glyphs, both renders produce identical
    // pixels in the band; if Korean glyphs landed, this diff is substantial.
    const [withBand, noBand] = await Promise.all([
      regionRawRGB(withSub, '0.5', '460:40:90:310'),
      regionRawRGB(noSub, '0.5', '460:40:90:310'),
    ]);
    const diff = diffPixelCount(withBand, noBand);
    expect(diff).toBeGreaterThan(200);
  });
});
