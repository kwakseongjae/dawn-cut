/**
 * Pure drawing primitives — work on any CanvasRenderingContext2D-compatible
 * context (DOM canvas in the renderer, @napi-rs/canvas in headless tests).
 * No DOM/node imports → core stays portable; the SAME code paths produce the
 * same pixels in the editor preview and in automated pixel-verification.
 */

/** Minimal Canvas 2D surface dawn-cut's drawing helpers need. */
export interface DrawCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  beginPath(): void;
  roundRect(x: number, y: number, w: number, h: number, radii: number | number[]): void;
  fill(): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
}

/** Named presets for common social-video caption looks. */
export const SUBTITLE_PRESETS: Record<string, SubtitleStyle> = {
  default: {},
  tiktok: {
    color: '#ffffff',
    bg: 'transparent',
    stroke: 'rgba(0,0,0,0.95)',
    strokeWidth: 10,
    fontFamily: 'Impact, sans-serif',
    fontScale: 0.55,
  },
  podcast: {
    color: '#ffffff',
    bg: 'rgba(0,0,0,0.75)',
    stroke: '',
    fontFamily: 'system-ui, sans-serif',
    fontScale: 0.32,
  },
  cinematic: {
    color: '#f4e9c1',
    bg: 'transparent',
    stroke: 'rgba(0,0,0,0.9)',
    strokeWidth: 4,
    fontFamily: 'Georgia, serif',
    fontWeight: 'normal',
    fontScale: 0.38,
  },
  highlight: {
    color: '#111111',
    bg: 'rgba(255,235,59,0.95)',
    stroke: '',
    fontFamily: 'system-ui, sans-serif',
    fontScale: 0.42,
  },
  korean: {
    color: '#ffffff',
    bg: 'rgba(0,0,0,0.65)',
    stroke: 'rgba(0,0,0,0.8)',
    strokeWidth: 5,
    // Apple SD Gothic Neo first (macOS), Pretendard / Noto common on Linux/Win.
    fontFamily:
      '"Apple SD Gothic Neo", "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif',
    fontScale: 0.38,
  },
  // 한국어 '쇼츠형' 자막: 크고 굵은 글씨 + 두꺼운 외곽선 + 가벼운 배경(밝은 화면에서도 가독) +
  // 키워드 노란 강조. tiktok 프리셋(Impact)은 한글 글리프가 없어 두부(□)가 되므로 CJK 폰트로 둔다.
  // 짧은 cue(한 줄, 2~4어절)와 함께 써야 큰 글씨가 캔버스에 안 잘린다.
  koreanShorts: {
    color: '#ffffff',
    bg: 'rgba(0,0,0,0.32)',
    stroke: 'rgba(0,0,0,0.92)',
    strokeWidth: 12,
    fontFamily:
      '"Apple SD Gothic Neo", "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif',
    fontWeight: '800',
    fontScale: 0.46,
    emphasisColor: '#ffe14d',
  },
  // ── 추가 룩(데이터만; drawSubtitle 파라미터 조합). 모두 CJK 폰트 체인으로 한글 두부 방지. ──
  // 유튜브식 굵은 흰 글씨 + 아주 두꺼운 검정 외곽선, 배경 없음.
  youtubeBold: {
    color: '#ffffff',
    bg: 'transparent',
    stroke: 'rgba(0,0,0,0.95)',
    strokeWidth: 14,
    fontFamily:
      '"Apple SD Gothic Neo", "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif',
    fontWeight: '800',
    fontScale: 0.5,
  },
  // 예능 자막: 불투명 노란 바 + 검정 굵은 글씨.
  varietyYellow: {
    color: '#111111',
    bg: 'rgba(255,225,77,0.96)',
    stroke: '',
    fontFamily:
      '"Apple SD Gothic Neo", "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif',
    fontWeight: '800',
    fontScale: 0.4,
  },
  // 미니멀: 배경 없음, 가는 글씨, 얇은 외곽선만.
  minimal: {
    color: '#ffffff',
    bg: 'transparent',
    stroke: 'rgba(0,0,0,0.6)',
    strokeWidth: 3,
    fontFamily:
      '"Apple SD Gothic Neo", "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif',
    fontWeight: 'normal',
    fontScale: 0.34,
  },
  // 네온: 밝은 시안 글씨 + 굵은 어두운 외곽선으로 글로우 '근사'(진짜 glow 아님) + 형광 강조.
  neon: {
    color: '#39f3ff',
    bg: 'transparent',
    stroke: 'rgba(8,20,40,0.95)',
    strokeWidth: 11,
    fontFamily:
      '"Apple SD Gothic Neo", "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif',
    fontWeight: '800',
    fontScale: 0.44,
    emphasisColor: '#ff4df0',
  },
  // 자막바: 불투명 어두운 바 + 흰 글씨(다큐/뉴스식 하단바).
  captionBar: {
    color: '#ffffff',
    bg: 'rgba(0,0,0,0.82)',
    stroke: '',
    fontFamily:
      '"Apple SD Gothic Neo", "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif',
    fontWeight: '600',
    fontScale: 0.32,
  },
};
export type SubtitlePresetId = keyof typeof SUBTITLE_PRESETS;

