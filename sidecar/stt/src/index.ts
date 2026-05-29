import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type WhisperNaturalJson, type Word, whisperNaturalToWords } from '@dawn-cut/core';

const exec = promisify(execFile);

const WHISPER_BIN = process.env.DAWN_WHISPER_BIN ?? 'vendor/whisper.cpp/build/bin/whisper-cli';
// 기본 = large-v3-turbo (Cycle-0 실측: base는 '무음→몸' 오인, turbo는 교정).
// 가벼운 셋업/저사양은 DAWN_WHISPER_MODEL_PATH로 ggml-base.bin 오버라이드.
const WHISPER_MODEL =
  process.env.DAWN_WHISPER_MODEL_PATH ?? 'vendor/whisper.cpp/models/ggml-large-v3-turbo.bin';

export interface TranscribeResult {
  language: string;
  words: Word[];
}

/**
 * Transcribe a 16kHz mono wav into eojeol-level (단어+조사) timestamps via whisper.cpp.
 *
 * Uses NATURAL segmentation (no `-ml`) + full JSON (`-ojf`), then merges the per-token
 * offsets in each segment's `tokens[]` on whisper's BPE leading-space boundary
 * (see packages/core/whisper.ts). `-ml 1` was REMOVED: for Korean it split single
 * syllables across byte boundaries, producing invalid-UTF-8 JSON and broken cues
 * (docs/poc/CYCLE0-STT-KOREAN-GATE.md). Natural mode is valid UTF-8 with the same
 * timestamp granularity already present in tokens[].
 *
 * Offsets are milliseconds → converted to integer µs by the core merge (04 §0).
 */
export async function transcribe(
  wavPath: string,
  opts: { mediaId: string; lang?: string } = { mediaId: 'fixture' },
): Promise<TranscribeResult> {
  const outDir = mkdtempSync(join(tmpdir(), 'dawn-stt-'));
  const outBase = join(outDir, 'out');

  const args = [
    '-m',
    WHISPER_MODEL,
    '-f',
    wavPath,
    '-oj',
    '-ojf', // full json: per-token text + offsets + p + id (the merge input)
    '-of',
    outBase,
    '-np', // no progress prints
  ];
  if (opts.lang) args.push('-l', opts.lang);

  await exec(WHISPER_BIN, args, { maxBuffer: 32 * 1024 * 1024 });

  const json = JSON.parse(await readFile(`${outBase}.json`, 'utf8')) as WhisperNaturalJson;
  const language = json.result?.language ?? opts.lang ?? 'auto';
  const words = whisperNaturalToWords(json, { mediaId: opts.mediaId });

  return { language, words };
}
