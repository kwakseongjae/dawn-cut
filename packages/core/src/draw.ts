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

/** Bottom-bar subtitle card (translucent bar + outlined white text). */
export function drawSubtitle(ctx: DrawCtx, w: number, h: number, text: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(8, Math.round(h * 0.27), w - 16, Math.round(h * 0.64), 16);
  ctx.fill();
  ctx.font = `bold ${Math.round(h * 0.35)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, w / 2, h * 0.6, w - 60);
  ctx.fillStyle = '#fff';
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
