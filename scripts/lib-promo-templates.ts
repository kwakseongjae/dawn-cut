// 프로모 템플릿 카탈로그(#18) — 사이클 8~9에서 검증된 모션 문법을 '순수 데이터 함수'로 캡슐화.
// 입력(에셋·길이·치수) → OverlayClip[] 플랜. LLM은 템플릿 id와 파라미터만 고른다(양산의 핵심).
import type { OverlayClip } from '@dawn-cut/core';

export interface PromoAsset {
  path: string; // 전처리(카드화) 이후 경로
  rawPath: string; // 원본 경로(풀블리드용)
  w: number; // 원본 px
  h: number;
}
export interface TemplateInput {
  W: number;
  H: number;
  totalSec: number;
  assets: PromoAsset[]; // 역할 순서대로(첫 번째 = 히어로 후보)
  stickerMov: string; // CTA 알파 비디오(.mov)
  vignettePng: string;
}
export interface TemplatePlan {
  overlays: OverlayClip[];
  subtitlePos: { x: number; y: number; scale: number };
}

const cx = (sc: number) => (1 - sc) / 2;
const u = (sec: number) => Math.round(sec * 1e6);
/** 이미지가 프레임 '높이'를 덮는 폭배율(풀블리드 Ken Burns의 기준). */
const coverScale = (W: number, H: number, a: PromoAsset) => (H / W) * (a.w / a.h);

export const TEMPLATE_IDS = ['hero-fullbleed', 'card-collection', 'docu-mood'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** LLM 프롬프트용 카탈로그 설명(선택 근거 제공). */
export const TEMPLATE_CATALOG: Record<TemplateId, string> = {
  'hero-fullbleed':
    '제품 히어로형 — 첫 에셋이 화면을 꽉 채우고(Ken Burns) 두 번째가 카드 블리드로. 제품/물건 광고에 최적',
  'card-collection':
    '카드 컬렉션형 — 에셋들이 카드로 리듬감 있게 교차 등장(기울임 교대). 다수 이미지/포트폴리오에 최적',
  'docu-mood': '다큐 무드형 — 느린 풀블리드 교차 + 절제된 모션. 감성/스토리텔링·차분한 톤에 최적',
};

function vignette(input: TemplateInput, z = 10): OverlayClip {
  return {
    id: 'vig',
    kind: 'image',
    src: input.vignettePng,
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
    startUs: 0,
    endUs: u(input.totalSec),
    z,
  };
}
function ctaSticker(input: TemplateInput): OverlayClip {
  return {
    id: 'cta',
    kind: 'video',
    src: input.stickerMov,
    x: 0.225,
    y: 0.46,
    scale: 0.3,
    opacity: 1,
    startUs: u(Math.max(0, input.totalSec - 3.2)),
    endUs: u(input.totalSec - 0.1),
    z: 40,
    keyframes: [{ u: 0.18, scale: 0.55, x: 0.225, easing: 'back' }],
  };
}

/** 제품 히어로형 — v3에서 검증한 구성 그대로. */
export function heroFullbleed(input: TemplateInput): TemplatePlan {
  const { W, H, totalSec, assets } = input;
  const overlays: OverlayClip[] = [vignette(input)];
  const hero = assets[0]!;
  const hs = coverScale(W, H, hero) * 1.06;
  overlays.push({
    id: 'hero',
    kind: 'image',
    src: hero.rawPath,
    x: cx(hs),
    y: -0.04,
    scale: hs,
    opacity: 1,
    startUs: 0,
    endUs: u(Math.min(6, totalSec * 0.55)),
    z: 8,
    keyframes: [{ u: 1, scale: hs * 1.12, x: cx(hs * 1.12), y: -0.07, easing: 'easeInOut' }],
  });
  if (assets[1]) {
    const cs = 1.35;
    overlays.push({
      id: 'card',
      kind: 'image',
      src: assets[1].path,
      x: cx(cs),
      y: 0.13,
      scale: cs * 0.6,
      opacity: 1,
      startUs: u(Math.min(6, totalSec * 0.55)),
      endUs: u(totalSec - 2.8),
      z: 30,
      keyframes: [
        { u: 0.14, scale: cs, x: cx(cs), easing: 'back' },
        { u: 1, scale: cs * 1.06, x: cx(cs * 1.06), y: 0.08, easing: 'linear' },
      ],
    });
  }
  overlays.push(ctaSticker(input));
  return { overlays, subtitlePos: { x: 0.0, y: 0.73, scale: 1.0 } };
}

/** 카드 컬렉션형 — 에셋들을 카드 블리드로 교차(기울임·위치 교대). */
export function cardCollection(input: TemplateInput): TemplatePlan {
  const { totalSec, assets } = input;
  const overlays: OverlayClip[] = [vignette(input)];
  const usable = assets.slice(0, 4);
  const slot = (totalSec - 2.6) / usable.length;
  usable.forEach((a, i) => {
    const cs = i % 2 === 0 ? 1.3 : 1.2;
    const y = i % 2 === 0 ? 0.1 : 0.2;
    overlays.push({
      id: `card${i}`,
      kind: 'image',
      src: a.path,
      x: cx(cs),
      y,
      scale: cs * 0.6,
      opacity: 1,
      startUs: u(i * slot + 0.2),
      endUs: u((i + 1) * slot + 0.6),
      z: 30,
      keyframes: [
        { u: 0.15, scale: cs, x: cx(cs), easing: 'back' },
        { u: 1, scale: cs * 1.05, x: cx(cs * 1.05), y: y - 0.02, easing: 'linear' },
      ],
    });
  });
  overlays.push(ctaSticker(input));
  return { overlays, subtitlePos: { x: 0.0, y: 0.74, scale: 1.0 } };
}

/** 다큐 무드형 — 느린 풀블리드 교차, CTA 절제(스티커 없음). */
export function docuMood(input: TemplateInput): TemplatePlan {
  const { W, H, totalSec, assets } = input;
  const overlays: OverlayClip[] = [vignette(input, 12)];
  const usable = assets.slice(0, 3);
  const slot = totalSec / usable.length;
  usable.forEach((a, i) => {
    const s0 = coverScale(W, H, a) * 1.05;
    overlays.push({
      id: `full${i}`,
      kind: 'image',
      src: a.rawPath,
      x: cx(s0),
      y: -0.03,
      scale: s0,
      opacity: 1,
      startUs: u(i * slot),
      endUs: u(Math.min(totalSec, (i + 1) * slot + 0.4)),
      z: 8,
      keyframes: [
        { u: 1, scale: s0 * 1.08, x: cx(s0 * 1.08), y: i % 2 ? -0.06 : 0, easing: 'easeInOut' },
      ],
    });
  });
  return { overlays, subtitlePos: { x: 0.0, y: 0.76, scale: 0.92 } };
}

export const TEMPLATES: Record<TemplateId, (i: TemplateInput) => TemplatePlan> = {
  'hero-fullbleed': heroFullbleed,
  'card-collection': cardCollection,
  'docu-mood': docuMood,
};

/** 배경 무드 카탈로그(assets/broll) — LLM 선택지. */
export const BG_MOODS = [
  'bokeh-dawn',
  'bokeh-ocean',
  'aurora-flow',
  'sunset-flow',
  'mint-flow',
  'stars-night',
] as const;
export type BgMood = (typeof BG_MOODS)[number];
