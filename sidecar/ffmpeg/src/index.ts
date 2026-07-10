import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildOverlayFilter, effectFilter } from '@dawn-cut/core';
import type { Edl, OverlayClip, VideoStats } from '@dawn-cut/core';

const exec = promisify(execFile);

// 호출 시점 해석(lazy) — 패키징 앱은 main 부팅 시 동봉 경로(Resources/bin)를
// DAWN_FFMPEG/DAWN_FFPROBE env로 주입한다(ESM import 호이스팅보다 늦어도 적용되게).
const FFMPEG = () => process.env.DAWN_FFMPEG ?? 'ffmpeg';
const FFPROBE = () => process.env.DAWN_FFPROBE ?? 'ffprobe';

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
  const { stdout } = await exec(FFPROBE(), [
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
  const enc = await detectH264Encoder();
  const encArgs =
    enc === 'libx264'
      ? [
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
        ]
      : ['-c:v', 'h264_videotoolbox', '-profile:v', 'main', '-q:v', vtbQualityForCrf(24)];
  await exec(FFMPEG(), [
    '-y',
    '-loglevel',
    'error',
    '-i',
    src,
    '-vf',
    // 긴 변을 cap 이하로 축소(비율 유지) + 짝수 치수 보장(yuv420p).
    `scale='min(${cap},iw)':'min(${cap},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    ...encArgs,
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

/**
 * 타임라인 필름스트립용 썸네일 배치(B2) — fps 필터 1패스, ≈1장/s, 상한으로 롱폼 방어.
 * 편집·내보내기와 무관한 시각 보조(원본 좌표계에 영향 없음). (IPC `media:visuals`)
 */
export async function extractThumbs(
  src: string,
  outDir: string,
  opts: { height?: number; maxCount?: number } = {},
): Promise<{ thumbs: string[]; intervalUs: number }> {
  const height = opts.height ?? 54;
  const maxCount = opts.maxCount ?? 120;
  const probe = await probeMedia(src);
  const durSec = probe.durationUs / 1e6;
  if (durSec <= 0 || probe.width <= 0) return { thumbs: [], intervalUs: 0 };
  const count = Math.max(1, Math.min(maxCount, Math.ceil(durSec)));
  const intervalSec = durSec / count;
  await mkdir(outDir, { recursive: true });
  await exec(FFMPEG(), [
    '-y',
    '-loglevel',
    'error',
    '-i',
    src,
    '-vf',
    `fps=1/${intervalSec},scale=-2:${height}`,
    '-q:v',
    '5',
    join(outDir, 'thumb-%04d.jpg'),
  ]);
  const thumbs = (await readdir(outDir))
    .filter((f) => f.startsWith('thumb-') && f.endsWith('.jpg'))
    .sort()
    .map((f) => join(outDir, f));
  return { thumbs, intervalUs: Math.round(intervalSec * 1e6) };
}

/**
 * 파형 피크(B2) — 8kHz mono s16le로 디코드해 버킷당 max|sample| (0..1). 오디오 없으면 [].
 * maxBuffer 256MB = 8kHz×2B 기준 약 4.4시간분.
 */
export async function extractPeaks(
  src: string,
  opts: { peaksPerSec?: number } = {},
): Promise<number[]> {
  const peaksPerSec = opts.peaksPerSec ?? 20;
  const probe = await probeMedia(src);
  if (!probe.hasAudio || probe.durationUs <= 0) return [];
  const SR = 8000;
  const { stdout } = await exec(
    FFMPEG(),
    [
      '-v',
      'error',
      '-i',
      src,
      '-map',
      'a:0',
      '-ac',
      '1',
      '-ar',
      String(SR),
      '-f',
      's16le',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 },
  );
  const buf = stdout as unknown as Buffer;
  const perBucket = Math.max(1, Math.round(SR / peaksPerSec));
  const samples = Math.floor(buf.length / 2);
  const peaks: number[] = [];
  for (let start = 0; start < samples; start += perBucket) {
    const end = Math.min(samples, start + perBucket);
    let m = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(buf.readInt16LE(i * 2));
      if (v > m) m = v;
    }
    peaks.push(Math.round((m / 32768) * 100) / 100);
  }
  return peaks;
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
  const { stderr } = await exec(FFMPEG(), [
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
  await exec(FFMPEG(), [
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
  // ── 내보내기 프리셋(issue #5) — 미지정 시 기존과 바이트 동일 ──
  /** 출력 세로 해상도(px) — 가로는 종횡비 유지(-2, 짝수). 예: 1080/720. */
  outHeight?: number;
  /** 품질 프리셋 → libx264 CRF(high=18/medium=23/small=28). 미지정=ffmpeg 기본. */
  quality?: 'high' | 'medium' | 'small';
  /**
   * 입력에 오디오 스트림이 있는가(기본 true=기존 동작). false면 [0:a] 참조 대신
   * 무음 트랙(anullsrc)을 합성한다 — 화면녹화 등 무음 영상도 내보내기·TTS 믹스가 되게.
   * (실측 2026-06-11: 미지정 상태로 무음 입력을 주면 ffmpeg가 [0:a]에서 즉사했다.)
   */
  inputHasAudio?: boolean;
  /** 출력 프레임레이트(기본 = 타임라인 fps). 예: 60fps 원본을 30으로, 또는 60 업샘플. */
  outFps?: number;
  /**
   * B7 BGM 트랙 — 프로그램(+보이스) 위에 음악을 깐다. duck=true(B6)면 말소리(원본+보이스)가
   * 나올 때 sidechaincompress로 음악이 자동으로 숙는다. 미지정 시 기존과 인자 바이트 동일.
   */
  bgm?: {
    path: string;
    startUs: number; // 프로그램 좌표
    endUs: number;
    volume: number; // 0..1 (관례 0.15~0.35)
    loop: boolean; // 창 길이만큼 반복
    duck: boolean; // B6 덕킹
  };
}

/** 품질 프리셋 → CRF 값(순수, 단위테스트 대상). */
export function crfForQuality(q: NonNullable<RenderOpts['quality']>): string {
  return q === 'high' ? '18' : q === 'small' ? '28' : '23';
}

// ── H.264 인코더 폴백(issue #19) ─────────────────────────────────────
// 동봉용 LGPL ffmpeg에는 libx264(GPL)가 없다 → macOS 하드웨어 인코더
// h264_videotoolbox로 폴백한다. dev(brew GPL 빌드)에선 libx264 유지(기존 산출물 동일).
let h264Cache: 'libx264' | 'h264_videotoolbox' | null = null;
export async function detectH264Encoder(): Promise<'libx264' | 'h264_videotoolbox'> {
  if (h264Cache) return h264Cache;
  try {
    const { stdout } = await exec(FFMPEG(), ['-hide_banner', '-encoders']);
    h264Cache = stdout.includes('libx264') ? 'libx264' : 'h264_videotoolbox';
  } catch {
    h264Cache = 'libx264';
  }
  return h264Cache;
}
/** 테스트용 — 감지 캐시 리셋(env로 ffmpeg를 바꿔치기하는 테스트가 사용). */
export function resetEncoderCache(): void {
  h264Cache = null;
}
/** CRF(libx264) ↔ -q:v(videotoolbox, 0~100 높을수록 고화질) 결정적 매핑(순수). */
export function vtbQualityForCrf(crf: number): string {
  // 선형 매핑: crf18→q75(고화질) · 23→q62(보통) · 28→q48(고압축) · 프록시24→q58.
  return String(Math.max(30, Math.min(85, Math.round(123.6 - 2.7 * crf))));
}
/** 인코더별 비디오 인자(순수 조립). */
export function vencArgs(enc: 'libx264' | 'h264_videotoolbox', crf: number): string[] {
  return enc === 'libx264'
    ? ['-c:v', 'libx264', '-crf', String(crf)]
    : ['-c:v', 'h264_videotoolbox', '-q:v', vtbQualityForCrf(crf)];
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

  // ── B4 경계 전환 — 프로그램 길이 완전 불변 규약 ──
  // crossfade: 소스 '핸들'로만 오버랩(A 꼬리를 sourceEnd 너머 D/2, B 머리를 앞으로 D/2 확장).
  //   xfade 유효 길이 = handleA+handleB → 출력 길이 = Σ원래 세그먼트 길이(EOF/0에선 결정적 축소,
  //   2프레임 미만이면 하드컷). dipToBlack: 핸들 불필요 — 세그먼트 fade in/out + 평범한 concat.
  // 오디오는 오버랩하지 않는다(핸들 오디오는 '삭제된 내용'을 부활시킬 수 있음) — afade out/in만.
  // 전환이 없으면 아래 전부 0/기존 경로 → 필터 문자열 바이트 동일(회귀 0).
  const trans = edl.transitions ?? [];
  const trAfter = new Map(trans.map((t) => [t.afterIndex, t]));
  const nSeg = edl.segments.length;
  const extL: number[] = new Array(nSeg).fill(0);
  const extR: number[] = new Array(nSeg).fill(0);
  // B5 배속 헬퍼 — 세그먼트 speed(생략=1). 전환 D는 '프로그램' 시간이라 소스 핸들은 ×speed.
  const segSpeed = (i: number) => {
    const sp = edl.segments[i]!.speed;
    return sp && sp > 0 ? sp : 1;
  };
  if (trans.some((t) => t.kind === 'crossfade')) {
    const mediaDurUs = (await probeMedia(input)).durationUs;
    for (const t of trans) {
      if (t.kind !== 'crossfade') continue;
      const sa = edl.segments[t.afterIndex]!;
      const sb = edl.segments[t.afterIndex + 1]!;
      extR[t.afterIndex] = Math.min(
        Math.round((t.durationUs / 2) * segSpeed(t.afterIndex)),
        Math.max(0, mediaDurUs - sa.sourceEnd),
      );
      extL[t.afterIndex + 1] = Math.min(
        Math.round((t.durationUs / 2) * segSpeed(t.afterIndex + 1)),
        sb.sourceStart,
      );
    }
    // 프로그램 오버랩 합이 2프레임 미만이면 하드컷 강등 — 확장분을 0으로 되돌려 길이 불변 유지.
    for (const t of trans) {
      if (t.kind !== 'crossfade') continue;
      const progUsed =
        (extR[t.afterIndex] ?? 0) / segSpeed(t.afterIndex) +
        (extL[t.afterIndex + 1] ?? 0) / segSpeed(t.afterIndex + 1);
      if (progUsed < Math.ceil(2e6 / edl.fps)) {
        extR[t.afterIndex] = 0;
        extL[t.afterIndex + 1] = 0;
      }
    }
  }
  const segLenUs = (i: number) => {
    const s = edl.segments[i]!;
    return s.sourceEnd - s.sourceStart;
  };
  const extLenUs = (i: number) => segLenUs(i) + (extL[i] ?? 0) + (extR[i] ?? 0);
  // B5: 프로그램 길이(배속 반영) — 폴드 offset/afade/총길이 계산의 좌표계.
  const progLenUs = (i: number) => Math.round(segLenUs(i) / segSpeed(i));
  const progExtLenUs = (i: number) => Math.round(extLenUs(i) / segSpeed(i));
  const minXfadeUs = Math.ceil(2e6 / edl.fps); // 2프레임 미만 오버랩이면 하드컷으로 강등

  const vparts: string[] = [];
  const aparts: string[] = [];
  const vlabels: string[] = [];
  const alabels: string[] = [];
  edl.segments.forEach((s, i) => {
    const a = sec(s.sourceStart - (extL[i] ?? 0));
    const b = sec(s.sourceEnd + (extR[i] ?? 0));
    // 클립 이펙트(펀치인 줌·색보정)를 trim→setpts 직후 체인에 삽입(라벨 없는 본문만 core가 생성).
    // setpts로 세그먼트 t가 0부터라 zoom의 on/t 기준이 세그먼트-로컬이라 안전. 이펙트 없으면 바이트동일.
    const eff = (s.effects ?? []).map((e) => effectFilter(e, edl.fps)).filter(Boolean);
    // dipToBlack: 세그먼트-로컬 fade(앞 경계 in / 뒤 경계 out). 오디오는 모든 전환에서 afade.
    const before = trAfter.get(i - 1);
    const after = trAfter.get(i);
    const vfades: string[] = [];
    if (before?.kind === 'dipToBlack')
      vfades.push(`fade=t=in:st=0:d=${sec(Math.floor(before.durationUs / 2))}`);
    if (after?.kind === 'dipToBlack')
      vfades.push(
        `fade=t=out:st=${sec(progExtLenUs(i) - Math.floor(after.durationUs / 2))}:d=${sec(Math.floor(after.durationUs / 2))}`,
      );
    const effChain = [...eff, ...vfades].length > 0 ? `,${[...eff, ...vfades].join(',')}` : '';
    const afades: string[] = [];
    if (before) afades.push(`afade=t=in:st=0:d=${sec(Math.floor(before.durationUs / 2))}`);
    if (after)
      afades.push(
        `afade=t=out:st=${sec(progLenUs(i) - Math.floor(after.durationUs / 2))}:d=${sec(Math.floor(after.durationUs / 2))}`,
      );
    const aChain = afades.length > 0 ? `,${afades.join(',')}` : '';
    // B5: 배속 — setpts 나눗셈(이후 체인은 전부 프로그램-로컬 시간), 오디오는 atempo. 1×면 바이트 동일.
    const sp = segSpeed(i);
    const vsetpts = sp === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${sp}`;
    const atempo = sp === 1 ? '' : `,atempo=${sp}`;
    vparts.push(`[0:v]trim=start=${a}:end=${b},${vsetpts}${effChain}[v${i}]`);
    aparts.push(
      `[0:a]atrim=start=${sec(s.sourceStart)}:end=${sec(s.sourceEnd)},asetpts=PTS-STARTPTS${atempo}${aChain}[a${i}]`,
    );
    vlabels.push(`[v${i}]`);
    alabels.push(`[a${i}]`);
  });
  const n = edl.segments.length;

  // 비디오 조인: 전환 없으면 기존 단일 concat(바이트 동일), 있으면 xfade/concat 폴드.
  const buildVideoJoin = (): string => {
    if (trans.length === 0) return `${vlabels.join('')}concat=n=${n}:v=1:a=0[vbase]`;
    const parts: string[] = [];
    let cur = 'v0';
    let curLenUs = progExtLenUs(0);
    for (let i = 1; i < n; i++) {
      const t = trAfter.get(i - 1);
      const out = i === n - 1 ? 'vbase' : `vx${i}`;
      // B5: xfade duration/offset은 '프로그램' 초(setpts 이후 좌표) — 핸들을 각자 배속으로 환산.
      const dUsed = Math.round((extR[i - 1] ?? 0) / segSpeed(i - 1) + (extL[i] ?? 0) / segSpeed(i));
      if (t?.kind === 'crossfade' && dUsed >= minXfadeUs) {
        parts.push(
          `[${cur}][v${i}]xfade=transition=fade:duration=${sec(dUsed)}:offset=${sec(curLenUs - dUsed)}[${out}]`,
        );
        curLenUs = curLenUs + progExtLenUs(i) - dUsed;
      } else {
        parts.push(`[${cur}][v${i}]concat=n=2:v=1:a=0[${out}]`);
        curLenUs += progExtLenUs(i);
      }
      cur = out;
    }
    return parts.join(';');
  };

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

  // animated GIFs need -ignore_loop 0 so they loop for the whole clip.
  // ★정지 이미지(png/jpg)는 -loop 1 + '-t 총길이'로 '유한한' 프레임 스트림으로 만든다
  // (사이클 8): 1프레임 입력에선 scale의 eval=frame 식이 한 번만 평가돼 스케일 키프레임
  // 애니가 조용히 무시됐다(위치 애니는 overlay 필터라 정상 — 팝인이 익스포트에서만 죽던
  // 잠복 버그). -shortest로 묶지 않는 이유: 짧은 자막 소프트트랙이 영상을 자르는 부작용
  // (QA F8이 회귀로 잡음) — 유한화는 -t로 한다.
  const totalSecAll = (edl.segments.reduce((acc, _s2, i2) => acc + progLenUs(i2), 0) / 1e6).toFixed(
    6,
  );
  const pushOverlayInputs = (arr: string[]) => {
    for (const ip of ovf.inputs) {
      if (/\.gif$/i.test(ip)) arr.push('-ignore_loop', '0');
      else if (/\.(png|jpe?g)$/i.test(ip)) arr.push('-loop', '1', '-t', totalSecAll);
      // 알파 비디오 스티커(.mov ProRes4444 / .webm) — 무한 루프 + 총길이 유한화(사이클 9).
      else if (/\.(mov|webm)$/i.test(ip)) arr.push('-stream_loop', '-1', '-t', totalSecAll);
      arr.push('-i', ip);
    }
  };

  if (format === 'gif') {
    const vconcat = `${vparts.join(';')};${buildVideoJoin()}`;
    const cropPart = cropFilter ? `;${cropFilter}` : '';
    const composed = ovf.filter ? `${vconcat}${cropPart};${ovf.filter}` : `${vconcat}${cropPart}`;
    const vin = ovf.filter ? ovf.out.slice(1, -1) : baseLabel;
    const filter = `${composed};[${vin}]fps=12,scale=540:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse[v]`;
    const gargs = ['-y', '-loglevel', 'error', '-i', input];
    pushOverlayInputs(gargs);
    gargs.push('-filter_complex', filter, '-map', '[v]', '-loop', '0', outPath);
    await exec(FFMPEG(), gargs, { maxBuffer: 64 * 1024 * 1024 });
    return { outPath };
  }

  const hasAud = opts.inputHasAudio !== false;
  const totalSec = edl.segments.reduce((acc, _s2, i2) => acc + progLenUs(i2), 0) / 1e6;
  const interleaved = edl.segments.map((_, i) => `${vlabels[i]}${alabels[i]}`).join('');
  // 무음 입력: 비디오만 concat + anullsrc로 길이만큼 무음 트랙 합성([0:a] 참조 금지).
  // B4: 전환이 있으면 비디오는 폴드(xfade 포함 가능)로, 오디오는 별도 concat으로 조인.
  const concat = hasAud
    ? trans.length === 0
      ? `${vparts.join(';')};${aparts.join(';')};${interleaved}concat=n=${n}:v=1:a=1[vbase][a]`
      : `${vparts.join(';')};${aparts.join(';')};${buildVideoJoin()};${alabels.join('')}concat=n=${n}:v=0:a=1[a]`
    : `${vparts.join(';')};${buildVideoJoin()};anullsrc=r=48000:cl=stereo,atrim=duration=${totalSec.toFixed(6)}[a]`;
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
  // ── B7 BGM(+B6 덕킹) — 기존 체인 '뒤'에만 스테이지 추가(bgm 없으면 인자 바이트 동일) ──
  if (opts.bgm) {
    const bgmIdx = voiceIdx + (opts.voicePath ? 1 : 0);
    const spanSec = Math.max(0.1, (opts.bgm.endUs - opts.bgm.startUs) / 1e6);
    if (opts.bgm.loop) args.push('-stream_loop', '-1');
    args.push('-t', spanSec.toFixed(6), '-i', opts.bgm.path);
    const delayMs = Math.round(opts.bgm.startUs / 1000);
    const vol = Math.max(0, Math.min(1, opts.bgm.volume));
    const fadeOutSt = Math.max(0, spanSec - 1).toFixed(6);
    // 창 경계 페이드(in 0.5/out 1.0)로 뚝 끊김 방지 → adelay로 프로그램 위치에 배치.
    filter += `;[${bgmIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},afade=t=in:d=0.5,afade=t=out:st=${fadeOutSt}:d=1,adelay=${delayMs}:all=1[bgmv]`;
    if (opts.bgm.duck) {
      // B6: 말소리(원본+보이스)를 사이드체인으로 BGM 압축 — 발화 중 자동으로 숙는다.
      filter += `;${audioLabel}asplit=2[amain][asc];[bgmv][asc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[bgmd];[amain][bgmd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[afinal]`;
    } else {
      filter += `;${audioLabel}[bgmv]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[afinal]`;
    }
    audioLabel = '[afinal]';
  }
  // 내보내기 프리셋(issue #5): 해상도 스케일은 최종 비디오 라벨 뒤에 1번만 붙인다(오버레이/크롭 이후).
  let mapVideo = videoLabel;
  if (opts.outHeight && opts.outHeight > 0) {
    const h = Math.max(2, opts.outHeight - (opts.outHeight % 2));
    filter += `;${videoLabel}scale=-2:${h}:flags=lanczos[vscaled]`;
    mapVideo = '[vscaled]';
  }
  args.push('-filter_complex', filter, '-map', mapVideo, '-map', audioLabel);
  if (opts.subtitlesPath) args.push('-map', `${subIdx}:0`, '-c:s', 'mov_text');
  // a looping GIF overlay is an infinite input → bound output to the finite base.
  // (only when a GIF overlay is present, so a short subtitle track can't trim the video.)
  if (ovf.inputs.some((p) => /\.gif$/i.test(p))) args.push('-shortest');
  const enc = await detectH264Encoder();
  if (opts.quality) args.push(...vencArgs(enc, Number(crfForQuality(opts.quality))));
  else if (enc !== 'libx264') args.push(...vencArgs(enc, 23)); // LGPL 빌드 기본이 mpeg4가 되는 것 방지
  args.push(
    '-r',
    String(opts.outFps && opts.outFps > 0 ? opts.outFps : edl.fps),
    '-pix_fmt',
    'yuv420p',
    outPath,
  );

  await exec(FFMPEG(), args, { maxBuffer: 32 * 1024 * 1024 });
  return { outPath };
}

/**
 * 오디오만 내보내기(issue #5) — EDL의 오디오 세그먼트만 trim/concat해 mp3/wav로.
 * 팟캐스트 클립·녹취 공유용. 비디오 디코드가 없어 매우 빠르다.
 */
export async function renderAudioOnly(
  edl: Edl,
  outPath: string,
  format: 'mp3' | 'wav',
): Promise<{ outPath: string }> {
  if (edl.segments.length === 0) throw new Error('renderAudioOnly: empty EDL');
  const input = edl.segments[0]!.mediaPath;
  const parts: string[] = [];
  const labels: string[] = [];
  edl.segments.forEach((s, i) => {
    // B5: 배속 세그먼트는 오디오도 atempo(프로그램 길이 일치).
    const atempo = s.speed && s.speed > 0 && s.speed !== 1 ? `,atempo=${s.speed}` : '';
    parts.push(
      `[0:a]atrim=start=${sec(s.sourceStart)}:end=${sec(s.sourceEnd)},asetpts=PTS-STARTPTS${atempo}[a${i}]`,
    );
    labels.push(`[a${i}]`);
  });
  const filter = `${parts.join(';')};${labels.join('')}concat=n=${edl.segments.length}:v=0:a=1[a]`;
  const codec = format === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ['-c:a', 'pcm_s16le'];
  await exec(
    FFMPEG(),
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      input,
      '-filter_complex',
      filter,
      '-map',
      '[a]',
      ...codec,
      outPath,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return { outPath };
}

/** True if the file contains at least one subtitle stream (ffprobe). */
export async function hasSubtitleStream(path: string): Promise<boolean> {
  const { stdout } = await exec(FFPROBE(), [
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
  const { stderr } = await exec(FFMPEG(), [
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
  const { stdout } = await exec(FFPROBE(), [
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
