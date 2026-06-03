import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';

// 한글(자모·완성형·확장)·한국어 문장부호 검출. 영어 보이스(Samantha 등)는 한글을 발음하지
// 못하고 거의 무음 파일을 내므로, 한글이 섞이면 한국어 보이스로 자동 전환한다.
const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힣]/;

export interface TtsResult {
  wavPath: string;
  engine: 'say' | 'piper';
  voice: string; // 실제로 사용한 보이스(자동 전환 결과 포함). piper면 'piper'.
}

export interface SayVoice {
  name: string; // 예: 'Yuna', 'Samantha', 'Eddy (한국어(대한민국))'
  lang: string; // BCP-ish 'ko_KR', 'en_US', …
}

/**
 * 설치된 macOS `say` 보이스 목록. (IPC `tts:voices`)
 * `say -v '?'` 출력은 컬럼 정렬돼 있어 이름과 lang 사이가 2칸 이상 공백이다.
 * 비-macOS/실패 시 빈 배열.
 */
export async function listVoices(): Promise<SayVoice[]> {
  try {
    const { stdout } = await exec('say', ['-v', '?']);
    return parseVoices(stdout);
  } catch {
    return [];
  }
}

export function parseVoices(stdout: string): SayVoice[] {
  const out: SayVoice[] = [];
  for (const line of stdout.split('\n')) {
    // "Yuna                ko_KR    # 안녕하세요. 제 이름은 유나입니다."
    const m = /^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\b/.exec(line);
    if (m?.[1] && m[2]) out.push({ name: m[1].trim(), lang: m[2] });
  }
  return out;
}

const isKo = (lang: string) => lang.toLowerCase().startsWith('ko');

/**
 * 텍스트와 요청 보이스, 설치 목록으로 실제 사용할 보이스를 고른다.
 * - 한글이 있고 요청 보이스가 한국어가 아니면 → 한국어 보이스로 전환(유나 우선).
 * - 요청 보이스가 설치돼 있지 않으면(예전 UI의 가짜 이름 Aria/Nova) → 기본값으로 보정
 *   (`say`는 미설치 이름에 에러 없이 시스템 기본 보이스로 조용히 폴백하던 버그를 막는다).
 * - 목록이 비면(비-macOS/테스트) 요청값 또는 'Samantha'.
 */
export function pickVoice(text: string, requested: string | undefined, voices: SayVoice[]): string {
  if (voices.length === 0) return requested ?? 'Samantha';
  const installed = requested ? voices.find((v) => v.name === requested) : undefined;
  const koWanted = HANGUL.test(text) && (!installed || !isKo(installed.lang));
  if (koWanted) {
    const ko =
      voices.find((v) => v.name === 'Yuna (Enhanced)') ??
      voices.find((v) => v.name === 'Yuna') ??
      voices.find((v) => isKo(v.lang));
    if (ko) return ko.name;
  }
  if (installed) return installed.name;
  return (voices.find((v) => v.name === 'Samantha') ?? voices[0])?.name ?? 'Samantha';
}

/**
 * Synthesize speech to a 16kHz mono wav. (IPC `tts:synthesize`)
 * Default engine = macOS `say` (offline, no install). If DAWN_PIPER_BIN and
 * DAWN_PIPER_MODEL are set, uses Piper (neural TTS) instead.
 * 한글 텍스트는 한국어 보이스로 자동 전환된다(영어 보이스 = 무음 방지).
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
    return { wavPath: outWav, engine: 'piper', voice: 'piper' };
  }

  // macOS `say` → aiff → 16kHz mono wav. 한글이면 한국어 보이스로 자동 보정.
  const voice = pickVoice(text, opts.voice, await listVoices());
  const dir = mkdtempSync(join(tmpdir(), 'dawn-tts-'));
  const aiff = join(dir, 'voice.aiff');
  await exec('say', ['-v', voice, '-o', aiff, text]);
  await exec(FFMPEG, ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '16000', '-ac', '1', outWav]);
  return { wavPath: outWav, engine: 'say', voice };
}
