import { describe, expect, it } from 'vitest';
import { filmstripSlices, peakSlice, wavePathD } from './timeline-visuals';

describe('filmstripSlices', () => {
  it('빈 입력은 []', () => {
    expect(filmstripSlices(0, 8, 0, 8e6)).toEqual([]);
    expect(filmstripSlices(1e6, 0, 0, 8e6)).toEqual([]);
    expect(filmstripSlices(1e6, 8, 5e6, 5e6)).toEqual([]);
  });
  it('전체 클립(0~8s, 1s 썸네일 8장) = 조각 8개, 각 12.5%', () => {
    const s = filmstripSlices(1e6, 8, 0, 8e6);
    expect(s).toHaveLength(8);
    expect(s[0]).toMatchObject({ index: 0, leftPct: 0 });
    expect(s[7]!.index).toBe(7);
    for (const f of s) expect(f.widthPct).toBeCloseTo(12.5, 5);
  });
  it('중간 컷 클립(2.5s~5.5s): 경계 썸네일은 음수 left로 삐져나온다(크롭 전제)', () => {
    const s = filmstripSlices(1e6, 8, 2_500_000, 5_500_000);
    expect(s.map((f) => f.index)).toEqual([2, 3, 4, 5]);
    expect(s[0]!.leftPct).toBeLessThan(0); // 2s 썸네일이 -16.7%부터
    expect(s[s.length - 1]!.leftPct).toBeLessThan(100);
  });
  it('썸네일 개수를 넘는 소스 구간은 마지막 썸네일까지만', () => {
    const s = filmstripSlices(1e6, 3, 0, 8e6);
    expect(s.map((f) => f.index)).toEqual([0, 1, 2]);
  });
});

describe('peakSlice', () => {
  const peaks = Array.from({ length: 160 }, (_, i) => (i % 20) / 20); // 8s @ 20pps
  it('전체 구간 = 그대로', () => {
    expect(peakSlice(peaks, 20, 0, 8e6)).toHaveLength(160);
  });
  it('부분 구간(1s~3s) = 40개', () => {
    const s = peakSlice(peaks, 20, 1e6, 3e6);
    expect(s).toHaveLength(40);
    expect(s[0]).toBe(peaks[20]);
  });
  it('maxPoints 다운샘플은 구간 max 보존(평균 아님)', () => {
    const spiky = Array.from({ length: 1000 }, (_, i) => (i === 500 ? 1 : 0.01));
    const s = peakSlice(spiky, 20, 0, 50e6, 100);
    expect(s).toHaveLength(100);
    expect(Math.max(...s)).toBe(1); // 스파이크 생존
  });
  it('빈/역구간은 []', () => {
    expect(peakSlice([], 20, 0, 1e6)).toEqual([]);
    expect(peakSlice(peaks, 20, 3e6, 1e6)).toEqual([]);
  });
});

describe('wavePathD', () => {
  it('빈 피크 = 빈 문자열', () => {
    expect(wavePathD([])).toBe('');
  });
  it('중앙(y=1) 대칭 닫힌 path, 무음도 최소 진폭', () => {
    const d = wavePathD([0, 0.5, 1]);
    expect(d.startsWith('M0 1')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('L1 0.500'); // 위 0.5
    expect(d).toContain('L1 1.500'); // 아래 0.5 (대칭)
    expect(d).toContain('L0 0.960'); // 무음 최소 심지 0.04
  });
});
