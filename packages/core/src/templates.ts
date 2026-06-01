// 스타일 팩 — '1클릭 쇼츠 스타일' 템플릿. 핵심: 템플릿을 코드가 아니라 **plan(EditCommand[] 묶음)**으로
// 표현한다. 그래서 GUI 1클릭·LLM 플래너·MCP가 같은 자산을 공유하고, dryRun→승인→command bus→감사
// 파이프라인을 그대로 탄다(새 적용 경로 불필요 — 팩의 commands를 그냥 흘려보내면 된다).
//
// 팩-안전 verb만 쓴다(외부 좌표/ID 불필요, 임의 프로젝트에 적용 가능):
//   replaceSubtitleStyle(자막 스타일+애니), applyColorgrade(preset, 길이불변), removeFillers.
// 좌표/ID가 필요한 verb(deleteWordRange/removeSilences/cutSourceRange/applyZoom/applyGlossary)는 제외.
import type { EditCommand } from './edit-command.js';

/** 1클릭 스타일 팩 = 이름 붙은 EditCommand[] 묶음. */
export interface StylePack {
  /** 영문 slug(안정 식별자). */
  id: string;
  /** 한국어 표시 이름. */
  label: string;
  /** 대상 장르. */
  genre: string;
  /** 한 줄 설명(무엇을 왜). */
  description: string;
  /** 적용할 명령 묶음(순서대로 command bus로). */
  commands: EditCommand[];
}

// 실제 koreanShorts 프리셋과 동일한 CJK 폰트 체인(한글 자막 두부 방지).
const CJK =
  '"Apple SD Gothic Neo", "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif';

/**
 * 큐레이션된 스타일 팩 세트(워크플로 설계·스키마 검증). 장르 6종 커버:
 * 쇼츠 기본 / 먹방 / 뷰티 / 풍경·시네마틱 / 야경 / 브이로그·정보.
 * 각 팩은 장르에 맞는 색(6 preset 활용) + 자막 스타일/애니(reveal·karaoke·none) 조합.
 */
export const STYLE_PACKS: StylePack[] = [
  {
    id: 'viral-punch',
    label: '바이럴 펀치',
    genre: '쇼츠 기본/범용',
    description:
      '노란 강조 + 누적 등장 자막에 화사한 vivid 보정 — 어떤 영상에도 먹히는 쇼츠 기본값.',
    commands: [
      {
        type: 'replaceSubtitleStyle',
        style: {
          color: '#ffffff',
          bg: 'rgba(0,0,0,0.32)',
          stroke: 'rgba(0,0,0,0.92)',
          strokeWidth: 12,
          fontFamily: CJK,
          fontWeight: '800',
          fontScale: 0.46,
          emphasisColor: '#ffe14d',
          animation: 'reveal',
        },
      },
      { type: 'applyColorgrade', preset: 'vivid', intensity: 0.85 },
      { type: 'removeFillers' },
    ],
  },
  {
    id: 'mukbang-sizzle',
    label: '먹방 시즐',
    genre: '먹방/음식',
    description: '고채도 웜룩으로 음식을 살리고 호박색 카라오케 자막으로 씹는 리듬을 탄다.',
    commands: [
      {
        type: 'replaceSubtitleStyle',
        style: {
          color: '#ffffff',
          bg: 'rgba(0,0,0,0.30)',
          stroke: 'rgba(0,0,0,0.92)',
          strokeWidth: 12,
          fontFamily: CJK,
          fontWeight: '800',
          fontScale: 0.46,
          emphasisColor: '#ffb300',
          animation: 'karaoke',
        },
      },
      { type: 'applyColorgrade', preset: 'vivid', intensity: 0.85 },
    ],
  },
  {
    id: 'beauty-glow',
    label: '뷰티 글로우',
    genre: '메이크업/뷰티',
    description:
      '절제된 웜 글로우로 피부톤을 자연스럽게 살리고 로즈 강조 reveal 자막으로 설명을 쌓는다.',
    commands: [
      {
        type: 'replaceSubtitleStyle',
        style: {
          color: '#ffffff',
          bg: 'rgba(0,0,0,0.28)',
          stroke: 'rgba(0,0,0,0.85)',
          strokeWidth: 9,
          fontFamily: CJK,
          fontWeight: '700',
          fontScale: 0.4,
          emphasisColor: '#ff9ec4',
          animation: 'reveal',
        },
      },
      { type: 'applyColorgrade', preset: 'warm', intensity: 0.45 },
    ],
  },
  {
    id: 'golden-hour',
    label: '골든아워 시네마틱',
    genre: '풍경/드론·시네마틱',
    description: '필름룩 대비로 일몰·자연의 공기감을 살리고, 영상을 가리지 않는 정적 자막.',
    commands: [
      {
        type: 'replaceSubtitleStyle',
        style: {
          color: '#f6efdc',
          bg: 'transparent',
          stroke: 'rgba(0,0,0,0.80)',
          strokeWidth: 8,
          fontFamily: CJK,
          fontWeight: '700',
          fontScale: 0.36,
          emphasisColor: '#e8c87a',
          animation: 'none',
        },
      },
      { type: 'applyColorgrade', preset: 'cinematic', intensity: 0.7 },
    ],
  },
  {
    id: 'city-night',
    label: '시티 나이트',
    genre: '야경/도시·감성',
    description: '차가운 블루 톤으로 네온을 또렷하게, 시안 강조 reveal 자막으로 세련된 밤 무드.',
    commands: [
      {
        type: 'replaceSubtitleStyle',
        style: {
          color: '#ffffff',
          bg: 'rgba(0,0,0,0.34)',
          stroke: 'rgba(0,0,0,0.92)',
          strokeWidth: 11,
          fontFamily: CJK,
          fontWeight: '800',
          fontScale: 0.42,
          emphasisColor: '#7fdfff',
          animation: 'reveal',
        },
      },
      { type: 'applyColorgrade', preset: 'cool', intensity: 0.6 },
    ],
  },
  {
    id: 'talk-clean',
    label: '토크 클린',
    genre: '브이로그/정보·튜토리얼',
    description: '말버릇 컷으로 밀도를 높이고, 평탄·정직한 톤 + 누적 자막으로 또박또박.',
    commands: [
      { type: 'removeFillers' },
      {
        type: 'replaceSubtitleStyle',
        style: {
          color: '#ffffff',
          bg: 'rgba(0,0,0,0.42)',
          stroke: 'rgba(0,0,0,0.85)',
          strokeWidth: 9,
          fontFamily: CJK,
          fontWeight: '700',
          fontScale: 0.38,
          emphasisColor: '#ffe14d',
          animation: 'reveal',
        },
      },
      { type: 'applyColorgrade', preset: 'flat', intensity: 0.5 },
    ],
  },
];

/** id로 스타일 팩 조회(없으면 undefined). */
export function stylePackById(id: string): StylePack | undefined {
  return STYLE_PACKS.find((p) => p.id === id);
}
