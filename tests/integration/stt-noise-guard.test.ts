import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assessSpeech } from '@dawn-cut/core';
import { extractAudio } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { describe, expect, it } from 'vitest';

// 잡음/무발화 가드(assessSpeech) — whisper 환각을 실제 잡음 오디오로 검증 (2026-06-11).
const exec = promisify(execFile);
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const WHISPER = process.env.DAWN_WHISPER_BIN ?? 'vendor/whisper.cpp/build/bin/whisper-cli';
const SAMPLE = resolve(process.cwd(), 'fixtures/sample.mp4');

describe.skipIf(!existsSync(WHISPER))('잡음 오디오 → 전사 환각 가드 (실제 whisper)', () => {
  it('핑크노이즈만 있는 영상은 speechLikely=false (환각 차단)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-noise-'));
    const noisy = join(dir, 'noise.mp4');
    // 6초 핑크노이즈 + 컬러바 — '오디오 트랙은 있지만 말소리는 없는' 영상 재현.
    await exec(FFMPEG, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=d=6:c=pink:a=0.4',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=d=6:s=320x240:r=30',
      '-shortest',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      noisy,
    ]);
    const { wavPath } = await extractAudio(noisy, join(dir, 'noise.wav'));
    const tr = await transcribe(wavPath, { mediaId: 'm' });
    const a = assessSpeech(tr.words, 6_000_000);
    // 묘사 토큰(*Rain*)·저밀도·저신뢰 중 무엇으로든 걸러져야 한다.
    expect(a.speechLikely).toBe(false);
  }, 180_000);

  it.skipIf(!existsSync(SAMPLE))(
    '실발화 픽스처는 speechLikely=true (오판 없음)',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'dawn-speech-'));
      const { wavPath } = await extractAudio(SAMPLE, join(dir, 's.wav'));
      const tr = await transcribe(wavPath, { mediaId: 'm' });
      const a = assessSpeech(tr.words, 8_000_000);
      expect(a.speechLikely).toBe(true);
      expect(a.medianConfidence).toBeGreaterThan(0.5);
    },
    180_000,
  );
});
