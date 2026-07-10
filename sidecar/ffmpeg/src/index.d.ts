import type { Edl, OverlayClip, VideoStats } from '@dawn-cut/core';
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
export declare function probeMedia(path: string): Promise<ProbeResult>;
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
export declare function makePreviewProxy(
  src: string,
  out: string,
  maxDim?: number,
): Promise<string>;
/**
 * 타임라인 필름스트립용 썸네일 배치(B2) — fps 필터 1패스, ≈1장/s, 상한으로 롱폼 방어.
 * 편집·내보내기와 무관한 시각 보조(원본 좌표계에 영향 없음). (IPC `media:visuals`)
 */
export declare function extractThumbs(
  src: string,
  outDir: string,
  opts?: {
    height?: number;
    maxCount?: number;
  },
): Promise<{
  thumbs: string[];
  intervalUs: number;
}>;
/**
 * 파형 피크(B2) — 8kHz mono s16le로 디코드해 버킷당 max|sample| (0..1). 오디오 없으면 [].
 * maxBuffer 256MB = 8kHz×2B 기준 약 4.4시간분.
 */
export declare function extractPeaks(
  src: string,
  opts?: {
    peaksPerSec?: number;
  },
): Promise<number[]>;
/**
 * ffmpeg `signalstats` → 평균 휘도(YAVG)/채도(SATAVG)/휘도 범위(YMIN·YMAX) (IPC `analyze:video`).
 *
 * '1탭 적응형 자동 보정'의 입력. 짧은 샘플만 분석한다(전체 디코드 불필요 → 빠르고 결정적).
 * detectSilences와 동일하게 stderr를 파싱한다(`metadata=print`가 lavfi.signalstats.* 를 찍는다).
 * 파싱 실패 시 무해한 중립값(밝기 보통/적당 대비)을 돌려준다 → 자동 보정이 과보정하지 않는다.
 *
 * 측정값은 core의 순수 `autoEnhanceParams(stats)` 로 넘겨 eq 파라미터를 계산한다(렌더는 별도).
 */
export declare function analyzeVideo(
  path: string,
  opts?: {
    sampleSec?: number;
    sampleFps?: number;
  },
): Promise<VideoStats>;
/**
 * Extract audio as 16kHz mono PCM s16le wav for whisper. (IPC `media:extractAudio`)
 * FFmpeg runs as a subprocess — no linking, no --enable-gpl (LGPL preserved).
 */
export declare function extractAudio(
  inputPath: string,
  outWavPath: string,
): Promise<{
  wavPath: string;
}>;
/** Write an SRT document to disk. (IPC `subtitle:write`) */
export declare function writeSrt(
  path: string,
  content: string,
): Promise<{
  path: string;
}>;
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
  voicePath?: string;
  voiceStartUs?: number;
  reframe?: '9:16' | '1:1' | 'source';
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
}
/** 품질 프리셋 → CRF 값(순수, 단위테스트 대상). */
export declare function crfForQuality(q: NonNullable<RenderOpts['quality']>): string;
export declare function detectH264Encoder(): Promise<'libx264' | 'h264_videotoolbox'>;
/** 테스트용 — 감지 캐시 리셋(env로 ffmpeg를 바꿔치기하는 테스트가 사용). */
export declare function resetEncoderCache(): void;
/** CRF(libx264) ↔ -q:v(videotoolbox, 0~100 높을수록 고화질) 결정적 매핑(순수). */
export declare function vtbQualityForCrf(crf: number): string;
/** 인코더별 비디오 인자(순수 조립). */
export declare function vencArgs(enc: 'libx264' | 'h264_videotoolbox', crf: number): string[];
export declare function renderEdl(
  edl: Edl,
  outPath: string,
  opts?: RenderOpts,
): Promise<{
  outPath: string;
}>;
/**
 * 오디오만 내보내기(issue #5) — EDL의 오디오 세그먼트만 trim/concat해 mp3/wav로.
 * 팟캐스트 클립·녹취 공유용. 비디오 디코드가 없어 매우 빠르다.
 */
export declare function renderAudioOnly(
  edl: Edl,
  outPath: string,
  format: 'mp3' | 'wav',
): Promise<{
  outPath: string;
}>;
/** True if the file contains at least one subtitle stream (ffprobe). */
export declare function hasSubtitleStream(path: string): Promise<boolean>;
export interface SilenceInterval {
  start: number;
  end: number;
}
/**
 * Detect silent intervals via the FFmpeg `silencedetect` filter. (IPC `analyze:silence`)
 * noiseDb e.g. -30 (dBFS threshold), minSilenceUs minimum silence to report.
 */
export declare function detectSilences(
  path: string,
  opts?: {
    noiseDb?: number;
    minSilenceUs?: number;
  },
): Promise<SilenceInterval[]>;
/** ffprobe details of an audio file (used by tests to assert wav format). */
export declare function probeAudioStream(path: string): Promise<{
  sampleRate: number;
  channels: number;
  codec: string;
  durationUs: number;
}>;
