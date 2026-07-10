import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { extractPeaks, extractThumbs, probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// B2 — 타임라인 필름스트립·파형 추출(실 ffmpeg). fixture: ~8s, 30fps, 발화+무음 2구간.
const SAMPLE = resolve(process.cwd(), 'fixtures/sample.mp4');

describe('B2 media visuals — extractThumbs + extractPeaks', () => {
  it('썸네일: ≈1장/s, 간격×장수 ≈ 길이, 파일 생성', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-b2-thumbs-'));
    const probe = await probeMedia(SAMPLE);
    const { thumbs, intervalUs } = await extractThumbs(SAMPLE, dir);
    expect(thumbs.length).toBeGreaterThanOrEqual(6); // 8s면 8장(±버림 오차)
    expect(thumbs.length).toBeLessThanOrEqual(12);
    // 간격×장수가 실제 길이를 ±1간격 안에서 덮는다(필름스트립 매핑의 전제).
    expect(intervalUs * thumbs.length).toBeGreaterThanOrEqual(probe.durationUs - intervalUs);
    expect(intervalUs * thumbs.length).toBeLessThanOrEqual(probe.durationUs + intervalUs);
    expect(thumbs[0]!.endsWith('.jpg')).toBe(true);
  });

  it('피크: 20/s, 0..1, 발화(>0.1)와 무음(<0.05) 공존', async () => {
    const probe = await probeMedia(SAMPLE);
    const peaks = await extractPeaks(SAMPLE);
    const expected = (probe.durationUs / 1e6) * 20;
    expect(peaks.length).toBeGreaterThanOrEqual(Math.floor(expected * 0.9));
    expect(peaks.length).toBeLessThanOrEqual(Math.ceil(expected * 1.1));
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(1);
    expect(Math.max(...peaks)).toBeGreaterThan(0.1); // 발화 존재
    expect(Math.min(...peaks)).toBeLessThan(0.05); // 무음 구간 존재(fixture 설계)
  });

  it('상한: maxCount로 장수 캡(롱폼 방어)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-b2-cap-'));
    const { thumbs, intervalUs } = await extractThumbs(SAMPLE, dir, { maxCount: 4 });
    expect(thumbs.length).toBeLessThanOrEqual(5);
    expect(intervalUs).toBeGreaterThanOrEqual(1_500_000); // 8s/4 ≈ 2s 간격
  });
});
