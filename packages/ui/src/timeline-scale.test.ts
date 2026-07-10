import { describe, expect, it } from 'vitest';
import { chooseTickStep, fmtTick, rulerTicks } from './timeline-scale';

describe('chooseTickStep', () => {
  it('빈 입력(길이·폭 0 이하)은 0', () => {
    expect(chooseTickStep(0, 800)).toBe(0);
    expect(chooseTickStep(10_000_000, 0)).toBe(0);
  });
  it('폭이 넓어질수록(=줌 인) 간격은 단조 감소하거나 같다', () => {
    const dur = 60_000_000; // 60s
    let prev = Number.POSITIVE_INFINITY;
    for (const px of [200, 400, 800, 1600, 3200, 6400]) {
      const step = chooseTickStep(dur, px);
      expect(step).toBeLessThanOrEqual(prev);
      prev = step;
    }
  });
  it('8s/800px(전체 맞춤)이면 1s 간격', () => {
    // usPerPx=10000 → 최소간격 720ms → 사다리에서 1s
    expect(chooseTickStep(8_000_000, 800)).toBe(1_000_000);
  });
  it('아주 긴 영상도 사다리 상한(10m)으로 캡', () => {
    expect(chooseTickStep(4 * 3600 * 1e6, 300)).toBe(600_000_000);
  });
});

describe('fmtTick', () => {
  it('기본 M:SS', () => {
    expect(fmtTick(0, 1_000_000)).toBe('0:00');
    expect(fmtTick(65_000_000, 5_000_000)).toBe('1:05');
  });
  it('1s 미만 간격이면 소수 1자리', () => {
    expect(fmtTick(500_000, 500_000)).toBe('0:00.5');
  });
  it('1시간 넘으면 H:MM:SS', () => {
    expect(fmtTick(3_723_000_000, 60_000_000)).toBe('1:02:03');
  });
});

describe('rulerTicks', () => {
  it('주눈금엔 라벨, 보조눈금엔 없음 — 시작은 0:00', () => {
    const ticks = rulerTicks(8_000_000, 800); // step=1s
    expect(ticks[0]).toMatchObject({ us: 0, major: true, label: '0:00' });
    expect(ticks.some((t) => !t.major && t.label === undefined)).toBe(true);
    for (const t of ticks) {
      if (t.major) expect(t.label).toBeTruthy();
      else expect(t.label).toBeUndefined();
    }
  });
  it('duration을 넘는 틱 없음 + 결정적', () => {
    const a = rulerTicks(8_000_000, 800);
    const b = rulerTicks(8_000_000, 800);
    expect(a).toEqual(b);
    expect(a.every((t) => t.us <= 8_000_000)).toBe(true);
  });
  it('보조눈금이 너무 촘촘하면(8px 미만) 주눈금만', () => {
    const ticks = rulerTicks(4 * 3600 * 1e6, 300); // 4시간/300px → minor 2.5px
    expect(ticks.every((t) => t.major)).toBe(true);
  });
  it('틱 수는 폭 대비 상식적(주눈금 간 최소 px 보장)', () => {
    const px = 1200;
    const ticks = rulerTicks(30_000_000, px);
    const majors = ticks.filter((t) => t.major);
    expect(majors.length).toBeGreaterThan(2);
    expect(majors.length).toBeLessThanOrEqual(Math.ceil(px / 72) + 1);
  });
});
