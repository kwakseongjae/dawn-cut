// 프로모 v2(사이클 8) — 쇼츠 모션 디자인 시스템 총동원 버전.
// v1 대비: 절차 생성 배경 팩(주제 무관 영상 → 무드 배경) · 이미지 '디자이너 카드'(라운드+
// 테두리+그림자+기울임) · back(오버슈트) 팝인 + Ken Burns 드리프트 · 하단 비네트(자막 대비) ·
// 구독 버튼 v2(클릭 서사) · 0.4s 리듬 그리드.
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  BURN_RASTER_H,
  BURN_RASTER_W,
  type BurnFrameSpec,
  type DrawCtx,
  type OverlayClip,
  SUBTITLE_PRESETS,
  type SubtitleCue,
  buildTranscriptModel,
  burnFrameToOverlay,
  createInitialTimeline,
  drawSubtitle,
  subtitleBurnPlan,
  timelineToEdl,
} from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { synthesizeOpenRouterTts } from '@dawn-cut/sidecar-tts';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { makeImageCard } from './lib-image-card.js';

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'output/promo-v2');
mkdirSync(OUT, { recursive: true });

const settings = JSON.parse(
  readFileSync(join(homedir(), 'Library/Application Support/Electron/settings.json'), 'utf8'),
) as { openrouterApiKey?: string };
const apiKey = settings.openrouterApiKey ?? '';

const HERO = join(ROOT, 'output/grok-assets/product-hero.png');
const LIFE = join(ROOT, 'output/grok-assets/product-lifestyle.png');
const BG = join(ROOT, 'assets/broll/bokeh-dawn.mp4'); // 절차 생성 무드 배경(무음·9:16·16s)
const W = 1080;
const H = 1920;
const BEAT = 0.4; // 리듬 그리드(초) — 모든 등장이 비트에 맞는다.
const snap = (sec: number) => Math.round(sec / BEAT) * BEAT;

