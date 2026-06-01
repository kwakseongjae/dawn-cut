import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { buildOverlayFilter, effectFilter } from '@dawn-cut/core';
import type { Edl, OverlayClip } from '@dawn-cut/core';

const exec = promisify(execFile);

const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.DAWN_FFPROBE ?? 'ffprobe';

export interface ProbeResult {
  durationUs: number;
  fps: number;
  hasAudio: boolean;
  width: number;
  height: number;
}

/** ffprobe → duration (µs), video fps, frame size, audio presence. (IPC `media:probe`) */
export async function probeMedia(path: string): Promise<ProbeResult> {
  const { stdout } = await exec(FFPROBE, [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,r_frame_rate,width,height',
    '-of',
    'json',
    path,
  ]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      r_frame_rate?: string;
      width?: number;
      height?: number;
    }>;
  };

  const durationUs = Math.round(Number(data.format?.duration ?? 0) * 1_000_000);
  const streams = data.streams ?? [];
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  const video = streams.find((s) => s.codec_type === 'video');
  const fps = parseFps(video?.r_frame_rate);

  return {
    durationUs,
    fps,
    hasAudio,
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
  };
}

function parseFps(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den) return 0;
  return Math.round((num / den) * 1000) / 1000;
}

/**
 * Extract audio as 16kHz mono PCM s16le wav for whisper. (IPC `media:extractAudio`)
 * FFmpeg runs as a subprocess — no linking, no --enable-gpl (LGPL preserved).
 */
export async function extractAudio(
  inputPath: string,
  outWavPath: string,
): Promise<{ wavPath: string }> {
  await exec(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-vn',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    outWavPath,
  ]);
  return { wavPath: outWavPath };
}

const sec = (us: number): string => (us / 1_000_000).toFixed(6);

/** Write an SRT document to disk. (IPC `subtitle:write`) */
export async function writeSrt(path: string, content: string): Promise<{ path: string }> {
  await writeFile(path, content, 'utf8');
  return { path };
}

/**
 * Render an EDL to an MP4 by trimming + concatenating source segments via a
 * single filter_complex graph (frame-accurate, single source for PoC).
 * When `subtitlesPath` is given, muxes the SRT as a soft subtitle track
 * (mov_text) — non-destructive, toggleable, no libass dependency.
 * (IPC `export:render`) FFmpeg runs as a subprocess; LGPL preserved.
 */
export type ExportFormat = 'mp4' | 'gif';

export interface RenderOpts {
  subtitlesPath?: string;
  format?: ExportFormat;
  overlays?: OverlayClip[];
  frameW?: number;
  frameH?: number;
  voicePath?: string; // extra audio (TTS voiceover) mixed over the program audio
  voiceStartUs?: number; // program offset for the voiceover
}

