import { easeExpr } from './easing.js';
import type { OverlayClip } from './types.js';

export interface OverlayFilter {
  /** overlay source paths, in ffmpeg `-i` order (append after base inputs). */
  inputs: string[];
  /** filter_complex fragment to append after the base video label is produced. */
  filter: string;
  /** final video label to -map (e.g. '[vout]' or the untouched base if no overlays). */
  out: string;
}

const t = (us: number) => (us / 1_000_000).toFixed(3);

/**
 * Build the overlay portion of a filter_complex graph. Overlays are scaled,
 * opacity-adjusted, and composited onto `baseLabel` in z-order, each gated to
 * its program time range. Pure + deterministic → unit-tested. (PLAN §4)
 *
 * Coordinate mapping MUST match the CSS preview: xPx=round(x*W), yPx=round(y*H),
 * wPx=round(scale*W), height auto (-1).
 */
export function buildOverlayFilter(
  baseLabel: string, // e.g. 'v' for the concat output [v]
  overlays: OverlayClip[],
  frameW: number,
  frameH: number,
  firstInputIndex: number, // ffmpeg input index of the first overlay (-i)
): OverlayFilter {
  const ordered = [...overlays].sort((a, b) => a.z - b.z);
  if (ordered.length === 0) return { inputs: [], filter: '', out: `[${baseLabel}]` };

  const inputs: string[] = [];
  const sourceParts: string[] = []; // e.g. transparent canvases for blend mode
  const scaleParts: string[] = [];
  const overlayParts: string[] = [];
  let prev = baseLabel;

  ordered.forEach((o, i) => {
    const inputIdx = firstInputIndex + i;
    inputs.push(o.src);
    const w0 = Math.max(2, Math.round(o.scale * frameW));
    const x0 = Math.round(o.x * frameW);
    const y0 = Math.round(o.y * frameH);
    const op = Math.min(1, Math.max(0, o.opacity));
    const t0 = t(o.startUs);
    const t1 = t(o.endUs);
    const dur = `(${t1}-${t0})`;
    const u = `clip((t-${t0})/${dur},0,1)`;
    const defaultEasing = o.to?.easing ?? 'linear';

    type Axis = 'x' | 'y' | 'scale';
    const pickKf = (k: NonNullable<OverlayClip['keyframes']>[number], a: Axis) =>
      a === 'x' ? k.x : a === 'y' ? k.y : k.scale;
    const toPxAxis = (n: number, a: Axis) =>
      a === 'scale'
        ? Math.max(2, Math.round(n * frameW))
        : a === 'x'
          ? Math.round(n * frameW)
          : Math.round(n * frameH);

    /** Build an ffmpeg expression for one axis. Honours `keyframes` (multi-point)
     *  if present, else `to` (2-point), else returns a constant. */
    const buildAxis = (axis: Axis, baseVal: number, toVal: number) => {
      if (o.keyframes?.length) {
        let last = baseVal;
        const sorted = [...o.keyframes].sort((a, b) => a.u - b.u);
        const pts: { u: number; v: number; easing: typeof defaultEasing }[] = [
          { u: 0, v: baseVal, easing: defaultEasing },
        ];
        for (const k of sorted) {
          const raw = pickKf(k, axis);
          const v = raw != null ? toPxAxis(raw, axis) : last;
          last = v;
          pts.push({ u: Math.max(0, Math.min(1, k.u)), v, easing: k.easing ?? defaultEasing });
        }
        if (pts.every((p) => p.v === pts[0]!.v)) return { expr: `${pts[0]!.v}`, animated: false };
        let expr = `${pts[pts.length - 1]!.v}`;
        for (let i = pts.length - 1; i >= 1; i--) {
          const a = pts[i - 1]!.v;
          const b = pts[i]!.v;
          const ua = pts[i - 1]!.u;
          const ub = pts[i]!.u;
          if (ub <= ua) continue;
          const seg = `((${u}-${ua})/(${ub}-${ua}))`;
          const eased = easeExpr(pts[i]!.easing, seg);
          expr = `if(lt(${u},${ub}),${a}+(${b}-${a})*${eased},${expr})`;
        }
        return { expr, animated: true };
      }
      if (baseVal === toVal) return { expr: `${baseVal}`, animated: false };
      const eased = easeExpr(defaultEasing, u);
      return { expr: `${baseVal}+(${toVal}-${baseVal})*${eased}`, animated: true };
    };

    // animated scale (width-expression) when `to.scale` differs from base
    const w1 = o.to?.scale != null ? Math.max(2, Math.round(o.to.scale * frameW)) : w0;
    const aw = buildAxis('scale', w0, w1);
    const wExpr = aw.expr;
    const needsScaleEval = aw.animated;
    const scaleEval = needsScaleEval ? ':eval=frame' : '';
    let scaleChain = `[${inputIdx}:v]scale=w='${wExpr}':h=-1${scaleEval}`;
    if (o.rotation && o.rotation !== 0) {
      const rad = ((o.rotation * Math.PI) / 180).toFixed(6);
      scaleChain += `,rotate=${rad}:c=none:ow=rotw(${rad}):oh=roth(${rad})`;
    }
    scaleChain += `,format=rgba,colorchannelmixer=aa=${op}[ov${i}]`;
    scaleParts.push(scaleChain);

    // animated position (x/y expressions)
    const x1 = o.to?.x != null ? Math.round(o.to.x * frameW) : x0;
    const y1 = o.to?.y != null ? Math.round(o.to.y * frameH) : y0;
    const ax = buildAxis('x', x0, x1);
    const ay = buildAxis('y', y0, y1);
    const xExpr = ax.expr;
    const yExpr = ay.expr;
    const animatedPos = ax.animated || ay.animated;

    const next = `vo${i}`;
    const posEval = animatedPos ? ':eval=frame' : '';
    const blend = o.blend && o.blend !== 'normal' ? o.blend : null;
    if (!blend) {
      overlayParts.push(
        `[${prev}][ov${i}]overlay=x='${xExpr}':y='${yExpr}':enable='between(t,${t0},${t1})'${posEval}[${next}]`,
      );
    } else {
      // Compose overlay onto a transparent base-sized canvas, then blend with prev.
      // Transparent areas yield 0 contribution under every implemented blend mode.
      sourceParts.push(`color=c=0x00000000:s=${frameW}x${frameH}[bg${i}]`);
      overlayParts.push(
        `[bg${i}][ov${i}]overlay=x='${xExpr}':y='${yExpr}':format=auto${posEval}[lay${i}]`,
        `[${prev}][lay${i}]blend=all_mode=${blend}:shortest=1:enable='between(t,${t0},${t1})'[${next}]`,
      );
    }
    prev = next;
  });

  const filterParts: string[] = [];
  if (sourceParts.length) filterParts.push(sourceParts.join(';'));
  filterParts.push(scaleParts.join(';'));
  filterParts.push(overlayParts.join(';'));
  return { inputs, filter: filterParts.join(';'), out: `[${prev}]` };
}

/** Returns OVL-INV violations ([] == valid). */
export function validateOverlays(overlays: OverlayClip[], durationProgram: number): string[] {
  const errors: string[] = [];
  for (const o of overlays) {
    if (o.x < 0 || o.x > 1 || o.y < 0 || o.y > 1)
      errors.push(`OVL-INV-1: ${o.id} x/y out of [0,1]`);
    if (o.scale <= 0 || o.scale > 1) errors.push(`OVL-INV-1: ${o.id} scale out of (0,1]`);
    if (o.opacity < 0 || o.opacity > 1) errors.push(`OVL-INV-1: ${o.id} opacity out of [0,1]`);
    if (!(o.startUs >= 0 && o.startUs < o.endUs && o.endUs <= durationProgram)) {
      errors.push(
        `OVL-INV-2: ${o.id} time range invalid (${o.startUs}..${o.endUs} / ${durationProgram})`,
      );
    }
  }
  return errors;
}
