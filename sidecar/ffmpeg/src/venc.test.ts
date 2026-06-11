import { describe, expect, it } from 'vitest';
import { crfForQuality, vencArgs, vtbQualityForCrf } from './index.js';

describe('H.264 인코더 폴백(issue #19) — 순수 헬퍼', () => {
  it('libx264는 CRF 그대로, videotoolbox는 -q:v 매핑', () => {
    expect(vencArgs('libx264', 23)).toEqual(['-c:v', 'libx264', '-crf', '23']);
    const vtb = vencArgs('h264_videotoolbox', 23);
    expect(vtb.slice(0, 2)).toEqual(['-c:v', 'h264_videotoolbox']);
    expect(Number(vtb[3])).toBeGreaterThan(30);
  });

  it('vtb 품질 매핑은 단조감소(CRF↑=품질↓ → q↓)이고 30~85로 클램프', () => {
    const q18 = Number(vtbQualityForCrf(18));
    const q23 = Number(vtbQualityForCrf(23));
    const q28 = Number(vtbQualityForCrf(28));
    expect(q18).toBeGreaterThan(q23);
    expect(q23).toBeGreaterThan(q28);
    for (const q of [q18, q23, q28]) {
      expect(q).toBeGreaterThanOrEqual(30);
      expect(q).toBeLessThanOrEqual(85);
    }
  });

  it('품질 프리셋 CRF는 기존 계약 유지(18/23/28)', () => {
    expect(crfForQuality('high')).toBe('18');
    expect(crfForQuality('medium')).toBe('23');
    expect(crfForQuality('small')).toBe('28');
  });
});
