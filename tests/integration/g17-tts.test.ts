import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { synthesizeTts } from '@dawn-cut/sidecar-tts';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const hasWhisper = existsSync(WHISPER_BIN);

const norm = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

describe.skipIf(!hasWhisper)(
  'G17 TTS — synthesize then transcribe back (real say + whisper)',
  () => {
    it('produces audible speech whose words whisper can read back', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'dawn-g17-'));
      const wav = join(dir, 'voice.wav');
      const TEXT = 'the quick brown fox jumps over the lazy dog';

      const res = await synthesizeTts(TEXT, wav, { voice: 'Samantha' });
      expect(existsSync(res.wavPath)).toBe(true);

      const probe = await probeMedia(res.wavPath);
      expect(probe.hasAudio).toBe(true);
      expect(probe.durationUs).toBeGreaterThan(1_000_000); // > 1s of speech

      // round-trip: transcribe the synthesized voice and check word recall
      const { words } = await transcribe(res.wavPath, { mediaId: 'tts' });
      const got = new Set(words.flatMap((w) => norm(w.text)));
      const expected = ['quick', 'brown', 'fox', 'lazy', 'dog'];
      const found = expected.filter((k) => got.has(k));
      writeFileSync(
        resolve(ROOT, 'artifacts/g17-tts.txt'),
        `engine=${res.engine}\nfound ${found.length}/${expected.length}: ${found.join(', ')}\n`,
      );
      expect(found.length / expected.length).toBeGreaterThanOrEqual(0.6);
    });
  },
);
