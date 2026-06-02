import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { buildOverlayFilter, effectFilter } from '@dawn-cut/core';
import type { Edl, OverlayClip, VideoStats } from '@dawn-cut/core';

const exec = promisify(execFile);

const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.DAWN_FFPROBE ?? 'ffprobe';

export interface ProbeResult {
  durationUs: number;
  fps: number;
  hasAudio: boolean;
  width: number;
  height: number;
  /** 비디오 코덱(예: h264/hevc/prores). 미리보기 재생 가능 여부 판단에 쓴다. */
  vcodec: string;
  /** H.264 등의 level×10(예: 5.2→52, 4.0→40). 고레벨은 Electron 미리보기가 못 그릴 수 있다. */
  level: number;
}

/** ffprobe → duration (µs), video fps, frame size, audio presence, codec/level. (IPC `media:probe`) */
export async function probeMedia(path: string): Promise<ProbeResult> {
  const { stdout } = await exec(FFPROBE, [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,codec_name,level,r_frame_rate,width,height',
    '-of',
    'json',
    path,
  ]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      level?: number;
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
    vcodec: String(video?.codec_name ?? ''),
    level: Number(video?.level ?? 0),
  };
}

/**
 * 미리보기 프록시 — 원본을 '확실히 재생되는' 작은 H.264(Main/Level 4.0, ≤1280px, yuv420p,
 * faststart)로 재인코딩한다. (IPC `preview:proxy`)
 *
 * 왜: Electron 미리보기(`<video>`)는 코덱은 넓게 받지만, 고레벨 H.264(level 5.x)·초고해상도·
 * HEVC/ProRes 등은 시간만 흐르고 프레임을 못 그려(검은 화면) 사용자가 "영상이 안 나온다"고 느낀다.
 * 편집·내보내기는 원본(FFmpeg)으로 하되, '보는 것'만 이 프록시로 해결한다. 프록시는 원본과 길이가
 * 동일해 EDL 시킹이 1:1로 맞는다(편집은 원본 좌표 그대로).
 *
 * @param src 원본 경로.  @param out 출력 mp4 경로.  @param maxDim 긴 변 상한(기본 1280).
 */
