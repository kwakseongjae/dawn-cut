import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractPeaks, probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// D6 — BGM 소스 팩: 번들 에셋의 무결성(존재·길이·비무음·비클리핑) + 카탈로그 정합.
const BGM_DIR = resolve(process.cwd(), 'assets/bgm');
const catalog = JSON.parse(readFileSync(resolve(BGM_DIR, 'catalog.json'), 'utf8')) as Array<{
  id: string;
  bpm: number;
  durationSec: number;
  loopable: boolean;
  pairsWithBroll: string[];
}>;

describe('D6 bgm pack — 번들 음악 에셋 무결성', () => {
  it('카탈로그 6무드, 필수 필드', () => {
    expect(catalog).toHaveLength(6);
    for (const c of catalog) {
      expect(c.id).toBeTruthy();
      expect(c.durationSec).toBeGreaterThan(15);
      expect(c.durationSec).toBeLessThan(40);
      expect(c.loopable).toBe(true);
      expect(c.pairsWithBroll.length).toBeGreaterThan(0);
    }
  });

  for (const c of JSON.parse(
    readFileSync(resolve(process.cwd(), 'assets/bgm/catalog.json'), 'utf8'),
  ) as Array<{ id: string; durationSec: number }>) {
    it(`${c.id}.m4a — 재생 가능·길이 일치·비무음·비클리핑`, async () => {
      const path = resolve(BGM_DIR, `${c.id}.m4a`);
      const probe = await probeMedia(path);
      expect(probe.hasAudio).toBe(true);
      // AAC 인코딩 패딩 허용(±0.3s)
      expect(Math.abs(probe.durationUs / 1e6 - c.durationSec)).toBeLessThan(0.3);
      const peaks = await extractPeaks(path);
      const max = Math.max(...peaks);
      const nonSilent = peaks.filter((p) => p > 0.02).length / peaks.length;
      expect(max).toBeGreaterThan(0.4); // 무음/과소음 아님
      expect(max).toBeLessThanOrEqual(1); // 클리핑 지표(피크 정규화 -1.2dBFS)
      expect(nonSilent).toBeGreaterThan(0.5); // 절반 이상 구간에 에너지
    }, 30_000);
  }
});
