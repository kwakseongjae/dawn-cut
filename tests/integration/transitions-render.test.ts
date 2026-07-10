import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyCommand,
  buildTranscriptModel,
  createInitialTimeline,
  splitClipAt,
  timelineToEdl,
} from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// B4 — 전환 실렌더: ①길이 완전 불변(±1frame) ②dip 경계 프레임 near-black 픽셀 검증.
// fixture는 남색 단색이라 crossfade는 픽셀 차등이 없다(길이·성공만 단언).
const SAMPLE = resolve(process.cwd(), 'fixtures/sample.mp4');
const FRAME_US = 33_334;

async function renderWith(kind: 'crossfade' | 'dipToBlack' | null, out: string) {
  const probe = await probeMedia(SAMPLE);
  const t0 = createInitialTimeline('m', probe.durationUs, 30);
  let timeline = splitClipAt(t0, Math.round(probe.durationUs / 2));
  if (kind) {
    const { after } = applyCommand(
      { timeline, transcript: buildTranscriptModel([], 'm', 'und') },
      { type: 'addTransition', kind, durationUs: 600_000 },
    );
    timeline = after.timeline;
  }
  const edl = timelineToEdl(timeline, SAMPLE);
  await renderEdl(edl, out, {});
  return { edl, boundaryUs: Math.round(probe.durationUs / 2), srcDurUs: probe.durationUs };
}

/** 특정 시각 프레임의 평균 휘도(YAVG) — signalstats 1프레임 샘플(stderr로 출력됨). */
function yavgAt(path: string, atSec: number): number {
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-ss',
      String(atSec),
      '-i',
      path,
      '-frames:v',
      '1',
      '-vf',
      'signalstats,metadata=print',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  const m = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(r.stderr ?? '');
  return m ? Number(m[1]) : Number.NaN;
}

describe('B4 transitions render — 길이 불변 + dip 픽셀', () => {
  it('crossfade: 출력 길이 == 전환 없음 ±1frame (핸들 오버랩 정산)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-b4-xf-'));
    const plain = join(dir, 'plain.mp4');
    const xf = join(dir, 'xfade.mp4');
    const { srcDurUs } = await renderWith(null, plain);
    await renderWith('crossfade', xf);
    const p = await probeMedia(plain);
    const x = await probeMedia(xf);
    expect(Math.abs(x.durationUs - p.durationUs)).toBeLessThanOrEqual(2 * FRAME_US);
    expect(Math.abs(x.durationUs - srcDurUs)).toBeLessThanOrEqual(2 * FRAME_US);
  }, 60_000);

  it('dipToBlack: 길이 불변 + 경계 프레임이 어둡다(YAVG 급감)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-b4-dip-'));
    const dip = join(dir, 'dip.mp4');
    const { boundaryUs } = await renderWith('dipToBlack', dip);
    const probe = await probeMedia(dip);
    expect(Math.abs(probe.durationUs - 8_000_000)).toBeLessThanOrEqual(4 * FRAME_US);
    const atBoundary = yavgAt(dip, boundaryUs / 1e6 - 0.02); // 경계 직전(페이드아웃 최저점)
    const midClip = yavgAt(dip, 1.0); // 평상시(남색)
    expect(midClip).toBeGreaterThan(20); // 남색 배경 휘도(실측 ~29)
    // limited-range 비디오의 블랙 = Y16 — 경계 최저점은 블랙 바닥 근처여야 한다.
    expect(atBoundary).toBeLessThanOrEqual(18);
    expect(midClip - atBoundary).toBeGreaterThanOrEqual(8);
  }, 60_000);
});
