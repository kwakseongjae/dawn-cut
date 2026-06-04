// 스타터 '모션 스티커'(애니메이션 GIF)를 로컬에서 결정적으로 생성한다 — 클라우드(GIPHY/Tenor)
// 의존 없이, 라이선스-free·오프라인. @napi-rs/canvas로 N프레임을 그려 ffmpeg palettegen/paletteuse
// 로 투명 배경 .gif를 굽는다. (오버레이 합성 경로는 tests/integration/g16-gif-overlay에서 검증됨.)
//
//   pnpm assets:gif   → assets/gif/*.gif (extraResources로 번들, 런타임 '모션 스티커' 패널에 노출)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'assets/gif');
const SIZE = 192;
const FRAMES = 12;
const FPS = 12;

type DrawFrame = (
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  t: number,
) => void;

// 회전 스피너(브랜드 보라 호).
const spinner: DrawFrame = (ctx, t) => {
  const c = SIZE / 2;
  const r = SIZE * 0.34;
  ctx.translate(c, c);
  ctx.rotate(t * Math.PI * 2);
  ctx.lineCap = 'round';
  ctx.lineWidth = SIZE * 0.1;
  for (let i = 0; i < 12; i++) {
    ctx.strokeStyle = `rgba(124,92,255,${0.2 + 0.8 * (i / 12)})`;
    ctx.beginPath();
    ctx.moveTo(r * 0.55, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();
    ctx.rotate((Math.PI * 2) / 12);
  }
};

// 펄스(이모지가 두근두근 커졌다 작아짐). 시선 끄는 강조용.
const pulse =
  (emoji: string): DrawFrame =>
  (ctx, t) => {
    const s = 1 + 0.16 * Math.sin(t * Math.PI * 2);
    const c = SIZE / 2;
    ctx.translate(c, c);
    ctx.scale(s, s);
    ctx.font = `${Math.round(SIZE * 0.62)}px "Apple Color Emoji"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 0, SIZE * 0.04);
  };

// 위로 떠오르며 사라지는 하트(인스타식 좋아요).
const floatHeart: DrawFrame = (ctx, t) => {
  const c = SIZE / 2;
  ctx.globalAlpha = 1 - t;
  ctx.translate(c, SIZE * (0.62 - 0.32 * t));
  ctx.font = `${Math.round(SIZE * 0.5)}px "Apple Color Emoji"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('❤️', 0, 0);
};

const STICKERS: { name: string; draw: DrawFrame }[] = [
  { name: 'spinner', draw: spinner },
  { name: 'pulse-fire', draw: pulse('🔥') },
  { name: 'pulse-star', draw: pulse('⭐') },
  { name: 'float-heart', draw: floatHeart },
];

function renderGif(name: string, draw: DrawFrame): void {
  const tmp = mkdtempSync(join(tmpdir(), `gif-${name}-`));
  for (let i = 0; i < FRAMES; i++) {
    const cv = createCanvas(SIZE, SIZE);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE); // 투명 배경
    ctx.save();
    draw(ctx, i / FRAMES);
    ctx.restore();
    writeFileSync(join(tmp, `f${String(i).padStart(3, '0')}.png`), cv.toBuffer('image/png'));
  }
  const out = join(OUT, `${name}.gif`);
  // palettegen(투명 예약) + paletteuse(알파 임계) → 루프 무한. 결정적.
  execFileSync(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    join(tmp, 'f%03d.png'),
    '-filter_complex',
    '[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128',
    '-loop',
    '0',
    out,
  ]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`✓ ${out}`);
}

mkdirSync(OUT, { recursive: true });
for (const s of STICKERS) renderGif(s.name, s.draw);
console.log(`\n${STICKERS.length} motion stickers → assets/gif/`);
