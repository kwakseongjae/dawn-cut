import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInitialTimeline, timelineToEdl } from '@dawn-cut/core';
import { probeMedia, renderAudioOnly, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// 내보내기 프리셋(issue #5) — 해상도/품질/오디오만을 실제 ffmpeg + ffprobe로 검증.
const SAMPLE = resolve(process.cwd(), 'fixtures/sample.mp4');

describe.skipIf(!existsSync(SAMPLE))(
  '내보내기 프리셋 (renderEdl outHeight/quality + 오디오만)',
  () => {
    it('outHeight=360 → 출력 세로 360px, 종횡비 유지(가로 짝수)', async () => {
      const probe = await probeMedia(SAMPLE);
      const dur = Math.min(probe.durationUs, 2_000_000);
      const edl = timelineToEdl(createInitialTimeline('m', dur, probe.fps || 30), SAMPLE);
      const dir = mkdtempSync(join(tmpdir(), 'dawn-preset-'));
      const out = join(dir, 'h360.mp4');
      await renderEdl(edl, out, { frameW: probe.width, frameH: probe.height, outHeight: 360 });
      const p = await probeMedia(out);
      expect(p.height).toBe(360);
      expect(p.width % 2).toBe(0);
      // 종횡비 ~유지(±2px 라운딩)
      expect(Math.abs(p.width / p.height - probe.width / probe.height)).toBeLessThan(0.02);
    }, 60_000);

    it("quality='small'(CRF 28)이 'high'(CRF 18)보다 파일이 작다", async () => {
      const probe = await probeMedia(SAMPLE);
      const dur = Math.min(probe.durationUs, 2_000_000);
      const edl = timelineToEdl(createInitialTimeline('m', dur, probe.fps || 30), SAMPLE);
      const dir = mkdtempSync(join(tmpdir(), 'dawn-quality-'));
      const small = join(dir, 'small.mp4');
      const high = join(dir, 'high.mp4');
      await renderEdl(edl, small, { quality: 'small' });
      await renderEdl(edl, high, { quality: 'high' });
      const { statSync } = await import('node:fs');
      expect(statSync(small).size).toBeLessThan(statSync(high).size);
    }, 90_000);

    it('오디오만(mp3/wav) — 길이가 EDL과 일치하고 비디오 스트림이 없다', async () => {
      const probe = await probeMedia(SAMPLE);
      const dur = Math.min(probe.durationUs, 2_000_000);
      const edl = timelineToEdl(createInitialTimeline('m', dur, probe.fps || 30), SAMPLE);
      const dir = mkdtempSync(join(tmpdir(), 'dawn-audio-'));
      for (const fmt of ['mp3', 'wav'] as const) {
        const out = join(dir, `a.${fmt}`);
        await renderAudioOnly(edl, out, fmt);
        expect(existsSync(out)).toBe(true);
        const p = await probeMedia(out);
        // 오디오 길이 ≈ EDL 길이(±150ms — AAC/mp3 priming 관용, 프로젝트 규약)
        expect(Math.abs(p.durationUs - dur)).toBeLessThan(150_000);
        expect(p.width || 0).toBe(0); // 비디오 스트림 없음
      }
    }, 60_000);
  },
);

describe.skipIf(!existsSync(SAMPLE))('무음 입력 내보내기 (inputHasAudio=false)', () => {
  it('오디오 스트림 없는 영상도 내보내기 성공 + 무음 트랙 포함', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const dir = mkdtempSync(join(tmpdir(), 'dawn-silent-'));
    const silent = join(dir, 'silent.mp4');
    await exec(process.env.DAWN_FFMPEG ?? 'ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=d=3:s=320x240:r=30',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      silent,
    ]);
    const probe = await probeMedia(silent);
    expect(probe.hasAudio).toBe(false);
    const edl = timelineToEdl(createInitialTimeline('m', probe.durationUs, 30), silent);
    const out = join(dir, 'out.mp4');
    await renderEdl(edl, out, { frameW: 320, frameH: 240, inputHasAudio: false });
    const p2 = await probeMedia(out);
    expect(p2.hasAudio).toBe(true); // 무음 트랙이 깔려 플레이어 호환
    expect(Math.abs(p2.durationUs - probe.durationUs)).toBeLessThan(150_000);
  }, 60_000);
});

describe.skipIf(!existsSync(SAMPLE))('출력 fps 옵션 (outFps)', () => {
  it('outFps=60/24가 산출물 fps에 정확히 반영된다', async () => {
    const probe = await probeMedia(SAMPLE);
    const dur = Math.min(probe.durationUs, 2_000_000);
    const edl = timelineToEdl(createInitialTimeline('m', dur, probe.fps || 30), SAMPLE);
    const dir = mkdtempSync(join(tmpdir(), 'dawn-fps-'));
    for (const fps of [60, 24]) {
      const out = join(dir, `f${fps}.mp4`);
      await renderEdl(edl, out, { outFps: fps });
      const p = await probeMedia(out);
      expect(Math.round(p.fps)).toBe(fps);
    }
  }, 90_000);
});
