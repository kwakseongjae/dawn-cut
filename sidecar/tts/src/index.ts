import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';

export interface TtsResult {
  wavPath: string;
  engine: 'say' | 'piper';
}

/**
 * Synthesize speech to a 16kHz mono wav. (IPC `tts:synthesize`)
 * Default engine = macOS `say` (offline, no install). If DAWN_PIPER_BIN and
 * DAWN_PIPER_MODEL are set, uses Piper (neural TTS) instead.
 */
export async function synthesizeTts(
  text: string,
  outWav: string,
  opts: { voice?: string } = {},
): Promise<TtsResult> {
  const piperBin = process.env.DAWN_PIPER_BIN;
  const piperModel = process.env.DAWN_PIPER_MODEL;

  if (piperBin && piperModel) {
    // Piper reads text on stdin, writes a wav. (neural, cross-platform)
    await exec(piperBin, ['--model', piperModel, '--output_file', outWav], {
      input: text,
    } as never);
    return { wavPath: outWav, engine: 'piper' };
  }

  // macOS `say` → aiff → 16kHz mono wav
  const dir = mkdtempSync(join(tmpdir(), 'dawn-tts-'));
  const aiff = join(dir, 'voice.aiff');
  await exec('say', ['-v', opts.voice ?? 'Samantha', '-o', aiff, text]);
  await exec(FFMPEG, ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '16000', '-ac', '1', outWav]);
  return { wavPath: outWav, engine: 'say' };
}
