import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { autoEnhanceParams, createInitialTimeline, timelineToEdl } from '@dawn-cut/core';
import { analyzeVideo, probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// 적응형 자동 보정 — 실 ffmpeg로 (1) signalstats 분석 → (2) autoEnhanceParams로 eq 계산 →
// (3) applyAutoEnhance와 동형의 eq 이펙트로 렌더 → 픽셀이 바뀌고 길이는 그대로인지 검증.
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const PLAIN = resolve(ROOT, 'artifacts/g31-plain.mp4');
const ENHANCED = resolve(ROOT, 'artifacts/g31-enhanced.mp4');

/** 1초 지점 프레임을 1×1로 평균낸 RGB 합(픽셀 변화 측정). */
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
  'G31 auto-enhance — analyze → eq → render (real ffmpeg)',
  () => {
    it('signalstats → autoEnhanceParams → 픽셀 변화 + 길이 불변', async () => {
      // (1) 실제 영상 분석 — 통계가 합리적 범위인지.
      const stats = await analyzeVideo(SAMPLE);
      expect(stats.yavg).toBeGreaterThanOrEqual(0);
      expect(stats.yavg).toBeLessThanOrEqual(255);
      // sample.mp4는 합성 평탄 프레임이라 ymin===ymax일 수 있다(>= 로 검증).
      expect(stats.ymax).toBeGreaterThanOrEqual(stats.ymin);

      // (2) 순수 매핑 — 항상 개선 방향(채도/대비 ≥ 1), 안전 범위.
      const eq = autoEnhanceParams(stats);
      expect(eq.saturation!).toBeGreaterThanOrEqual(1);
      expect(eq.contrast!).toBeGreaterThanOrEqual(1);

      // (3) applyAutoEnhance와 동일하게 eq 이펙트를 클립에 실어 렌더.
      const probe = await probeMedia(SAMPLE);
      const tl = createInitialTimeline('m', probe.durationUs, probe.fps || 30);
      const clipId = tl.tracks[0]!.clips[0]!;
      const enhanced = {
        ...tl,
        clips: {
          ...tl.clips,
          [clipId]: { ...tl.clips[clipId]!, effects: [{ kind: 'color', eq } as const] },
        },
      };

      await renderEdl(timelineToEdl(tl, SAMPLE), PLAIN, {});
      await renderEdl(timelineToEdl(enhanced, SAMPLE), ENHANCED, {});
      expect(existsSync(ENHANCED)).toBe(true);

      // 픽셀이 실제로 바뀐다(보정 적용 증거).
      const plain = await frameRgbSum(PLAIN);
      const enh = await frameRgbSum(ENHANCED);
      expect(Math.abs(enh - plain)).toBeGreaterThan(2);

      // 길이 불변(EDL-INV): 색보정은 프레임 수를 바꾸지 않는다.
      const pd = (await probeMedia(PLAIN)).durationUs;
      const ed = (await probeMedia(ENHANCED)).durationUs;
      expect(Math.abs(pd - ed)).toBeLessThan(100_000);
    }, 120_000);
  },
);
