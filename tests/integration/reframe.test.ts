import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInitialTimeline, timelineToEdl } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// 자동 리프레이밍: 가로 소스를 9:16/1:1로 중앙 크롭 렌더(쇼츠 세로). 미지정이면 원본 종횡비 보존.
const SAMPLE = resolve(process.cwd(), 'fixtures/sample.mp4');
const dir = () => mkdtempSync(join(tmpdir(), 'dawn-reframe-'));

describe.skipIf(!existsSync(SAMPLE))('renderEdl reframe (자동 리프레이밍)', () => {
  it('reframe 9:16 → 출력이 세로 9:16(±)', async () => {
    const probe = await probeMedia(SAMPLE);
    const edl = timelineToEdl(
      createInitialTimeline('m', Math.min(probe.durationUs, 2_000_000), probe.fps || 30),
      SAMPLE,
    );
    const out = join(dir(), 'v916.mp4');
    await renderEdl(edl, out, { frameW: probe.width, frameH: probe.height, reframe: '9:16' });
    const r = await probeMedia(out);
    expect(r.width / r.height).toBeCloseTo(9 / 16, 1); // ≈0.5625
    expect(r.width).toBeLessThan(probe.width); // 가로가 깎였다
  }, 60_000);

  it('reframe 1:1 → 출력이 정사각(±)', async () => {
    const probe = await probeMedia(SAMPLE);
    const edl = timelineToEdl(
      createInitialTimeline('m', Math.min(probe.durationUs, 2_000_000), probe.fps || 30),
      SAMPLE,
    );
    const out = join(dir(), 'v11.mp4');
    await renderEdl(edl, out, { frameW: probe.width, frameH: probe.height, reframe: '1:1' });
    const r = await probeMedia(out);
    expect(r.width / r.height).toBeCloseTo(1, 1);
  }, 60_000);

  it('reframe 미지정 → 원본 종횡비 보존(크롭 없음)', async () => {
    const probe = await probeMedia(SAMPLE);
    const edl = timelineToEdl(
      createInitialTimeline('m', Math.min(probe.durationUs, 2_000_000), probe.fps || 30),
      SAMPLE,
    );
    const out = join(dir(), 'vsrc.mp4');
    await renderEdl(edl, out, { frameW: probe.width, frameH: probe.height });
    const r = await probeMedia(out);
    expect(r.width).toBe(probe.width);
    expect(r.height).toBe(probe.height);
  }, 60_000);
});
