// 자막 번인 플랜 — GUI(doBurn)와 헤드리스(MCP render)가 공유하는 단일 진실원천.
//
// '어떤 텍스트를 어떤 위치·시간·강조로 래스터해 오버레이로 놓을지'를 순수하게 계산한다.
// 래스터(캔버스)와 파일 IO는 호출측 책임: UI는 DOM canvas + writeAsset, MCP는
// @napi-rs/canvas + tmp 파일. 양쪽이 이 플랜과 drawSubtitle을 쓰는 한 픽셀 파라미터가
// 갈라질 수 없다(WYSIWYG ↔ 에이전트 출력 일치, issue #1).
import { wrapCaption } from './caption.js';
import type { SubtitleStyle } from './draw.js';
import { pickKeywords } from './keywords.js';
import {
  type CaptionAnimation,
  type SubtitleCue,
  captionFrames,
  transcriptToCues,
} from './subtitles.js';
import type { OverlayClip, TimelineModel, TranscriptModel } from './types.js';

export interface SubtitlePosLike {
  x: number;
  y: number;
  scale: number;
}

/** GUI store 기본값과 동일 — .dawn에 subtitlePos가 없을 때 헤드리스가 쓰는 폴백. */
export const DEFAULT_SUBTITLE_POS: SubtitlePosLike = { x: 0.1, y: 0.8, scale: 0.8 };

/** 자막 'pop' 등장 키프레임 — 시작 60% 크기에서 22% 구간 동안 풀크기로(easeOut). */
export const POP_FROM = 0.6;
export const POP_U = 0.22;

/** 번인 래스터 표준 캔버스(1000×150, 20:3) — UI rasterizeSubtitle과 동일. */
export const BURN_RASTER_W = 1000;
export const BURN_RASTER_H = 150;

/** 번인 줄바꿈 규칙 — UI doBurn과 동일(한 줄 16자, 2줄 목표). */
export const BURN_WRAP = { maxCharsPerLine: 16, maxLines: 2 } as const;

/**
 * 애니메이션별 cue 분절 옵션. 미리보기·번인·헤드리스가 반드시 같은 함수를 써야
 * 동일한 자막 텍스트가 나온다(드리프트 방지). 'none'·'pop'은 cue 전체 유지.
 */
export function cueOptsForAnim(anim: string): {
  maxWordsPerCue?: number;
  maxCharsPerCue?: number;
  maxGapUs?: number;
} {
  return anim === 'none' || anim === 'pop'
    ? {}
    : { maxWordsPerCue: 4, maxCharsPerCue: 13, maxGapUs: 400_000 };
}

// drawSubtitle은 어절의 구두점을 떼고 비교하므로(STRIP_PUNCT_RE) 표면형도 동일하게 정규화.
const EMPH_STRIP = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/** 키워드 강조 어절 코어 집합(off면 undefined). */
export function emphasisCores(cueText: string, on: boolean): readonly string[] | undefined {
  return on ? pickKeywords(cueText).map((w) => w.replace(EMPH_STRIP, '')) : undefined;
}

/** 래스터 1장(=오버레이 1개)의 사양 — 호출측은 wrapped+emphasis로 drawSubtitle 하면 된다. */
export interface BurnFrameSpec {
  /** 원본 cue 텍스트(오버레이 name용). */
  cueText: string;
  /** 이 프레임의 원시 텍스트(오버레이 text 필드). */
  text: string;
  /** drawSubtitle에 넘길 줄바꿈 적용 텍스트. */
  wrapped: string;
  /** drawSubtitle emphasis 집합 재료(karaoke 활성 어절 또는 키워드 코어). */
  emphasis?: readonly string[];
  x: number;
  y: number;
  scale: number;
  keyframes?: OverlayClip['keyframes'];
  startUs: number;
  endUs: number;
}

/** 위치 지정 cue — 수기 자막처럼 cue마다 자리가 다를 때(없으면 전역 pos). */
export interface PlacedCue {
  cue: SubtitleCue;
  pos?: SubtitlePosLike;
}

/**
 * 자막 번인 플랜 — transcript cue + (선택) 추가 cue들을 애니 서브프레임으로 펼쳐
 * 래스터 사양 목록으로 환원한다. 순수·결정적: 같은 입력 → 같은 플랜.
 */
export function subtitleBurnPlan(
  transcript: TranscriptModel | null,
  timeline: TimelineModel,
  style: SubtitleStyle,
  pos: SubtitlePosLike = DEFAULT_SUBTITLE_POS,
  extraCues: readonly PlacedCue[] = [],
): BurnFrameSpec[] {
  const anim = (style.animation ?? 'none') as CaptionAnimation;
  const emphOn = style.emphasizeKeywords ?? false;
  const placed: PlacedCue[] = [
    ...(transcript
      ? transcriptToCues(transcript, timeline, cueOptsForAnim(anim)).map((cue) => ({ cue }))
      : []),
    ...extraCues,
  ];
  const out: BurnFrameSpec[] = [];
  for (const { cue, pos: cuePosMaybe } of placed) {
    const cuePos = cuePosMaybe ?? pos;
    // 키워드 강조는 줄바꿈 전 원문 cue.text로 계산해야 표면형 코어가 일치한다.
    const cueKeys = emphasisCores(cue.text, emphOn);
    for (const fr of captionFrames(cue, anim)) {
      const emphasis = anim === 'karaoke' && fr.activeWord ? [fr.activeWord] : cueKeys;
      out.push({
        cueText: cue.text,
        text: fr.text,
        wrapped: wrapCaption(fr.text, BURN_WRAP),
        ...(emphasis ? { emphasis } : {}),
        x: cuePos.x,
        y: cuePos.y,
        scale: anim === 'pop' ? cuePos.scale * POP_FROM : cuePos.scale,
        ...(anim === 'pop'
          ? { keyframes: [{ u: POP_U, scale: cuePos.scale, easing: 'easeOut' as const }] }
          : {}),
        startUs: fr.startUs,
        endUs: fr.endUs,
      });
    }
  }
  return out;
}

/** 플랜 프레임 → OverlayClip(자막 z=100, 불투명). src는 호출측이 래스터한 PNG 경로.
 *  (UI는 여기에 name/text 표시 필드를 더해 store Overlay로 쓴다.) */
export function burnFrameToOverlay(spec: BurnFrameSpec, src: string, id: string): OverlayClip {
  return {
    id,
    kind: 'subtitle',
    src,
    x: spec.x,
    y: spec.y,
    scale: spec.scale,
    ...(spec.keyframes ? { keyframes: spec.keyframes } : {}),
    opacity: 1,
    startUs: spec.startUs,
    endUs: spec.endUs,
    z: 100,
  };
}
