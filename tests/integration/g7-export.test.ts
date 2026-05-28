import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createInitialTimeline,
  frameUs,
  removeSilences,
  timelineToEdl,
  validateEdl,
} from '@dawn-cut/core';
import { detectSilences, probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const FRAME = frameUs(30);
const OUT = resolve(ROOT, 'artifacts/g7-export.mp4');

describe('G7 export — EDL → FFmpeg render (real ffmpeg)', () => {
  it('renders MP4 whose length == EDL.totalDuration within tolerance (EDL-INV-3)', async () => {
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline0 = createInitialTimeline('m1', durationUs, 30);

    // produce a real cut so the EDL has multiple segments
    const silences = await detectSilences(SAMPLE, { noiseDb: -30, minSilenceUs: 500_000 });
    const { after } = removeSilences(timeline0, 'm1', silences, 0);

    const edl = timelineToEdl(after, SAMPLE);
    expect(validateEdl(edl, after)).toEqual([]);
    expect(edl.segments.length).toBeGreaterThanOrEqual(2);

    await renderEdl(edl, OUT);
    const rendered = await probeMedia(OUT);

    const diff = Math.abs(rendered.durationUs - edl.totalDuration);
    writeFileSync(
      resolve(ROOT, 'artifacts/g7-probe.json'),
      JSON.stringify(
        {
          edlTotalDuration: edl.totalDuration,
          renderedDurationUs: rendered.durationUs,
          diffUs: diff,
          frameUs: FRAME,
          segments: edl.segments.length,
        },
        null,
        2,
      ),
    );

    // EDL-INV-3: rendered length within ±1 frame of EDL.totalDuration.
    // (measured ~312µs ≪ 33,333µs — effectively frame-accurate.)
    expect(diff).toBeLessThanOrEqual(FRAME);
  });
});
