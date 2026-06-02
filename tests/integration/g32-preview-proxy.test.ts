import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { makePreviewProxy, probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// 미리보기 프록시 — 원본을 '확실히 재생되는' 작은 H.264로 재인코딩(실 ffmpeg). 미리보기 검정 화면
// (고레벨/초고해상도/비-web 코덱)을 우회한다. 편집·내보내기는 원본 그대로(프록시는 미리보기 전용).
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const OUT = resolve(ROOT, 'artifacts/g32-proxy.mp4');

describe.skipIf(!existsSync(SAMPLE))(
  'G32 preview proxy — small standard H.264 (real ffmpeg)',
  () => {
    it('probe는 코덱/레벨을 보고하고, 프록시는 ≤1280 H.264(main)로 길이 보존', async () => {
      const probe = await probeMedia(SAMPLE);
      expect(probe.vcodec).toBeTruthy(); // 코덱 노출(미리보기 가능 판단용)
      expect(typeof probe.level).toBe('number');

      await makePreviewProxy(SAMPLE, OUT, 1280);
      expect(existsSync(OUT)).toBe(true);

      // 프록시 메타 검증: H.264, 긴 변 ≤ 1280, 짝수 치수, 길이 ≈ 원본.
      const { stdout } = await exec('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height',
        '-of',
        'csv=p=0',
        OUT,
      ]);
      const [codec, w, h] = stdout.trim().split(',');
      expect(codec).toBe('h264');
      expect(Math.max(Number(w), Number(h))).toBeLessThanOrEqual(1280);
      expect(Number(w) % 2).toBe(0);
      expect(Number(h) % 2).toBe(0);

      const pd = (await probeMedia(OUT)).durationUs;
      expect(Math.abs(pd - probe.durationUs)).toBeLessThan(300_000); // 길이 보존(±0.3s)
    }, 120_000);
  },
);
