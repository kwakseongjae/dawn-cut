import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { extractAudio } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const EXPECTED = resolve(ROOT, 'fixtures/expected-transcript.json');
const WHISPER_BIN =
  process.env.DAWN_WHISPER_BIN ?? resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');

const hasWhisper = existsSync(WHISPER_BIN);

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
}

// whisper tests self-skip when the binary is unbuilt (verify.sh always runs the suite).
describe.skipIf(!hasWhisper)('G2 STT — whisper.cpp word timestamps (real binary)', () => {
  it('transcribes fixture: recall ≥ 0.90, monotonic (T-INV-2), sourceEnd>sourceStart (T-INV-3)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g2-'));
    const wav = join(dir, 'audio.wav');
    await extractAudio(SAMPLE, wav);

    const { words, language } = await transcribe(wav, { mediaId: 'fixture' });
    expect(words.length).toBeGreaterThan(5);

    // T-INV-3: every word has positive duration
    for (const w of words) expect(w.sourceEnd).toBeGreaterThan(w.sourceStart);

    // T-INV-2: timestamps non-decreasing in emission order
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.sourceStart).toBeGreaterThanOrEqual(words[i - 1]!.sourceStart);
    }

    // recall against known keywords
    const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as { keywords: string[] };
    const got = new Set(words.flatMap((w) => normalize(w.text)));
    const found = expected.keywords.filter((k) => got.has(k));
    const recall = found.length / expected.keywords.length;

    writeFileSync(
      resolve(ROOT, 'artifacts/g2-words.json'),
      JSON.stringify({ language, words }, null, 2),
    );
    writeFileSync(
      resolve(ROOT, 'artifacts/g2-recall.txt'),
      `recall=${recall.toFixed(3)} found=${found.length}/${expected.keywords.length}\n` +
        `matched: ${found.join(', ')}\n` +
        `missing: ${expected.keywords.filter((k) => !got.has(k)).join(', ')}\n`,
    );

    expect(recall).toBeGreaterThanOrEqual(0.9);
  });
});