/** 자막 프리셋 갤러리용 메타(한국어 라벨 + 대표 미리보기 텍스트). 순서 = 갤러리 표시 순서. */
export const PRESET_META: { id: SubtitlePresetId; label: string; sample: string }[] = [
  { id: 'default', label: '기본', sample: '기본 자막' },
  { id: 'koreanShorts', label: '쇼츠', sample: '핵심 강조!' },
  { id: 'youtubeBold', label: '유튜브', sample: '굵은 자막' },
  { id: 'varietyYellow', label: '예능', sample: '리액션 자막' },
  { id: 'captionBar', label: '자막바', sample: '하단 자막바' },
  { id: 'neon', label: '네온', sample: '네온 강조' },
  { id: 'minimal', label: '미니멀', sample: '미니멀 자막' },
  { id: 'cinematic', label: '시네마', sample: '시네마틱' },
  { id: 'highlight', label: '형광펜', sample: '하이라이트' },
  { id: 'podcast', label: '팟캐스트', sample: '팟캐스트 자막' },
  { id: 'tiktok', label: '틱톡', sample: 'CAPTION' },
  { id: 'korean', label: '한국어', sample: '한국어 자막' },
];

/** Subtitle styling — defaults reproduce the original translucent-bar look. */
export interface SubtitleStyle {
  color?: string; // text fill (default '#fff')
  bg?: string; // background bar (default 'rgba(0,0,0,0.55)'; '' or 'transparent' = none)
  stroke?: string; // text outline (default 'rgba(0,0,0,0.85)'; '' = none)
  strokeWidth?: number; // px at canvas resolution (default 6)
  fontFamily?: string; // default 'system-ui, sans-serif'
  fontWeight?: string; // default 'bold'
  fontScale?: number; // fraction of canvas height for font size (default 0.35)
  emphasisColor?: string; // keyword highlight fill (default '#ffd54f'); used only when `emphasis` words are given
  // 키워드 강조 자막 on/off. on이면 렌더러가 pickKeywords로 핵심 어절을 골라 emphasisColor로
  // 강조한다(자연어 "핵심 강조해줘" → highlightKeyword verb가 이 필드를 켠다). EditorState에
  // 실려 command bus·MCP가 구동 가능(기존 UI-only boolean을 대체).
  emphasizeKeywords?: boolean;
  // 자막 애니메이션(어절 단위). none=정적, reveal=누적 등장, karaoke=현재 어절 강조.
  // drawSubtitle 자체는 정적 1프레임을 그린다; 애니메이션은 subtitles.captionFrames가 cue를
  // 다중 프레임으로 펼치고 렌더러가 각 프레임을 이 함수로 래스터화해 합성한다.
  animation?: 'none' | 'reveal' | 'karaoke' | 'typewriter' | 'pop';
}

const STRIP_PUNCT_RE = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/**
 * Bottom-bar subtitle card (translucent bar + outlined white text by default; style-able).
 * `emphasis` = surface forms of eojeol to highlight in `style.emphasisColor` (키워드 강조 자막).
 * When empty/undefined the original single-run centered render is used (backward compatible).
 */
