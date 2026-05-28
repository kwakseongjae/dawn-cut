import { describe, expect, it } from 'vitest';
import { SUBTITLE_PRESETS } from './draw.js';

describe('SUBTITLE_PRESETS', () => {
  it('exposes the documented preset ids', () => {
    expect(Object.keys(SUBTITLE_PRESETS).sort()).toEqual(
      ['cinematic', 'default', 'highlight', 'korean', 'podcast', 'tiktok'].sort(),
    );
  });

  it('korean preset prefers CJK fonts before falling back to system', () => {
    const p = SUBTITLE_PRESETS.korean!;
    expect(p.fontFamily?.toLowerCase()).toMatch(/apple sd gothic|pretendard|noto|malgun/);
  });

  it('tiktok preset is bold, outlined, no bg (the recognizable look)', () => {
    const p = SUBTITLE_PRESETS.tiktok!;
    expect(p.bg).toBe('transparent');
    expect(p.strokeWidth ?? 0).toBeGreaterThan(6);
    expect(p.fontFamily?.toLowerCase()).toContain('impact');
  });

  it('default preset is empty so renderer uses built-in defaults', () => {
    expect(SUBTITLE_PRESETS.default).toEqual({});
  });
});
