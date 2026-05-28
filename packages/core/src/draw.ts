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
};
export type SubtitlePresetId = keyof typeof SUBTITLE_PRESETS;

/** Subtitle styling — defaults reproduce the original translucent-bar look. */
export interface SubtitleStyle {
  color?: string; // text fill (default '#fff')
  bg?: string; // background bar (default 'rgba(0,0,0,0.55)'; '' or 'transparent' = none)
  stroke?: string; // text outline (default 'rgba(0,0,0,0.85)'; '' = none)
  strokeWidth?: number; // px at canvas resolution (default 6)
  fontFamily?: string; // default 'system-ui, sans-serif'
  fontWeight?: string; // default 'bold'
  fontScale?: number; // fraction of canvas height for font size (default 0.35)
}

/** Bottom-bar subtitle card (translucent bar + outlined white text by default; style-able). */
export function drawSubtitle(
  ctx: DrawCtx,
  w: number,
  h: number,
  text: string,
  style: SubtitleStyle = {},
): void {
  const bg = style.bg ?? 'rgba(0,0,0,0.55)';
  const color = style.color ?? '#fff';
  const stroke = style.stroke ?? 'rgba(0,0,0,0.85)';
  const strokeWidth = style.strokeWidth ?? 6;
  const family = style.fontFamily ?? 'system-ui, sans-serif';
  const weight = style.fontWeight ?? 'bold';
  const fontScale = style.fontScale ?? 0.35;

  if (bg && bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(8, Math.round(h * 0.27), w - 16, Math.round(h * 0.64), 16);
    ctx.fill();
  }
  ctx.font = `${weight} ${Math.round(h * fontScale)}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (stroke && strokeWidth > 0) {
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, w / 2, h * 0.6, w - 60);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h * 0.6, w - 60);
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
