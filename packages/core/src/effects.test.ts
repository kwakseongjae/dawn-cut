import { describe, expect, it } from 'vitest';
import {
  COLOR_PRESETS,
  type ColorEffect,
  type ZoomEffect,
  colorFilter,
  effectFilter,
  zoomFilter,
} from './effects.js';

const FPS = 30;

const zoom = (over: Partial<ZoomEffect> = {}): ZoomEffect => ({
  kind: 'zoom',
  from: 1,
  to: 1.3,
  startUs: 0,
  endUs: 1_000_000,
  ...over,
});

describe('zoomFilter', () => {
  it('emits a zoompan filter with z/x/y/d/fps tokens', () => {
    const s = zoomFilter(zoom(), FPS);
    expect(s.startsWith('zoompan=')).toBe(true);
    expect(s).toContain("z='");
    expect(s).toContain("x='");
    expect(s).toContain("y='");
    expect(s).toContain('d=1');
    expect(s).toContain(`fps=${FPS}`);
  });

  it('interpolates from→to linearly via on/(D-1) progress', () => {
    // 1s @ 30fps = 30 frames -> D-1 = 29
    const s = zoomFilter(zoom({ from: 1, to: 1.3 }), FPS);
    expect(s).toContain('min(on,29)/29');
    expect(s).toContain('1.0000');
    expect(s).toContain('1.3000');
  });

  it('keeps the zoom centered (iw/ih midpoint formulas)', () => {
    const s = zoomFilter(zoom(), FPS);
    expect(s).toContain('(iw-iw/zoom)/2');
    expect(s).toContain('(ih-ih/zoom)/2');
  });

  it('boundary: from===to yields a constant z (no interpolation term)', () => {
    const s = zoomFilter(zoom({ from: 1.5, to: 1.5 }), FPS);
    expect(s).toContain("z='1.5000'");
    expect(s).not.toContain('min(on');
  });

  it('boundary: clamps multipliers below 1 up to 1 (no black borders)', () => {
    const s = zoomFilter(zoom({ from: 0.5, to: 0.2 }), FPS);
    // both clamp to 1 -> static 1.0
    expect(s).toContain("z='1.0000'");
  });

  it('boundary: clamps multipliers above 8x to 8', () => {
    const s = zoomFilter(zoom({ from: 100, to: 200 }), FPS);
    expect(s).toContain('8.0000');
    expect(s).not.toContain('100');
    expect(s).not.toContain('200');
  });

  it('supports zoom-out (from>to): interpolation present, descends', () => {
    const s = zoomFilter(zoom({ from: 2, to: 1 }), FPS);
    expect(s).toContain('2.0000');
    expect(s).toContain('1.0000');
    expect(s).toContain('min(on,29)/29');
  });

  it('guard: zero/negative duration → static single-frame zoom (no div-by-0)', () => {
    const s = zoomFilter(zoom({ from: 1, to: 1.3, startUs: 500, endUs: 500 }), FPS);
    // D=1 -> denom 0 -> constant from, no division
    expect(s).toContain("z='1.0000'");
    expect(s).not.toContain('/0');
    expect(s).not.toContain('min(on');
  });

  it('guard: very short duration where D-1 could be 0 stays finite', () => {
    // ~10ms @ 30fps rounds to 0 frames -> frames clamped to 1 -> D=1 static
    const s = zoomFilter(zoom({ from: 1, to: 2, startUs: 0, endUs: 10_000 }), FPS);
    expect(s).not.toContain('/0)');
    expect(s).toContain('zoompan=');
  });

  it('guard: invalid fps clamps into [1,1000]', () => {
    expect(zoomFilter(zoom(), 0)).toContain('fps=1');
    expect(zoomFilter(zoom(), -5)).toContain('fps=1');
    expect(zoomFilter(zoom(), 99999)).toContain('fps=1000');
    expect(zoomFilter(zoom(), Number.NaN)).toContain('fps=1');
  });

  it('is deterministic: same input → identical string', () => {
    expect(zoomFilter(zoom(), FPS)).toBe(zoomFilter(zoom(), FPS));
  });

  it('frame count scales with fps (60fps → D-1=59 over 1s)', () => {
    const s = zoomFilter(zoom(), 60);
    expect(s).toContain('min(on,59)/59');
  });
});

describe('COLOR_PRESETS', () => {
  it('defines all presets with eq or curves tokens', () => {
    const keys = Object.keys(COLOR_PRESETS).sort();
    expect(keys).toEqual(['cinematic', 'cool', 'flat', 'punch', 'vivid', 'warm']);
    for (const v of Object.values(COLOR_PRESETS)) {
      expect(v.includes('eq=') || v.includes('curves=')).toBe(true);
    }
  });

  it('warm uses curves; punch/flat use eq; cinematic uses both', () => {
    expect(COLOR_PRESETS.warm).toContain('curves=');
    expect(COLOR_PRESETS.cool).toContain('curves=');
    expect(COLOR_PRESETS.punch.startsWith('eq=')).toBe(true);
    expect(COLOR_PRESETS.flat.startsWith('eq=')).toBe(true);
    expect(COLOR_PRESETS.cinematic).toContain('eq=');
    expect(COLOR_PRESETS.cinematic).toContain('curves=');
  });
});

