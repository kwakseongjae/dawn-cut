import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Word } from '@dawn-cut/core';

const exec = promisify(execFile);

const WHISPER_BIN = process.env.DAWN_WHISPER_BIN ?? 'vendor/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL =
  process.env.DAWN_WHISPER_MODEL_PATH ?? 'vendor/whisper.cpp/models/ggml-base.bin';

export interface TranscribeResult {
  language: string;
  words: Word[];
}

interface WhisperJson {
  result?: { language?: string };
  transcription?: Array<{
    text?: string;
    offsets?: { from?: number; to?: number }; // milliseconds
    tokens?: Array<{ p?: number }>;
  }>;
}

/** Keep meaningful word tokens; drop empties and pure punctuation. */
function isWordToken(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Transcribe a 16kHz mono wav into word-level timestamps via whisper.cpp.
 * Uses `-ml 1` (one token per segment) + full JSON for per-word offsets.
 * Offsets are milliseconds → converted to integer µs (04 §0).
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
    '-ml',
    '1',
    '-oj',
    '-ojf',
    '-of',
    outBase,
    '-np', // no progress prints
  ];
  if (opts.lang) args.push('-l', opts.lang);

  await exec(WHISPER_BIN, args, { maxBuffer: 32 * 1024 * 1024 });

  const json = JSON.parse(await readFile(`${outBase}.json`, 'utf8')) as WhisperJson;
  const language = json.result?.language ?? opts.lang ?? 'auto';

  const words: Word[] = [];
  for (const seg of json.transcription ?? []) {
    const text = (seg.text ?? '').trim();
    if (!isWordToken(text)) continue;
    const fromMs = seg.offsets?.from ?? 0;
    const toMs = seg.offsets?.to ?? fromMs;
    const sourceStart = fromMs * 1000;
    let sourceEnd = toMs * 1000;
    if (sourceEnd <= sourceStart) sourceEnd = sourceStart + 1000; // guard T-INV-3
    const probs = (seg.tokens ?? []).map((t) => t.p ?? 1).filter((p) => p > 0);
    const confidence = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 1;
    words.push({
      id: randomUUID(),
      text,
      sourceStart,
      sourceEnd,
      confidence: Math.min(1, Math.max(0, confidence)),
      mediaId: opts.mediaId,
    });
  }

  return { language, words };
}
