import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInitialTimeline, removeSilences, timelineToEdl } from '@dawn-cut/core';
import { detectSilences, probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const OUT = resolve(ROOT, 'artifacts/g13-export.gif');

describe('G13 GIF export — CapCut-style quick share (real ffmpeg)', () => {
  it('renders an edited timeline to a valid animated GIF', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const t0 = createInitialTimeline('m1', durationUs, 30);
    const silences = await detectSilences(SAMPLE, { noiseDb: -30, minSilenceUs: 500_000 });
    const { after } = removeSilences(t0, 'm1', silences, 0);

    const edl = timelineToEdl(after, SAMPLE);
    await renderEdl(edl, OUT, { format: 'gif' });

    expect(existsSync(OUT)).toBe(true);
    expect(statSync(OUT).size).toBeGreaterThan(1000);
    // ffprobe recognizes it as a playable gif with non-zero duration
    const probed = await probeMedia(OUT);
    expect(probed.durationUs).toBeGreaterThan(0);
  });
});