export async function makePreviewProxy(src: string, out: string, maxDim = 1280): Promise<string> {
  const cap = Math.max(160, Math.min(2160, Math.round(maxDim)));
  await exec(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    src,
    '-vf',
    // 긴 변을 cap 이하로 축소(비율 유지) + 짝수 치수 보장(yuv420p).
    `scale='min(${cap},iw)':'min(${cap},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-level',
    '4.0',
    '-preset',
    'veryfast',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    out,
  ]);
  return out;
}

function parseFps(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den) return 0;
  return Math.round((num / den) * 1000) / 1000;
}

/**
 * ffmpeg `signalstats` → 평균 휘도(YAVG)/채도(SATAVG)/휘도 범위(YMIN·YMAX) (IPC `analyze:video`).
 *
 * '1탭 적응형 자동 보정'의 입력. 짧은 샘플만 분석한다(전체 디코드 불필요 → 빠르고 결정적).
 * detectSilences와 동일하게 stderr를 파싱한다(`metadata=print`가 lavfi.signalstats.* 를 찍는다).
 * 파싱 실패 시 무해한 중립값(밝기 보통/적당 대비)을 돌려준다 → 자동 보정이 과보정하지 않는다.
 *
 * 측정값은 core의 순수 `autoEnhanceParams(stats)` 로 넘겨 eq 파라미터를 계산한다(렌더는 별도).
 */
export async function analyzeVideo(
  path: string,
  opts: { sampleSec?: number; sampleFps?: number } = {},
): Promise<VideoStats> {
  const sampleSec = Math.min(60, Math.max(0.5, opts.sampleSec ?? 6));
  const sampleFps = Math.min(10, Math.max(0.5, opts.sampleFps ?? 2));
  const { stderr } = await exec(FFMPEG, [
    '-hide_banner',
    '-t',
    String(sampleSec),
    '-i',
    path,
    '-vf',
    `fps=${sampleFps},signalstats,metadata=print`,
    '-f',
    'null',
    '-',
  ]).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? '' }));

  const yavgs: number[] = [];
  const satavgs: number[] = [];
  let ymin = Number.POSITIVE_INFINITY;
  let ymax = Number.NEGATIVE_INFINITY;
  for (const line of stderr.split('\n')) {
    const ya = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    const sa = /lavfi\.signalstats\.SATAVG=([\d.]+)/.exec(line);
    const yi = /lavfi\.signalstats\.YMIN=([\d.]+)/.exec(line);
    const yx = /lavfi\.signalstats\.YMAX=([\d.]+)/.exec(line);
    if (ya) yavgs.push(Number(ya[1]));
    if (sa) satavgs.push(Number(sa[1]));
    if (yi) ymin = Math.min(ymin, Number(yi[1]));
    if (yx) ymax = Math.max(ymax, Number(yx[1]));
  }
  if (yavgs.length === 0) return { yavg: 128, ymin: 16, ymax: 240, satavg: 40 }; // 파싱 실패 폴백
  const mean = (xs: number[], d: number) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : d;
  return {
    yavg: mean(yavgs, 128),
    ymin: Number.isFinite(ymin) ? ymin : 16,
    ymax: Number.isFinite(ymax) ? ymax : 240,
    satavg: mean(satavgs, 40),
  };
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
  // 자동 리프레이밍: 소스를 목표 종횡비로 중앙 크롭(쇼츠 9:16, 정사각 1:1). 'source'/미지정=원본 유지.
  // 오버레이 좌표는 크롭된 프레임 기준으로 재계산된다(safe-area 보존).
  reframe?: '9:16' | '1:1' | 'source';
}

/** 소스 w×h를 목표 종횡비로 중앙 크롭할 짝수 치수(짝수=yuv420p 안전). */
function cropForAspect(w: number, h: number, aspect: '9:16' | '1:1'): { w: number; h: number } {
  const [tw, th] = aspect === '9:16' ? [9, 16] : [1, 1];
  const target = tw / th;
  const src = w / h;
  let cw = w;
  let ch = h;
  if (src > target)
    cw = Math.round(h * target); // 소스가 더 넓다 → 폭을 깎음
  else ch = Math.round(w / target); // 소스가 더 좁다(세로) → 높이를 깎음
  const even = (n: number) => Math.max(2, n - (n % 2));
  return { w: even(Math.min(cw, w)), h: even(Math.min(ch, h)) };
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

  // ── 리프레이밍: concat된 [vbase]를 목표 종횡비로 중앙 크롭한 뒤 그 위에 오버레이를 올린다.
  // reframe 없으면(또는 'source') baseLabel='vbase'·ovW/ovH=소스치수·cropFilter=''로 기존과 바이트 동일.
  const srcW = opts.frameW ?? 1280;
  const srcH = opts.frameH ?? 720;
  const wantReframe = opts.reframe === '9:16' || opts.reframe === '1:1';
  const crop = wantReframe ? cropForAspect(srcW, srcH, opts.reframe as '9:16' | '1:1') : null;
  const baseLabel = crop ? 'vrf' : 'vbase';
  const cropFilter = crop ? `[vbase]crop=${crop.w}:${crop.h}[vrf]` : '';
  const ovW = crop ? crop.w : srcW;
  const ovH = crop ? crop.h : srcH;

  // overlays are appended as inputs 1..N (before any subtitle input)
  const ovf =
    overlays.length > 0
      ? buildOverlayFilter(baseLabel, overlays, ovW, ovH, 1)
      : { inputs: [] as string[], filter: '', out: `[${baseLabel}]` };

  // animated GIFs need -ignore_loop 0 so they loop for the whole clip
  const pushOverlayInputs = (arr: string[]) => {
    for (const ip of ovf.inputs) {
      if (/\.gif$/i.test(ip)) arr.push('-ignore_loop', '0');
      arr.push('-i', ip);
    }
  };

  if (format === 'gif') {
    const vconcat = `${vparts.join(';')};${vlabels.join('')}concat=n=${n}:v=1:a=0[vbase]`;
    const cropPart = cropFilter ? `;${cropFilter}` : '';
    const composed = ovf.filter ? `${vconcat}${cropPart};${ovf.filter}` : `${vconcat}${cropPart}`;
    const vin = ovf.filter ? ovf.out.slice(1, -1) : baseLabel;
    const filter = `${composed};[${vin}]fps=12,scale=540:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse[v]`;
    const gargs = ['-y', '-loglevel', 'error', '-i', input];
    pushOverlayInputs(gargs);
    gargs.push('-filter_complex', filter, '-map', '[v]', '-loop', '0', outPath);
    await exec(FFMPEG, gargs, { maxBuffer: 64 * 1024 * 1024 });
    return { outPath };
  }

  const interleaved = edl.segments.map((_, i) => `${vlabels[i]}${alabels[i]}`).join('');
  const concat = `${vparts.join(';')};${aparts.join(';')};${interleaved}concat=n=${n}:v=1:a=1[vbase][a]`;
  const cropPart = cropFilter ? `;${cropFilter}` : '';
  let filter = ovf.filter ? `${concat}${cropPart};${ovf.filter}` : `${concat}${cropPart}`;
  const videoLabel = ovf.out; // '[vbase]'(reframe 시 '[vrf]') when no overlays, else '[voN]'

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