export async function renderEdl(
  edl: Edl,
  outPath: string,
  opts: RenderOpts = {},
): Promise<{ outPath: string }> {
  if (edl.segments.length === 0) throw new Error('renderEdl: empty EDL');
  const input = edl.segments[0]!.mediaPath;
  const format = opts.format ?? 'mp4';
  const overlays = opts.overlays ?? [];

  const vparts: string[] = [];
  const aparts: string[] = [];
  const vlabels: string[] = [];
  const alabels: string[] = [];
  edl.segments.forEach((s, i) => {
    const a = sec(s.sourceStart);
    const b = sec(s.sourceEnd);
    // 클립 이펙트(펀치인 줌·색보정)를 trim→setpts 직후 체인에 삽입(라벨 없는 본문만 core가 생성).
    // setpts로 세그먼트 t가 0부터라 zoom의 on/t 기준이 세그먼트-로컬이라 안전. 이펙트 없으면 바이트동일.
    const eff = (s.effects ?? []).map((e) => effectFilter(e, edl.fps)).filter(Boolean);
    const effChain = eff.length > 0 ? `,${eff.join(',')}` : '';
    vparts.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS${effChain}[v${i}]`);
    aparts.push(`[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${i}]`);
    vlabels.push(`[v${i}]`);
    alabels.push(`[a${i}]`);
  });
  const n = edl.segments.length;

  // overlays are appended as inputs 1..N (before any subtitle input)
  const ovf =
    overlays.length > 0
      ? buildOverlayFilter('vbase', overlays, opts.frameW ?? 1280, opts.frameH ?? 720, 1)
      : { inputs: [] as string[], filter: '', out: '[vbase]' };

  // animated GIFs need -ignore_loop 0 so they loop for the whole clip
  const pushOverlayInputs = (arr: string[]) => {
    for (const ip of ovf.inputs) {
      if (/\.gif$/i.test(ip)) arr.push('-ignore_loop', '0');
      arr.push('-i', ip);
    }
  };

  if (format === 'gif') {
    const vconcat = `${vparts.join(';')};${vlabels.join('')}concat=n=${n}:v=1:a=0[vbase]`;
    const composed = ovf.filter ? `${vconcat};${ovf.filter}` : vconcat;
    const vin = ovf.filter ? ovf.out.slice(1, -1) : 'vbase';
    const filter = `${composed};[${vin}]fps=12,scale=540:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse[v]`;
    const gargs = ['-y', '-loglevel', 'error', '-i', input];
    pushOverlayInputs(gargs);
    gargs.push('-filter_complex', filter, '-map', '[v]', '-loop', '0', outPath);
    await exec(FFMPEG, gargs, { maxBuffer: 64 * 1024 * 1024 });
    return { outPath };
  }

  const interleaved = edl.segments.map((_, i) => `${vlabels[i]}${alabels[i]}`).join('');
  const concat = `${vparts.join(';')};${aparts.join(';')};${interleaved}concat=n=${n}:v=1:a=1[vbase][a]`;
  let filter = ovf.filter ? `${concat};${ovf.filter}` : concat;
  const videoLabel = ovf.out; // '[vbase]' when no overlays, else '[voN]'

  const args = ['-y', '-loglevel', 'error', '-i', input];
  pushOverlayInputs(args);
  const subIdx = 1 + ovf.inputs.length;
  if (opts.subtitlesPath) args.push('-i', opts.subtitlesPath);
  // voiceover input comes after subtitle
  const voiceIdx = subIdx + (opts.subtitlesPath ? 1 : 0);
  let audioLabel = '[a]';
  if (opts.voicePath) {
    args.push('-i', opts.voicePath);
    const delayMs = Math.round((opts.voiceStartUs ?? 0) / 1000);
    filter += `;[${voiceIdx}:a]adelay=${delayMs}:all=1[vdelay];[a][vdelay]amix=inputs=2:duration=first:dropout_transition=0[aout]`;
    audioLabel = '[aout]';
  }
  args.push('-filter_complex', filter, '-map', videoLabel, '-map', audioLabel);
  if (opts.subtitlesPath) args.push('-map', `${subIdx}:0`, '-c:s', 'mov_text');
  // a looping GIF overlay is an infinite input → bound output to the finite base.
  // (only when a GIF overlay is present, so a short subtitle track can't trim the video.)
  if (ovf.inputs.some((p) => /\.gif$/i.test(p))) args.push('-shortest');
  args.push('-r', String(edl.fps), '-pix_fmt', 'yuv420p', outPath);

  await exec(FFMPEG, args, { maxBuffer: 32 * 1024 * 1024 });
  return { outPath };
}

/** True if the file contains at least one subtitle stream (ffprobe). */
export async function hasSubtitleStream(path: string): Promise<boolean> {
  const { stdout } = await exec(FFPROBE, [
    '-v',
    'error',
    '-select_streams',
    's',
    '-show_entries',
    'stream=index',
    '-of',
    'csv=p=0',
    path,
  ]);
  return stdout.trim().length > 0;
}

export interface SilenceInterval {
  start: number; // µs
  end: number; // µs
}

/**
 * Detect silent intervals via the FFmpeg `silencedetect` filter. (IPC `analyze:silence`)
 * noiseDb e.g. -30 (dBFS threshold), minSilenceUs minimum silence to report.
 */
export async function detectSilences(
  path: string,
  opts: { noiseDb?: number; minSilenceUs?: number } = {},
): Promise<SilenceInterval[]> {
  const noiseDb = opts.noiseDb ?? -30;
  const minSilenceSec = (opts.minSilenceUs ?? 500_000) / 1_000_000;
  // silencedetect writes to stderr; -f null discards output.
  const { stderr } = await exec(FFMPEG, [
    '-i',
    path,
    '-af',
    `silencedetect=noise=${noiseDb}dB:d=${minSilenceSec}`,
    '-f',
    'null',
    '-',
  ]).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? '' }));

  const intervals: SilenceInterval[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split('\n')) {
    const ms = line.match(/silence_start:\s*([\d.]+)/);
    const me = line.match(/silence_end:\s*([\d.]+)/);
    if (ms) pendingStart = Math.round(Number(ms[1]) * 1_000_000);
    else if (me && pendingStart !== null) {
      intervals.push({ start: pendingStart, end: Math.round(Number(me[1]) * 1_000_000) });
      pendingStart = null;
    }
  }
  return intervals;
}

/** ffprobe details of an audio file (used by tests to assert wav format). */
export async function probeAudioStream(
  path: string,
): Promise<{ sampleRate: number; channels: number; codec: string; durationUs: number }> {
  const { stdout } = await exec(FFPROBE, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate,channels,codec_name:format=duration',
    '-of',
    'json',
    path,
  ]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ sample_rate?: string; channels?: number; codec_name?: string }>;
  };
  const s = data.streams?.[0] ?? {};
  return {
    sampleRate: Number(s.sample_rate ?? 0),
    channels: Number(s.channels ?? 0),
    codec: s.codec_name ?? '',
    durationUs: Math.round(Number(data.format?.duration ?? 0) * 1_000_000),
  };
}
