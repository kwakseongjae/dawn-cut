import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const GIF_DIR = resolve(ROOT, 'assets/gif');
const FFPROBE = process.env.DAWN_FFPROBE ?? 'ffprobe';

// 번들 '모션 스티커'(scripts/make-gif-stickers.ts 산출)가 유효한 애니메이션 GIF인지 가드.
// 합성 경로 자체는 g16-gif-overlay에서 검증됨 — 여기선 콘텐츠(다중 프레임·존재)를 지킨다.
describe('G16b motion stickers — bundled starter GIFs are valid animated gifs', () => {
  it.skipIf(!existsSync(GIF_DIR))('each assets/gif/*.gif has >1 frame', async () => {
    const gifs = readdirSync(GIF_DIR).filter((f) => f.toLowerCase().endsWith('.gif'));
    expect(gifs.length).toBeGreaterThanOrEqual(4); // spinner, pulse-fire, pulse-star, float-heart
    for (const g of gifs) {
      const { stdout } = await exec(FFPROBE, [
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=nb_read_frames',
        '-of',
        'default=nokey=1:noprint_wrappers=1',
        resolve(GIF_DIR, g),
      ]);
      expect(Number(stdout.trim()), `${g} should be animated`).toBeGreaterThan(1);
    }
  });
});
