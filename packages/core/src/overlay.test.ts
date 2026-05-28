import { describe, expect, it } from 'vitest';
import { buildOverlayFilter, validateOverlays } from './overlay.js';
import type { OverlayClip } from './types.js';

const ov = (p: Partial<OverlayClip>): OverlayClip => ({
  id: 'o1',
  kind: 'image',
  src: '/x/a.png',
  x: 0,
  y: 0,
  scale: 0.25,
  opacity: 1,
  startUs: 0,
  endUs: 1_000_000,
  z: 0,
  ...p,
});

describe('buildOverlayFilter', () => {
  it('no overlays → passthrough base label', () => {
    const r = buildOverlayFilter('v', [], 1280, 720, 1);
    expect(r.inputs).toEqual([]);
    expect(r.filter).toBe('');
    expect(r.out).toBe('[v]');
  });

  it('static overlay → constant scale/position expressions, enable range', () => {
    const r = buildOverlayFilter(
      'v',
      [ov({ x: 0.5, y: 0.25, scale: 0.25, opacity: 0.8, startUs: 0, endUs: 2_000_000 })],
      1280,
      720,
      1,
    );
    expect(r.inputs).toEqual(['/x/a.png']);
    // wPx = 0.25*1280 = 320; xPx=640; yPx=180
    expect(r.filter).toContain("[1:v]scale=w='320':h=-1,format=rgba,colorchannelmixer=aa=0.8[ov0]");
    expect(r.filter).toContain(
      "[v][ov0]overlay=x='640':y='180':enable='between(t,0.000,2.000)'[vo0]",
    );
    expect(r.out).toBe('[vo0]');
  });

  it('animated overlay (to.x/y) → time-varying overlay expressions with eval=frame', () => {
    const r = buildOverlayFilter(
      'v',
      [ov({ x: 0.05, y: 0.5, scale: 0.2, startUs: 0, endUs: 4_000_000, to: { x: 0.7 } })],
      1000,
      1000,
      1,
    );
    // x lerps 50 → 700 over [0,4]s; y stays 500
    expect(r.filter).toContain("x='50+(700-50)*clip((t-0.000)/(4.000-0.000),0,1)'");
    expect(r.filter).toContain("y='500'");
    expect(r.filter).toContain(':eval=frame[vo0]');
  });

  it('animated scale (to.scale) emits scale eval=frame', () => {
    const r = buildOverlayFilter(
      'v',
      [ov({ scale: 0.2, startUs: 0, endUs: 2_000_000, to: { scale: 0.5 } })],
      1000,
      1000,
      1,
    );
    expect(r.filter).toContain("scale=w='200+(500-200)*clip((t-0.000)/(2.000-0.000),0,1)'");
    expect(r.filter).toContain(':eval=frame,format=rgba');
  });

  it('rotation adds a rotate filter before alpha', () => {
    const r = buildOverlayFilter('v', [ov({ rotation: 90 })], 1000, 1000, 1);
    expect(r.filter).toContain('rotate=');
    expect(r.filter).toContain(':c=none:ow=rotw(');
  });

  it('multiple overlays composite in z-order, chaining labels', () => {
    const r = buildOverlayFilter(
      'v',
      [ov({ id: 'top', z: 5 }), ov({ id: 'bot', z: 1 })],
      1000,
      1000,
      2,
    );
    expect(r.inputs).toEqual(['/x/a.png', '/x/a.png']);
    expect(r.filter).toContain("[2:v]scale=w='250'");
    expect(r.filter).toContain("[3:v]scale=w='250'");
    expect(r.filter).toContain('[v][ov0]overlay');
    expect(r.filter).toContain('[vo0][ov1]overlay');
    expect(r.out).toBe('[vo1]');
  });
});

describe('validateOverlays (OVL-INV)', () => {
  it('valid overlay passes', () => {
    expect(validateOverlays([ov({})], 5_000_000)).toEqual([]);
  });
  it('OVL-INV-1: out-of-range x', () => {
    expect(
      validateOverlays([ov({ x: 1.4 })], 5_000_000).some((e) => e.startsWith('OVL-INV-1')),
    ).toBe(true);
  });
  it('OVL-INV-2: time beyond program', () => {
    expect(
      validateOverlays([ov({ startUs: 0, endUs: 9_000_000 })], 5_000_000).some((e) =>
        e.startsWith('OVL-INV-2'),
      ),
    ).toBe(true);
  });
});
