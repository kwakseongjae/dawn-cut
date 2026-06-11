// 에셋 제로 홍보영상 실증 (2026-06-11, 사이클 7) —
// 사용자 에셋이 '하나도 없어도' 자연어 한 문장 → grok image_gen이 상품컷을 만들고
// → LLM 대본 → '던' 보이스 → 합성 → 쇼츠. (#18 프로모 에이전트의 풀 루프 전 단계 실증)
// 전제: output/grok-assets/{product-hero,product-lifestyle}.png (scripts/grok-image.sh 산출)
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type BurnFrameSpec,
  type OverlayClip,
  SUBTITLE_PRESETS,
  type SubtitleCue,
  applyCommand,
  buildTranscriptModel,
  burnFrameToOverlay,
  createInitialTimeline,
  drawBadge,
  drawSubtitle,
  subtitleBurnPlan,
  timelineToEdl,
} from '@dawn-cut/core';
import type { DrawCtx } from '@dawn-cut/core';
import { BURN_RASTER_H, BURN_RASTER_W } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { synthesizeOpenRouterTts } from '@dawn-cut/sidecar-tts';
import { createCanvas } from '@napi-rs/canvas';

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'output/grok-promo');
mkdirSync(OUT, { recursive: true });

const settings = JSON.parse(
  readFileSync(join(homedir(), 'Library/Application Support/Electron/settings.json'), 'utf8'),
) as { openrouterApiKey?: string };
const apiKey = settings.openrouterApiKey ?? '';

// ── 입력 에셋 (사용자 시나리오 그대로) ──
const ASSETS = {
  productImages: [
    join(ROOT, 'output/grok-assets/product-hero.png'), // grok image_gen 산출 1
    join(ROOT, 'output/grok-assets/product-lifestyle.png'), // grok image_gen 산출 2
  ],
  usageSilentSrc: join(ROOT, 'output/sources/clip.mp4'), // 배경 영상(무음 처리 → 베이스)
};
const NL_REQUEST = "'새벽 버즈' 무선 이어버드 홍보 쇼츠 만들어줘 — 감각적이고 짧게";