const color = (over: Partial<ColorEffect> = {}): ColorEffect => ({
  kind: 'color',
  preset: 'punch',
  ...over,
});

describe('colorFilter', () => {
  it('punch (eq) at full intensity hits documented full-strength values', () => {
    const s = colorFilter(color({ preset: 'punch', intensity: 1 }));
    expect(s).toContain('eq=');
    expect(s).toContain('contrast=1.3000');
    expect(s).toContain('saturation=1.4000');
    expect(s).toContain('brightness=0.0200');
  });

  it('intensity weights eq multiplicative params toward identity (1)', () => {
    const s = colorFilter(color({ preset: 'punch', intensity: 0.5 }));
    // contrast 1 + (1.3-1)*0.5 = 1.15 ; saturation 1 + (1.4-1)*0.5 = 1.20
    expect(s).toContain('contrast=1.1500');
    expect(s).toContain('saturation=1.2000');
    // brightness additive: 0.02*0.5 = 0.01
    expect(s).toContain('brightness=0.0100');
  });

  it('flat preset emits eq with contrast/saturation/gamma', () => {
    const s = colorFilter(color({ preset: 'flat', intensity: 1 }));
    expect(s).toContain('eq=');
    expect(s).toContain('contrast=0.8200');
    expect(s).toContain('saturation=0.7800');
    expect(s).toContain('gamma=1.0500');
  });

  it('cinematic emits eq + curves chained with a comma', () => {
    const s = colorFilter(color({ preset: 'cinematic', intensity: 1 }));
    expect(s).toContain('eq=');
    expect(s).toContain('curves=all=');
    expect(s.indexOf('eq=')).toBeLessThan(s.indexOf('curves='));
    expect(s).toContain(',curves=');
  });

  it('warm emits a curves tone curve (R/G up, B down at midpoint)', () => {
    const s = colorFilter(color({ preset: 'warm', intensity: 1 }));
    expect(s).toContain('curves=');
    expect(s).toContain("r='0/0 0.5/0.5800 1/1'");
    expect(s).toContain("b='0/0 0.5/0.4200 1/1'");
    expect(s).toContain("g='0/0 0.5/0.5 1/1'");
  });

  it('cool is the mirror of warm (B up, R down)', () => {
    const s = colorFilter(color({ preset: 'cool', intensity: 1 }));
    expect(s).toContain("r='0/0 0.5/0.4200 1/1'");
    expect(s).toContain("b='0/0 0.5/0.5800 1/1'");
  });

  it('warm/cool midpoint moves toward 0.5 as intensity drops', () => {
    const half = colorFilter(color({ preset: 'warm', intensity: 0.5 }));
    // r midpoint: 0.5 + (0.58-0.5)*0.5 = 0.54 ; b: 0.5 + (0.42-0.5)*0.5 = 0.46
    expect(half).toContain("r='0/0 0.5/0.5400 1/1'");
    expect(half).toContain("b='0/0 0.5/0.4600 1/1'");
  });

  it('guard: intensity defaults to 1 when omitted', () => {
    expect(colorFilter(color({ preset: 'punch' }))).toBe(
      colorFilter(color({ preset: 'punch', intensity: 1 })),
    );
  });

  it('guard: intensity<=0 returns identity passthrough (eq=contrast=1)', () => {
    expect(colorFilter(color({ preset: 'punch', intensity: 0 }))).toBe('eq=contrast=1');
    expect(colorFilter(color({ preset: 'warm', intensity: -3 }))).toBe('eq=contrast=1');
  });

  it('guard: intensity>1 clamps to 1', () => {
    expect(colorFilter(color({ preset: 'punch', intensity: 5 }))).toBe(
      colorFilter(color({ preset: 'punch', intensity: 1 })),
    );
  });

  it('guard: NaN intensity → passthrough', () => {
    expect(colorFilter(color({ preset: 'flat', intensity: Number.NaN }))).toBe('eq=contrast=1');
  });

  it('guard: unknown preset falls back to flat', () => {
    const bad = colorFilter({
      kind: 'color',
      preset: 'neon' as ColorEffect['preset'],
      intensity: 1,
    });
    expect(bad).toBe(colorFilter(color({ preset: 'flat', intensity: 1 })));
  });

  it('every preset at full intensity emits a non-empty eq/curves chain', () => {
    for (const preset of ['warm', 'cool', 'punch', 'cinematic', 'flat'] as const) {
      const s = colorFilter(color({ preset, intensity: 1 }));
      expect(s.length).toBeGreaterThan(0);
      expect(s.includes('eq=') || s.includes('curves=')).toBe(true);
    }
  });

  it('is deterministic: same input → identical string', () => {
    const c = color({ preset: 'cinematic', intensity: 0.7 });
    expect(colorFilter(c)).toBe(colorFilter(c));
  });
});

describe('effectFilter dispatch', () => {
  it('routes zoom → zoomFilter', () => {
    const e = zoom();
    expect(effectFilter(e, FPS)).toBe(zoomFilter(e, FPS));
  });

  it('routes color → colorFilter', () => {
    const e = color({ preset: 'punch', intensity: 0.5 });
    expect(effectFilter(e, FPS)).toBe(colorFilter(e));
  });
});
