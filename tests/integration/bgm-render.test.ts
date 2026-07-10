import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInitialTimeline, timelineToEdl } from '@dawn-cut/core';
import { extractPeaks, probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// B7+B6 — BGM 믹스·덕킹 실렌더. 프로그램=무음 영상(anullsrc 경로)로 BGM/보이스만 격리 측정.
const SAMPLE = resolve(process.cwd(), 'fixtures/sample.mp4');
const VOICE = resolve(process.cwd(), 'fixtures/voice.wav');
const BGM = resolve(process.cwd(), 'assets/bgm/uplift-pop.m4a');
const FRAME_US = 33_334;

async function renderBgm(out: string, duck: boolean, withVoice: boolean) {
  const probe = await probeMedia(SAMPLE);
  const edl = timelineToEdl(createInitialTimeline('m', probe.durationUs, 30), SAMPLE);
  await renderEdl(edl, out, {
    inputHasAudio: false, // 프로그램 무음 — BGM/보이스만 남겨 측정 격리
    ...(withVoice ? { voicePath: VOICE, voiceStartUs: 0 } : {}),
    bgm: { path: BGM, startUs: 0, endUs: probe.durationUs, volume: 0.5, loop: true, duck },
  });
  return probe.durationUs;
}

/** 프로그램 구간 [aSec,bSec)의 평균 피크. */
function meanPeak(peaks: number[], aSec: number, bSec: number): number {
  const s = peaks.slice(Math.floor(aSec * 20), Math.ceil(bSec * 20));
  return s.reduce((x, y) => x + y, 0) / Math.max(1, s.length);
}

describe('B7 bgm render + B6 ducking', () => {
  it('무음 영상 + BGM → 출력에 음악 에너지, 길이 불변', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-b7-solo-'));
    const out = join(dir, 'bgm-only.mp4');
    const durUs = await renderBgm(out, false, false);
    const final = await probeMedia(out);
    expect(final.hasAudio).toBe(true);
    expect(Math.abs(final.durationUs - durUs)).toBeLessThanOrEqual(3 * FRAME_US);
    const peaks = await extractPeaks(out);
    expect(Math.max(...peaks)).toBeGreaterThan(0.15); // 음악이 실제로 들림
  }, 60_000);

  it('덕킹(B6): 보이스 발화 구간에서 duck=on이 duck=off보다 유의미하게 조용', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-b7-duck-'));
    const offOut = join(dir, 'duck-off.mp4');
    const onOut = join(dir, 'duck-on.mp4');
    await renderBgm(offOut, false, true);
    await renderBgm(onOut, true, true);
    const offPeaks = await extractPeaks(offOut);
    const onPeaks = await extractPeaks(onOut);
    // 발화 구간(0.5~3s — fixture voice.wav 첫 문장): on이 눈에 띄게 낮아야 한다.
    const off = meanPeak(offPeaks, 0.5, 3);
    const on = meanPeak(onPeaks, 0.5, 3);
    expect(on).toBeLessThan(off * 0.93);
    // 참고 로그(저널용): 압축비.
    // eslint 없음 — vitest 환경 콘솔 허용.
    console.log(
      `duck ratio: on=${on.toFixed(3)} off=${off.toFixed(3)} (${((on / off) * 100).toFixed(0)}%)`,
    );
  }, 90_000);
});
