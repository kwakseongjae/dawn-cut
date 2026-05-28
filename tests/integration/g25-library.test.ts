import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInitialTimeline, timelineToEdl } from '@dawn-cut/core';
import type { OverlayClip } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { availableProviders, fetchAsset, searchLibrary } from '@dawn-cut/sidecar-library';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const OUT = resolve(ROOT, 'artifacts/g25-library.mp4');

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

describe('G25 asset library — bundle provider returns assets and they composite', () => {
  it('bundle is always available; searching + fetching + compositing all work', async () => {
    const providers = availableProviders();
    expect(providers).toContain('bundle');

    // browse (empty query → all bundle items)
    const all = await searchLibrary('bundle', '', 50);
    expect(all.length).toBeGreaterThan(0);
    // search by filename keyword
    const filtered = await searchLibrary('bundle', 'mandelbrot', 10);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered[0]!.kind).toBe('gif');

    // fetch resolves to a real file
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g25-'));
    const { path } = await fetchAsset(filtered[0]!, dir);
    expect(existsSync(path)).toBe(true);

    // composite the fetched asset over the sample and pixel-check the region is non-navy
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const overlay: OverlayClip = {
      id: 'lib',
      kind: 'gif',
      src: path,
      x: 0.1,
      y: 0.1,
      scale: 0.4,
      opacity: 1,
      startUs: 0,
      endUs: timeline.durationProgram,
      z: 0,
    };
    const edl = timelineToEdl(timeline, SAMPLE);
    await renderEdl(edl, OUT, { overlays: [overlay], frameW: 640, frameH: 360 });
    expect(existsSync(OUT)).toBe(true);

    // overlay covers x∈[64,320], y∈[36,180]. center crop should NOT be plain navy.
    const [r, g, b] = await regionRGB(OUT, '1.0', '80:80:120:60');
    const sum = r + g + b;
    expect(sum).toBeGreaterThan(80); // pure navy sums ~114 but mandelbrot has bright variance; assert non-uniform navy
    // and the region differs notably from navy on at least one channel
    const maxDelta = Math.max(Math.abs(r - 16), Math.abs(g - 35), Math.abs(b - 63));
    expect(maxDelta).toBeGreaterThan(40);
  });
});
