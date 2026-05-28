import type { OverlayClip } from './types.js';

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Move an overlay by a normalized delta, keeping it within the frame. */
export function moveOverlay<T extends Pick<OverlayClip, 'x' | 'y' | 'scale'>>(
  o: T,
  dxNorm: number,
  dyNorm: number,
): T {
  return { ...o, x: clamp(o.x + dxNorm, 0, 1 - o.scale), y: clamp(o.y + dyNorm, 0, 1) };
}

/** Resize an overlay (scale = width fraction), clamped to (0.03, 1] and inside frame. */
export function resizeOverlay<T extends Pick<OverlayClip, 'x' | 'scale'>>(
  o: T,
  dScaleNorm: number,
): T {
  const scale = clamp(o.scale + dScaleNorm, 0.03, 1);
  return { ...o, scale, x: clamp(o.x, 0, 1 - scale) };
}

/** Clamp a time range to [0, durationProgram] with start < end. */
export function clampRange(
  startUs: number,
  endUs: number,
  durationUs: number,
): { startUs: number; endUs: number } {
  const e = clamp(endUs, 1, durationUs);
  const s = clamp(startUs, 0, e - 1);
  return { startUs: s, endUs: e };
}
