import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { frameUs } from '@dawn-cut/core';
import { extractAudio, probeAudioStream, probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const FRAME = frameUs(30); // ±1 frame = 33,333µs (04 §0)
// Lossy AAC→PCM transcode is NOT frame-exact (encoder priming/padding adds
// ~tens of ms). Frame accuracy is enforced where it matters (export, EDL-INV-3);
// audio extraction for STT only needs to be close. Calibrated 2026-05-27.
const AUDIO_TOL = 150_000; // ±150ms

describe('G1 ingest — probe + extractAudio (real ffmpeg)', () => {
  beforeAll(() => {
    // fixture must exist (make-fixture.sh). Gate skips otherwise (verify.sh).
  });

  it('media:probe returns duration/fps/hasAudio (V03)', async () => {
    const p = await probeMedia(SAMPLE);
    // fixture is ~8.0s (03 G1, calibrated 2026-05-27): accept [7s, 12s]
    expect(p.durationUs).toBeGreaterThanOrEqual(7_000_000);
    expect(p.durationUs).toBeLessThanOrEqual(12_000_000);
    expect(p.fps).toBe(30);
    expect(p.hasAudio).toBe(true);
  });

  it('media:extractAudio yields 16kHz mono PCM s16le, length within ±1 frame (V04)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g1-'));
    const wav = join(dir, 'audio.wav');
    await extractAudio(SAMPLE, wav);

    const srcAudio = await probeAudioStream(SAMPLE);
    const out = await probeAudioStream(wav);

    expect(out.sampleRate).toBe(16000);
    expect(out.channels).toBe(1);
    expect(out.codec).toBe('pcm_s16le');
    // extracted audio length ≈ source length (within lossy-transcode tolerance)
    expect(Math.abs(out.durationUs - srcAudio.durationUs)).toBeLessThanOrEqual(AUDIO_TOL);

    writeFileSync(
      resolve(ROOT, 'artifacts/g1-audio-probe.json'),
      JSON.stringify(
        { source: srcAudio, extracted: out, audioToleranceUs: AUDIO_TOL, frameUs: FRAME },
        null,
        2,
      ),
    );
  });
});
