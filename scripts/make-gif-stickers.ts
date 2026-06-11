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

const emojiFont = (frac: number) => `${Math.round(SIZE * frac)}px "Apple Color Emoji"`;
// 이모지 위아래 통통 바운스.
const bounce =
  (emoji: string): DrawFrame =>
  (ctx, t) => {
    const c = SIZE / 2;
    ctx.translate(c, c - SIZE * 0.18 * Math.abs(Math.sin(t * Math.PI)));
    ctx.font = emojiFont(0.58);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 0, SIZE * 0.04);
  };
// 화살표가 좌→우로 흐름.
const slideArrow: DrawFrame = (ctx, t) => {
  ctx.translate(SIZE * (-0.2 + 1.2 * t), SIZE / 2);
  ctx.font = emojiFont(0.6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('➡️', 0, 0);
};
// 'NEW' 배지 깜빡임(브랜드 보라).
const blinkNew: DrawFrame = (ctx, t) => {
  const c = SIZE / 2;
  ctx.globalAlpha = Math.sin(t * Math.PI * 2) > 0 ? 1 : 0.2;
  ctx.fillStyle = 'rgba(124,92,255,1)';
  ctx.fillRect(SIZE * 0.15, SIZE * 0.3, SIZE * 0.7, SIZE * 0.4);
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(SIZE * 0.2)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NEW', c, c);
};
// 중앙에서 하트가 방사형으로 터지며 사라짐.
const heartBurst: DrawFrame = (ctx, t) => {
  const c = SIZE / 2;
  ctx.translate(c, c);
  ctx.globalAlpha = 1 - t;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = emojiFont(0.22 * (0.4 + 0.6 * (1 - t)));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = SIZE * 0.32 * t;
    ctx.fillText('❤️', Math.cos(a) * r, Math.sin(a) * r);
  }
};
// ✅ 팝인(0→풀크기, 살짝 오버슈트).
const checkPop: DrawFrame = (ctx, t) => {
  const c = SIZE / 2;
  const s = t < 0.5 ? t / 0.5 : 1 + 0.12 * Math.sin((t - 0.5) * Math.PI * 4);
  ctx.globalAlpha = Math.min(1, t * 3);
  ctx.translate(c, c);
  ctx.scale(s, s);
  ctx.font = emojiFont(0.62);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✅', 0, SIZE * 0.04);
};
// '구독' 텍스트가 작게→크게 줌(CJK은 sans-serif로 두부 방지).
// 구독 버튼 v2(사이클 8) — 유튜브식 시퀀스: 빨강 [구독] → 커서 인+클릭 → 펄스 링 →
// 회색 [구독중 ✓] + 벨 흔들림. 절차 생성이지만 '실제 UI를 누르는' 서사가 있어 싸 보이지 않는다.
const subscribeV2: DrawFrame = (ctx, t) => {
  const W2 = SIZE;
  const bw = W2 * 0.86; // 버튼 폭
  const bh = W2 * 0.3;
  const bx = (W2 - bw) / 2;
  const by = W2 * 0.36;
  const r = bh / 2;
  const clickT = 0.45; // 클릭 시점
  const clicked = t >= clickT;

  const rr = (x: number, y: number, w: number, h: number, rad: number) => {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };

  // 클릭 순간 살짝 눌리는 스케일.
  const press = clicked && t < clickT + 0.12 ? 0.94 : 1;
  ctx.save();
  ctx.translate(W2 / 2, by + bh / 2);
  ctx.scale(press, press);
  ctx.translate(-W2 / 2, -(by + bh / 2));

  // 버튼 본체 + 그림자.
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = clicked ? '#272727' : '#ff0033';
  rr(bx, by, bw, bh, r);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // 라벨.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(bh * 0.42)}px "Apple SD Gothic Neo", sans-serif`;
  ctx.fillText(clicked ? '구독중 ✓' : '구독', W2 / 2, by + bh / 2 + 1);
  ctx.restore();

  // 클릭 직후 펄스 링(밖으로 퍼지며 사라짐).
  if (clicked) {
    const pt = Math.min(1, (t - clickT) / 0.4);
    ctx.strokeStyle = `rgba(255,255,255,${(0.7 * (1 - pt)).toFixed(3)})`;
    ctx.lineWidth = 5 * (1 - pt) + 1;
    rr(bx - 14 * pt, by - 14 * pt, bw + 28 * pt, bh + 28 * pt, r + 14 * pt);
    ctx.stroke();
  }

  // 벨 — 클릭 후 좌우로 땡땡(흔들림 감쇠).
  const bellY = by + bh + W2 * 0.16;
  ctx.save();
  ctx.translate(W2 / 2, bellY);
  if (clicked) {
    const st = (t - clickT) * 6;
    ctx.rotate(0.45 * Math.sin(st * Math.PI * 2) * Math.max(0, 1 - st * 0.45));
  }
  ctx.font = emojiFont(0.24);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔔', 0, 0);
  ctx.restore();

  // 커서(클릭 전 진입 → 클릭 후 살짝 빠짐).
  const cx = clicked ? W2 * 0.62 + (t - clickT) * 30 : W2 * 0.95 - (t / clickT) * W2 * 0.33;
  const cy = clicked
    ? by + bh * 0.78 + (t - clickT) * 24
    : by + bh * 1.05 - (t / clickT) * bh * 0.27;
  ctx.font = emojiFont(0.2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('👆', cx, cy);
};
// 👋 손 흔들기(빠른 좌우 회전).
const wave: DrawFrame = (ctx, t) => {
  const c = SIZE / 2;
  ctx.translate(c, c);
  ctx.rotate(0.4 * Math.sin(t * Math.PI * 4));
  ctx.font = emojiFont(0.6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('👋', 0, SIZE * 0.04);
};

const STICKERS: { name: string; draw: DrawFrame }[] = [
  { name: 'spinner', draw: spinner },
  { name: 'pulse-fire', draw: pulse('🔥') },
  { name: 'pulse-star', draw: pulse('⭐') },
  { name: 'float-heart', draw: floatHeart },
  { name: 'bounce-tada', draw: bounce('🎉') },
  { name: 'slide-arrow', draw: slideArrow },
  { name: 'blink-new', draw: blinkNew },
  { name: 'heart-burst', draw: heartBurst },
  { name: 'thumbs-up', draw: bounce('👍') },
  { name: 'check-pop', draw: checkPop },
  { name: 'zoom-subscribe', draw: subscribeV2, frames: 28 } as never, // v2 — 2.3s 클릭 서사(사이클 8)
  { name: 'wave', draw: wave },
];

function renderGif(name: string, draw: DrawFrame, frames: number = FRAMES): void {
  const tmp = mkdtempSync(join(tmpdir(), `gif-${name}-`));
  for (let i = 0; i < frames; i++) {
    const cv = createCanvas(SIZE, SIZE);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE); // 투명 배경
    ctx.save();
    draw(ctx, i / frames);
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
for (const s of STICKERS) renderGif(s.name, s.draw, (s as { frames?: number }).frames);
console.log(`\n${STICKERS.length} motion stickers → assets/gif/`);