async function main() {
  // 1) LLM이 홍보 대본 작성(자연어 요청 → 문장 3개).
  console.log('1) LLM 홍보 대본 작성…');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4.6',
      temperature: 0,
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `요청: "${NL_REQUEST}"
제품: 새벽 버즈(Dawn Buds) — 무선 이어버드. 새벽처럼 조용한 노이즈캔슬링, 가벼운 착용감, 18시간 배터리.
쇼츠 보이스오버 대본을 정확히 문장 3개로 써줘. 각 문장 ≤28자, 구어체, 마지막은 행동 유도.
JSON 배열로만 답해: ["문장1","문장2","문장3"]`,
        },
      ],
    }),
  });
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '[]';
  const lines = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)) as string[];
  console.log('   대본:', lines.join(' / '));

  // 2) TTS '던'(Gemini 프론티어) 보이스오버.
  console.log('2) TTS 보이스오버 합성…');
  const voiceWav = join(OUT, 'voiceover.wav');
  const tts = await synthesizeOpenRouterTts(lines.join(' '), voiceWav, {
    apiKey,
    voice: 'dawn',
    style: 'lively',
  });
  const voiceDurUs = (await probeMedia(voiceWav)).durationUs;
  console.log(`   ${tts.model} · ${(voiceDurUs / 1e6).toFixed(1)}s`);

  // 3) 베이스 영상 = 무음 사용영상(보이스오버 길이에 맞춰 트림 + 무음 트랙 부착).
  //    ※ 발견한 제품 갭: renderEdl은 오디오 스트림이 아예 없으면 실패한다 → 무음 트랙을 깔아준다.
  const totalSec = Math.min(15.4, voiceDurUs / 1e6 + 1.2);
  const base = join(OUT, 'base-silent.mp4');
  await exec('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    ASSETS.usageSilentSrc,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-t',
    String(totalSec),
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    base,
  ]);
  const probe = await probeMedia(base);
  const durUs = probe.durationUs;

  // 4) 타임라인 + vivid 색보정(command bus 경유 — 사람/에이전트와 같은 경로).
  const timeline0 = createInitialTimeline('m', durUs, probe.fps || 30);
  const emptyTr = buildTranscriptModel([], 'm', 'ko');
  const { after } = applyCommand(
    { timeline: timeline0, transcript: emptyTr },
    { type: 'applyColorgrade', preset: 'vivid' },
  );
  const timeline = after.timeline;

  // 5) 오버레이 구성 — 상품 이미지 2(pop), B-roll(유음 영상, 소리는 미사용), 배지, GIF 스티커.
  const u = (sec: number) => Math.round(sec * 1e6);
  const overlays: OverlayClip[] = [];
  // 상품 이미지 1 — 초반 우상단 pop-in.
  overlays.push({
    id: 'p1',
    kind: 'image',
    src: ASSETS.productImages[0]!,
    x: 0.55,
    y: 0.06,
    scale: 0.4,
    opacity: 1,
    startUs: u(0.8),
    endUs: u(4.6),
    z: 30,
    keyframes: [{ u: 0.18, scale: 0.42, easing: 'easeOut' }],
  });
  // 상품 이미지 2(앱 화면) — 중후반 좌상단.
  overlays.push({
    id: 'p2',
    kind: 'image',
    src: ASSETS.productImages[1]!,
    x: 0.06,
    y: 0.08,
    scale: 0.5,
    opacity: 1,
    startUs: u(9.8),
    endUs: u(13.4),
    z: 30,
    keyframes: [{ u: 0.2, scale: 0.52, easing: 'easeOut' }],
  });
  // 배지(헤드리스 래스터 — 코어 drawBadge).
  const badgePng = join(OUT, 'badge.png');
  {
    const c = createCanvas(420, 160);
    drawBadge(c.getContext('2d') as unknown as DrawCtx, 420, 160, '새벽 버즈 · NEW');
    writeFileSync(badgePng, c.toBuffer('image/png'));
  }
  overlays.push({
    id: 'badge',
    kind: 'sticker',
    src: badgePng,
    x: 0.05,
    y: 0.05,
    scale: 0.34,
    opacity: 1,
    startUs: u(0.2),
    endUs: u(3.6),
    z: 40,
  });
  // 모션 GIF 스티커 — 마지막 행동 유도 구간에 '구독' 애니.
  overlays.push({
    id: 'sub',
    kind: 'gif',
    src: join(ROOT, 'assets/gif/zoom-subscribe.gif'),
    x: 0.36,
    y: 0.62,
    scale: 0.3,
    opacity: 1,
    startUs: u(totalSec - 3.2),
    endUs: u(totalSec - 0.2),
    z: 40,
  });

  // 6) 자막 — 대본 3문장을 보이스오버 길이에 글자수 비례 배분 → 쇼츠 프리셋 번인.
  const totalChars = lines.reduce((a, l) => a + l.length, 0);
  let cursor = 0.15e6;
  const cues: { cue: SubtitleCue; pos?: { x: number; y: number; scale: number } }[] = [];
  lines.forEach((text, i) => {
    const span = (voiceDurUs * (text.length / totalChars)) | 0;
    cues.push({
      cue: { index: i + 1, startUs: Math.round(cursor), endUs: Math.round(cursor + span), text },
    });
    cursor += span;
  });
  const style = { ...SUBTITLE_PRESETS.shorts, emphasizeKeywords: true };
  const plan = subtitleBurnPlan(null, timeline, style, { x: 0.1, y: 0.78, scale: 0.8 }, cues);
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

  // 7) 렌더 — 9:16 리프레임 + 보이스오버 믹스 + 고화질.
  console.log('3) 렌더(9:16 + 보이스오버 + 오버레이 합성)…');
  const edl = timelineToEdl(timeline, base);
  const outMp4 = join(OUT, 'promo-final.mp4');
  await renderEdl(edl, outMp4, {
    overlays,
    frameW: probe.width,
    frameH: probe.height,
    reframe: '9:16',
    voicePath: voiceWav,
    voiceStartUs: 150_000,
    quality: 'high',
  });
  const final = await probeMedia(outMp4);
  console.log(
    `✅ ${outMp4} — ${(final.durationUs / 1e6).toFixed(1)}s ${final.width}x${final.height}`,
  );
  // 포스터 프레임 3장(검수용).
  for (const sec of [1.5, 6.5, 12.5]) {
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
  writeFileSync(join(OUT, 'script.txt'), `${NL_REQUEST}\n\n${lines.join('\n')}\n`);
}
void main();