async function main() {
  console.log('1) LLM 카피…');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4.6',
      temperature: 0,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `제품: 새벽 버즈(Dawn Buds) 무선 이어버드 — 새벽처럼 조용한 노이즈캔슬링, 18시간 배터리.
릴스/틱톡용 보이스오버 3문장(각 ≤24자, 훅-증명-CTA 구조, 구어체). JSON 배열로만: ["...","...","..."]`,
        },
      ],
    }),
  });
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '[]';
  const lines = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)) as string[];
  console.log('   ', lines.join(' / '));

  console.log('2) 던 보이스…');
  const voiceWav = join(OUT, 'voiceover.wav');
  await synthesizeOpenRouterTts(lines.join(' '), voiceWav, {
    apiKey,
    voice: 'dawn',
    style: 'lively',
  });
  const voiceDurUs = (await probeMedia(voiceWav)).durationUs;
  const totalSec = Math.min(15.6, snap(voiceDurUs / 1e6 + 1.2));
  const u = (sec: number) => Math.round(sec * 1e6);

  console.log('3) 이미지 → 디자이너 카드 전처리…');
  const card2 = await makeImageCard(LIFE, join(OUT, 'card-life.png'), { tiltDeg: 3 });

  // 비네트 — 하단 그라데이션(자막 대비) + 상단 살짝(밀폐감). 풀스크린 PNG.
  const vignette = join(OUT, 'vignette.png');
  {
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const gt = ctx.createLinearGradient(0, 0, 0, H * 0.18);
    gt.addColorStop(0, 'rgba(0,0,0,0.35)');
    gt.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, W, H);
    writeFileSync(vignette, c.toBuffer('image/png'));
  }

  const overlays: OverlayClip[] = [];
  // 비네트(전경 요소 아래, 배경 위 — z 5).
  overlays.push({
    id: 'vig',
    kind: 'image',
    src: vignette,
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
    startUs: 0,
    endUs: u(totalSec),
    z: 10, // 풀블리드 히어로(z8) 위, 전경(z30+) 아래 — 자막 대비 유지
  });

  // 히어로 — '풀블리드' Ken Burns: 원본 이미지가 화면 '높이'를 덮도록 폭 스케일을
  // 이미지 비율에서 동적 계산(가로형이면 2.5+ — 좌우는 잘리는 게 정상, 쇼츠 문법).
  const cx = (sc: number) => (1 - sc) / 2;
  const heroImg = await loadImage(HERO);
  const coverScale = (H / W) * (heroImg.width / heroImg.height); // 높이 100% 커버 폭배율
  const heroS = coverScale * 1.06; // 6% 여유(드리프트 중에도 빈틈 없음)
  overlays.push({
    id: 'hero',
    kind: 'image',
    src: HERO,
    x: cx(heroS),
    y: -0.04,
    scale: heroS,
    opacity: 1,
    startUs: 0,
    endUs: u(snap(6.0)),
    z: 8,
    keyframes: [{ u: 1, scale: heroS * 1.12, x: cx(heroS * 1.12), y: -0.07, easing: 'easeInOut' }],
  });
  // 카드 2 — 화면 폭을 '넘치는' 블리드(1.35) + 통통 팝인 + 드리프트. 소극적 배치 금지.
  const c2Scale = 1.35;
  overlays.push({
    id: 'card2',
    kind: 'image',
    src: card2.outPath,
    x: cx(c2Scale),
    y: 0.13,
    scale: c2Scale * 0.6,
    opacity: 1,
    startUs: u(snap(6.0)),
    endUs: u(snap(11.2)),
    z: 30,
    keyframes: [
      { u: 0.14, scale: c2Scale, x: cx(c2Scale), easing: 'back' },
      { u: 1, scale: c2Scale * 1.06, x: cx(c2Scale * 1.06), y: 0.08, easing: 'linear' },
    ],
  });
  // 구독 — 30fps 알파 비디오(ProRes4444) — GIF 팔레트·12fps 버벅임 제거(사이클 9).
  overlays.push({
    id: 'sub',
    kind: 'video',
    src: join(ROOT, 'assets/gif/zoom-subscribe.mov'),
    x: 0.225,
    y: 0.46,
    scale: 0.3,
    opacity: 1,
    startUs: u(snap(totalSec - 3.2)),
    endUs: u(totalSec - 0.1),
    z: 40,
    keyframes: [{ u: 0.18, scale: 0.55, x: 0.225, easing: 'back' }],
  });

  // 자막 — 쇼츠 프리셋 + pop 애니(cue별 통통). 비트에 맞춘 cue 타이밍.
  const totalChars = lines.reduce((a, l) => a + l.length, 0);
  let cursor = 0.2e6;
  const cues: { cue: SubtitleCue }[] = [];
  lines.forEach((text, i) => {
    const span = (voiceDurUs * (text.length / totalChars)) | 0;
    cues.push({
      cue: { index: i + 1, startUs: Math.round(cursor), endUs: Math.round(cursor + span), text },
    });
    cursor += span;
  });
  const style = { ...SUBTITLE_PRESETS.shorts, emphasizeKeywords: true, animation: 'pop' as const };
  const plan = subtitleBurnPlan(
    null,
    createInitialTimeline('m', u(totalSec), 30),
    style,
    { x: 0.0, y: 0.73, scale: 1.0 },
    cues,
  );
  plan.forEach((fr: BurnFrameSpec, i: number) => {
    const c = createCanvas(BURN_RASTER_W, BURN_RASTER_H);
    drawSubtitle(
      c.getContext('2d') as unknown as DrawCtx,
      BURN_RASTER_W,
      BURN_RASTER_H,
      fr.wrapped,
      style,
      fr.emphasis ? new Set(fr.emphasis) : undefined,
    );
    const png = join(OUT, `cue-${i}.png`);
    writeFileSync(png, c.toBuffer('image/png'));
    overlays.push(burnFrameToOverlay(fr, png, `cue-${i}`));
  });

  console.log('4) 렌더(무음 배경 + 보이스 + 풀 모션)…');
  const timeline = createInitialTimeline('m', u(totalSec), 30);
  const edl = timelineToEdl(timeline, BG);
  const outMp4 = join(OUT, 'promo-v2.mp4');
  await renderEdl(edl, outMp4, {
    overlays,
    frameW: W,
    frameH: H,
    inputHasAudio: false, // 절차 생성 배경은 무음 — 사이클 5 픽스 활용
    voicePath: voiceWav,
    voiceStartUs: 200_000,
    quality: 'high',
  });
  const final = await probeMedia(outMp4);
  console.log(
    `✅ ${outMp4} — ${(final.durationUs / 1e6).toFixed(1)}s ${final.width}x${final.height}`,
  );
  for (const sec of [1.6, 7, 13]) {
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      String(sec),
      '-i',
      outMp4,
      '-frames:v',
      '1',
      join(OUT, `poster-${sec}s.png`),
    ]);
  }
}
void main();
