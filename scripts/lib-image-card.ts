// 이미지 → '디자이너 카드' 전처리(사이클 8) — 쇼츠에서 이미지가 고급져 보이는 시각 문법:
// 라운드 코너 + 흰 테두리 + 부드러운 드롭섀도 + 살짝 기울임. 결과는 그림자 여백을 포함한
// 투명 PNG라 오버레이로 그대로 합성된다. (추후 main IPC 'asset:imageCard'로 승격 예정)
import { writeFileSync } from 'node:fs';
import { type Image, createCanvas, loadImage } from '@napi-rs/canvas';

export interface CardOpts {
  /** 출력 카드의 목표 폭(px). 높이는 원본 비율 유지. 기본 720. */
  width?: number;
  /** 코너 반경(px). 기본 28. */
  radius?: number;
  /** 흰 테두리 두께(px). 0=없음. 기본 14. */
  border?: number;
  /** 기울임(도). 쇼츠 관습은 ±2~5°. 기본 -3. */
  tiltDeg?: number;
  /** 그림자 블러(px). 기본 36. */
  shadowBlur?: number;
}

export async function makeImageCard(
  srcPath: string,
  outPath: string,
  opts: CardOpts = {},
): Promise<{ outPath: string; w: number; h: number }> {
  const width = opts.width ?? 720;
  const radius = opts.radius ?? 28;
  const border = opts.border ?? 14;
  const tilt = ((opts.tiltDeg ?? -3) * Math.PI) / 180;
  const shadowBlur = opts.shadowBlur ?? 36;

  const img: Image = await loadImage(srcPath);
  const cardW = width;
  const cardH = Math.round((img.height / img.width) * width);
  // 회전+그림자가 잘리지 않을 캔버스 여백.
  const pad = Math.ceil(
    shadowBlur * 1.6 + Math.max(cardW, cardH) * Math.abs(Math.sin(tilt)) + border,
  );
  const W = cardW + pad * 2;
  const H = cardH + pad * 2;

  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.translate(W / 2, H / 2);
  ctx.rotate(tilt);

  const x = -cardW / 2;
  const y = -cardH / 2;
  const rr = (xx: number, yy: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(xx + r, yy);
    ctx.arcTo(xx + w, yy, xx + w, yy + h, r);
    ctx.arcTo(xx + w, yy + h, xx, yy + h, r);
    ctx.arcTo(xx, yy + h, xx, yy, r);
    ctx.arcTo(xx, yy, xx + w, yy, r);
    ctx.closePath();
  };

  // 1) 드롭섀도(테두리 카드 모양으로) — 살짝 아래로.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = shadowBlur;
  ctx.shadowOffsetY = shadowBlur * 0.35;
  ctx.fillStyle = '#ffffff';
  rr(x - border, y - border, cardW + border * 2, cardH + border * 2, radius + border * 0.6);
  ctx.fill();
  ctx.restore();

  // 2) 흰 테두리 카드(그림자 없이 한 번 더 — 가장자리 선명).
  ctx.fillStyle = '#ffffff';
  rr(x - border, y - border, cardW + border * 2, cardH + border * 2, radius + border * 0.6);
  ctx.fill();

  // 3) 이미지(라운드 클립).
  ctx.save();
  rr(x, y, cardW, cardH, radius);
  ctx.clip();
  ctx.drawImage(img, x, y, cardW, cardH);
  ctx.restore();

  writeFileSync(outPath, c.toBuffer('image/png'));
  return { outPath, w: W, h: H };
}
