import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInitialTimeline, frameUs, removeSilences, validateTimeline } from '@dawn-cut/core';
import { detectSilences, probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const EXPECTED = resolve(ROOT, 'fixtures/expected-transcript.json');
const FRAME = frameUs(30);

interface Iv {
  start: number;
  end: number;
}
function iou(a: Iv, b: Iv): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const uni = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return uni > 0 ? inter / uni : 0;
}

describe('G5 silence — detect + removeSilences (real ffmpeg)', () => {
  it('detects inserted silences (IoU ≥ 0.8) and removeSilences conserves duration', async () => {
    const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as {
      silences: { startUs: number; endUs: number }[];
    };
    const expIv: Iv[] = expected.silences.map((s) => ({ start: s.startUs, end: s.endUs }));

    const detected = await detectSilences(SAMPLE, { noiseDb: -30, minSilenceUs: 500_000 });

    // each expected silence must be matched by a detected one with IoU ≥ 0.8
    for (const e of expIv) {
      const best = Math.max(0, ...detected.map((d) => iou(e, d)));
      expect(best).toBeGreaterThanOrEqual(0.8);
    }

    // removeSilences on the initial timeline (pad 0)
    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const res = removeSilences(timeline, 'm1', detected, 0);

    expect(validateTimeline(res.after)).toEqual([]);
    expect(res.after.durationProgram).toBe(res.before.durationProgram - res.removedProgramUs);

    // removed ≈ Σ detected durations (within snapping tolerance: ±1 frame per cut)
    const sumDetected = detected.reduce((acc, d) => acc + (d.end - d.start), 0);
    expect(Math.abs(res.removedProgramUs - sumDetected)).toBeLessThanOrEqual(
      (detected.length + 1) * FRAME,
    );

    writeFileSync(
      resolve(ROOT, 'artifacts/g5-silence.json'),
      JSON.stringify(
        {
          expected: expIv,
          detected,
          removedProgramUs: res.removedProgramUs,
          sumDetected,
          frameUs: FRAME,
        },
        null,
        2,
      ),
    );
  });
});