export function drawSubtitle(
  ctx: DrawCtx,
  w: number,
  h: number,
  text: string,
  style: SubtitleStyle = {},
  emphasis?: ReadonlySet<string>,
): void {
  const bg = style.bg ?? 'rgba(0,0,0,0.55)';
  const color = style.color ?? '#fff';
  const stroke = style.stroke ?? 'rgba(0,0,0,0.85)';
  const strokeWidth = style.strokeWidth ?? 6;
  const family = style.fontFamily ?? 'system-ui, sans-serif';
  const weight = style.fontWeight ?? 'bold';
  const fontScale = style.fontScale ?? 0.35;

  // 폰트를 먼저 지정해야 measureText가 정확하다.
  const fontSize = Math.round(h * fontScale);
  ctx.font = `${weight} ${fontSize}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 멀티라인: '\n'으로 분리해 세로 중앙(h*0.6) 기준으로 줄들을 쌓는다.
  const lines = text.split('\n');
  const lineH = Math.round(fontSize * 1.3);
  const cy = h * 0.6;
  const startY = cy - ((lines.length - 1) * lineH) / 2;

  // 배경 박스는 고정 풀폭 바가 아니라 '텍스트에 맞춰(hug)' 그린다 — 가장 긴 줄
  // 너비 + 좌우 패딩만큼만. 짧은 자막에서 박스가 휑하게 커지던 문제를 해결.
  if (bg && bg !== 'transparent') {
    let maxLineW = 0;
    for (const line of lines) {
      const m = ctx.measureText(line).width;
      if (m > maxLineW) maxLineW = m;
    }
    const padX = Math.round(fontSize * 0.5);
    const padY = Math.round(fontSize * 0.34);
    const boxW = Math.min(w - 8, Math.round(maxLineW) + padX * 2);
    const boxH = lines.length * lineH + padY * 2;
    const boxX = Math.round((w - boxW) / 2);
    const boxY = Math.round(cy - (lines.length * lineH) / 2 - padY);
    const radius = Math.round(Math.min(boxH / 2, fontSize * 0.45));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, radius);
    ctx.fill();
  }

  const emColor = style.emphasisColor ?? '#ffd54f';
  const hasEmphasis = emphasis !== undefined && emphasis.size > 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const ly = startY + i * lineH;
    if (!hasEmphasis) {
      // 기존 경로: 줄 전체를 중앙 정렬 단일 렌더(역호환 — 픽셀 테스트 보존).
      if (stroke && strokeWidth > 0) {
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = stroke;
        ctx.strokeText(line, w / 2, ly, w - 60);
      }
      ctx.fillStyle = color;
      ctx.fillText(line, w / 2, ly, w - 60);
      continue;
    }
    // 키워드 강조: 어절별로 색을 달리 칠한다(좌측 누적 배치로 줄을 중앙 정렬).
    const wordsInLine = line.split(' ');
    const spaceW = ctx.measureText(' ').width;
    const widths = wordsInLine.map((wd) => ctx.measureText(wd).width);
    const totalW = widths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, wordsInLine.length - 1);
    let x = w / 2 - totalW / 2;
    ctx.textAlign = 'left';
    for (let j = 0; j < wordsInLine.length; j++) {
      const wd = wordsInLine[j] ?? '';
      const isKey = emphasis.has(wd.replace(STRIP_PUNCT_RE, ''));
      if (stroke && strokeWidth > 0) {
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = stroke;
        ctx.strokeText(wd, x, ly);
      }
      ctx.fillStyle = isKey ? emColor : color;
      ctx.fillText(wd, x, ly);
      x += (widths[j] ?? 0) + spaceW;
    }
    ctx.textAlign = 'center';
  }
}

/** Centered color-emoji glyph on transparent background. */
export function drawEmoji(ctx: DrawCtx, w: number, h: number, emoji: string): void {
  ctx.font = `${Math.round(h * 0.78)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(emoji, w / 2, h * 0.54);
}

/** Trending-GIF style pill: rounded indigo bar with white bold text. */
export function drawBadge(ctx: DrawCtx, w: number, h: number, text: string): void {
  ctx.fillStyle = '#6c8cff';
  ctx.beginPath();
  ctx.roundRect(8, Math.round(h * 0.19), w - 16, Math.round(h * 0.63), Math.round(h * 0.18));
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(h * 0.4)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h * 0.51);
}
