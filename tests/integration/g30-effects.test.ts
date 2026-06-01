import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInitialTimeline, timelineToEdl } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// P2-B: 클립 effects(색보정)가 renderEdl filter_complex에 실제로 적용되는지 픽셀로 검증.
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const PLAIN = resolve(ROOT, 'artifacts/g30-plain.mp4');
const GRADED = resolve(ROOT, 'artifacts/g30-graded.mp4');

/** 1초 지점 프레임을 1×1로 평균낸 RGB 합. */
async function frameRgbSum(video: string): Promise<number> {
  const { stdout } = (await exec(
    'ffmpeg',
    [
      '-y',
      '-ss',
      '1',
      '-i',
      video,
      '-vf',
      'scale=1:1',
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
  return (stdout[0] ?? 0) + (stdout[1] ?? 0) + (stdout[2] ?? 0);
}

describe.skipIf(!existsSync(SAMPLE))(
  'G30 effects — colorgrade applied in renderEdl (real ffmpeg)',
  () => {
    it('warm 색보정이 출력 프레임 픽셀을 바꾼다 (effects 없으면 회귀 0)', async () => {
      const probe = await probeMedia(SAMPLE);
      const tl = createInitialTimeline('m', probe.durationUs, probe.fps || 30);
      const clipId = tl.tracks[0]!.clips[0]!;
      const graded = {
        ...tl,
        clips: {
          ...tl.clips,
          [clipId]: { ...tl.clips[clipId]!, effects: [{ kind: 'color', preset: 'warm' } as const] },
        },
      };

      await renderEdl(timelineToEdl(tl, SAMPLE), PLAIN, {});
      await renderEdl(timelineToEdl(graded, SAMPLE), GRADED, {});
      expect(existsSync(PLAIN)).toBe(true);
      expect(existsSync(GRADED)).toBe(true);

      const plain = await frameRgbSum(PLAIN);
      const gradedSum = await frameRgbSum(GRADED);
      // warm은 미드톤 블루를 낮춘다 → navy 배경의 RGB 합이 눈에 띄게 달라져야 한다.
      expect(Math.abs(gradedSum - plain)).toBeGreaterThan(8);

      // 길이 불변(EDL-INV): 색보정은 프레임 수를 바꾸지 않는다.
      const pd = (await probeMedia(PLAIN)).durationUs;
      const gd = (await probeMedia(GRADED)).durationUs;
      expect(Math.abs(pd - gd)).toBeLessThan(100_000); // <0.1s
    });
  },
);
