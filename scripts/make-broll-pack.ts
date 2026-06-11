// 배경 B-roll 프리셋 팩(사이클 8) — 쇼츠/릴스에서 흔한 무드 배경을 '절차 생성'한다.
// 저작권 0(우리가 만든 픽셀), 오프라인, 결정적. 9:16 1080×1920, 16초, 무음.
// 외부 CC0 수집(Pexels 등)은 후속(키 필요) — 1차는 생성형 6종으로 프리셋 카테고리를 연다.
//
//   npx tsx scripts/make-broll-pack.ts   → assets/broll/*.mp4 (extraResources 번들 예정)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';
const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'assets/broll');
mkdirSync(OUT, { recursive: true });

const W = 1080;
const H = 1920;
const DUR = 16;
const FPS = 30;

// ── lavfi 기반(인코딩만, 빠름) ──────────────────────────────────────
function lavfi(name: string, filter: string) {
  const out = join(OUT, `${name}.mp4`);
  execFileSync(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    filter,
    '-t',
    String(DUR),
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    out,
  ]);
  console.log('✓', name);
}

// ── napi-canvas 프레임 기반(보케/별 — lavfi로는 안 나오는 질감) ──────
type Painter = (ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, t: number) => void;
// 결정적 의사난수(시드 고정) — 같은 팩이 항상 같은 픽셀.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
function fromFrames(name: string, paint: Painter, frames = DUR * FPS) {
  const dir = mkdtempSync(join(tmpdir(), `broll-${name}-`));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < frames; i++) {
    ctx.save();
    paint(ctx, i / frames);
    ctx.restore();
    writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.png`), canvas.toBuffer('image/png'));
  }
  const out = join(OUT, `${name}.mp4`);
  execFileSync(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    join(dir, 'f%04d.png'),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    out,
  ]);
  rmSync(dir, { recursive: true, force: true });
  console.log('✓', name);
}

/** 수직 그라데이션 배경 + 떠다니는 흐릿한 원(보케). hueA→hueB 팔레트. */
const bokeh =
  (top: string, bottom: string, tint: string, seed: number): Painter =>
  (ctx, t) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const r = rng(seed);
    for (let i = 0; i < 26; i++) {
      const baseX = r() * W;
      const baseY = r() * H;
      const rad = 40 + r() * 150;
      const speed = 0.3 + r() * 0.7;
      const phase = r();
      // 루프되는 수직 드리프트 + 약한 좌우 흔들림.
      const y = ((baseY - ((t * speed * H) % H) + H * 1.5) % (H * 1.2)) - H * 0.1;
      const x = baseX + Math.sin((t + phase) * Math.PI * 2) * 30;
      const alpha = 0.05 + 0.1 * Math.sin((t * 2 + phase) * Math.PI * 2) ** 2;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, tint.replace('A', String(alpha.toFixed(3))));
      rg.addColorStop(1, tint.replace('A', '0'));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  };

/** 밤하늘 별 드리프트 + 미세 반짝임. */
const stars: Painter = (ctx, t) => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#070b1e');
  g.addColorStop(1, '#101a3a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = rng(42);
  for (let i = 0; i < 220; i++) {
    const x = r() * W;
    const baseY = r() * H;
    const size = 0.6 + r() * 2.2;
    const tw = r();
    const y = (baseY + t * 60) % H; // 느린 하강 드리프트(루프)
    const a = 0.25 + 0.75 * Math.abs(Math.sin((t * 3 + tw) * Math.PI * 2));
    ctx.fillStyle = `rgba(255,255,255,${(a * (0.4 + 0.6 * tw)).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
};

// ── 팩 구성 ──────────────────────────────────────────────────────────
// lavfi: 오로라풍 그라데이션 드리프트(쇼츠 단골 무드).
lavfi(
  'aurora-flow',
  `gradients=s=${W}x${H}:n=3:c0=0x1a0533:c1=0x4a1d96:c2=0x0f4c81:speed=0.015,format=yuv420p`,
);
lavfi(
  'sunset-flow',
  `gradients=s=${W}x${H}:n=3:c0=0x2d0a2e:c1=0xb83a5e:c2=0xf5874f:speed=0.012,format=yuv420p`,
);
lavfi(
  'mint-flow',
  `gradients=s=${W}x${H}:n=3:c0=0x04211c:c1=0x0d6e57:c2=0x77e0b5:speed=0.014,format=yuv420p`,
);
// napi: 보케 2무드 + 별.
fromFrames('bokeh-dawn', bokeh('#1c1030', '#3d1f4e', 'rgba(255,176,120,A)', 7));
fromFrames('bokeh-ocean', bokeh('#04121f', '#0a2b4a', 'rgba(120,200,255,A)', 21));
fromFrames('stars-night', stars);
console.log(`\n배경 팩 → ${OUT}`);
