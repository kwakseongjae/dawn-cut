// 프로모 양산 에이전트(#18 1단계) — 자연어 한 문장 + 에셋 목록 → 쇼츠 mp4.
//
//   npx tsx scripts/promo-agent.ts "<요청>" <이미지1> [이미지2 …] [--out <dir>]
//
// LLM은 '연출'만 고른다(템플릿 id·배경 무드·카피·보이스·톤) — 합성은 검증된 템플릿
// 함수(lib-promo-templates)가 결정적으로 수행. 잘못된 선택은 검증에서 거부(환각 차단).
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  BURN_RASTER_H,
  BURN_RASTER_W,
  type BurnFrameSpec,
  type DrawCtx,
  SUBTITLE_PRESETS,
  type SubtitleCue,
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
import {
  BG_MOODS,
  type BgMood,
  type PromoAsset,
  TEMPLATES,
  TEMPLATE_CATALOG,
  TEMPLATE_IDS,
  type TemplateId,
} from './lib-promo-templates.js';

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const W = 1080;
const H = 1920;

const settings = JSON.parse(
  readFileSync(join(homedir(), 'Library/Application Support/Electron/settings.json'), 'utf8'),
) as { openrouterApiKey?: string };
const apiKey = settings.openrouterApiKey ?? '';

interface Direction {
  template: TemplateId;
  bgMood: BgMood;
  copy: string[];
  voice: 'dawn' | 'seoyeon' | 'hojin' | 'haru';
  style: 'calm' | 'normal' | 'lively';
}
/** LLM 응답 검증 — 카탈로그 밖 선택은 거부 후 기본값(환각 차단, 플래너와 동일 철학). */
function validateDirection(raw: unknown): Direction {
  const d = raw as Partial<Direction>;
  const template = TEMPLATE_IDS.includes(d.template as TemplateId)
    ? (d.template as TemplateId)
    : 'hero-fullbleed';
  const bgMood = BG_MOODS.includes(d.bgMood as BgMood) ? (d.bgMood as BgMood) : 'bokeh-dawn';
  const copy = Array.isArray(d.copy)
    ? d.copy.filter((l): l is string => typeof l === 'string' && l.length > 0).slice(0, 4)
    : [];
  if (copy.length < 2) throw new Error('카피 부족 — LLM 응답 불량');
  const voice = (['dawn', 'seoyeon', 'hojin', 'haru'] as const).includes(d.voice as never)
    ? (d.voice as Direction['voice'])
    : 'dawn';
  const style = (['calm', 'normal', 'lively'] as const).includes(d.style as never)
    ? (d.style as Direction['style'])
    : 'normal';
  return { template, bgMood, copy, voice, style };
}

async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? argv[outIdx + 1]! : join(ROOT, 'output/promo-agent');
  const positional = argv.filter((_, i) => i !== outIdx && i !== outIdx + 1);
  const request = positional[0];
  const assetPaths = positional.slice(1);
  if (!request || assetPaths.length === 0) {
    console.error('사용: npx tsx scripts/promo-agent.ts "<요청>" <이미지…> [--out dir]');
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });

  // 1) 연출 선택(LLM) — 템플릿/무드/카피/보이스만. JSON 강제 + 검증.
  console.log('1) 연출 선택(LLM)…');
  const catalog = TEMPLATE_IDS.map((id) => `- ${id}: ${TEMPLATE_CATALOG[id]}`).join('\n');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4.6',
      temperature: 0,
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `요청: "${request}"
에셋: 이미지 ${assetPaths.length}장 (${assetPaths.map((p) => basename(p)).join(', ')})

쇼츠 연출을 골라 JSON으로만 답해:
{"template": <${TEMPLATE_IDS.join('|')}>, "bgMood": <${BG_MOODS.join('|')}>, "copy": ["문장1","문장2","문장3"], "voice": <dawn|seoyeon|hojin|haru>, "style": <calm|normal|lively>}

템플릿 카탈로그:
${catalog}
배경 무드: bokeh-dawn(따뜻한 새벽 보케) bokeh-ocean(차가운 바다 보케) aurora-flow(보랏빛 오로라) sunset-flow(노을) mint-flow(민트) stars-night(별밤)
카피 규칙: 각 ≤24자, 훅-증명-CTA, 구어체.`,
        },
      ],
    }),
  });
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  const dir = validateDirection(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)));
  console.log(`   템플릿=${dir.template} 무드=${dir.bgMood} 보이스=${dir.voice}/${dir.style}`);
  console.log(`   카피: ${dir.copy.join(' / ')}`);

  // 2) 보이스오버.
  console.log('2) 보이스오버…');
  const voiceWav = join(outDir, 'voiceover.wav');
  await synthesizeOpenRouterTts(dir.copy.join(' '), voiceWav, {
    apiKey,
    voice: dir.voice,
    style: dir.style,
  });
  const voiceDurUs = (await probeMedia(voiceWav)).durationUs;
  const totalSec = Math.min(15.6, Math.round((voiceDurUs / 1e6 + 1.2) / 0.4) * 0.4);

  // 3) 에셋 전처리 — 치수 측정 + 카드화.
  console.log('3) 에셋 전처리…');
  const assets: PromoAsset[] = [];
  for (const [i, p] of assetPaths.entries()) {
    const img = await loadImage(p);
    const card = await makeImageCard(p, join(outDir, `card-${i}.png`), {
      tiltDeg: i % 2 === 0 ? -3.5 : 3,
    });
    assets.push({ path: card.outPath, rawPath: p, w: img.width, h: img.height });
  }
  // 비네트.
  const vignettePng = join(outDir, 'vignette.png');
  {
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    writeFileSync(vignettePng, c.toBuffer('image/png'));
  }

  // 4) 템플릿 실행 → 오버레이 플랜 + 자막.
  const plan = TEMPLATES[dir.template]({
    W,
    H,
    totalSec,
    assets,
    stickerMov: join(ROOT, 'assets/gif/zoom-subscribe.mov'),
    vignettePng,
  });
  const overlays = [...plan.overlays];
  const totalChars = dir.copy.reduce((a, l) => a + l.length, 0);
  let cursor = 0.2e6;
  const cues: { cue: SubtitleCue }[] = [];
  dir.copy.forEach((text, i) => {
    const span = (voiceDurUs * (text.length / totalChars)) | 0;
    cues.push({
      cue: { index: i + 1, startUs: Math.round(cursor), endUs: Math.round(cursor + span), text },
    });
    cursor += span;
  });
  const subStyle = {
    ...SUBTITLE_PRESETS.shorts,
    emphasizeKeywords: true,
    animation: 'pop' as const,
  };
  const burn = subtitleBurnPlan(
    null,
    createInitialTimeline('m', Math.round(totalSec * 1e6), 30),
    subStyle,
    plan.subtitlePos,
    cues,
  );
  burn.forEach((fr: BurnFrameSpec, i: number) => {
    const c = createCanvas(BURN_RASTER_W, BURN_RASTER_H);
    drawSubtitle(
      c.getContext('2d') as unknown as DrawCtx,
      BURN_RASTER_W,
      BURN_RASTER_H,
      fr.wrapped,
      subStyle,
      fr.emphasis ? new Set(fr.emphasis) : undefined,
    );
    const png = join(outDir, `cue-${i}.png`);
    writeFileSync(png, c.toBuffer('image/png'));
    overlays.push(burnFrameToOverlay(fr, png, `cue-${i}`));
  });

  // 5) 렌더.
  console.log('4) 렌더…');
  const timeline = createInitialTimeline('m', Math.round(totalSec * 1e6), 30);
  const edl = timelineToEdl(timeline, join(ROOT, 'assets/broll', `${dir.bgMood}.mp4`));
  const outMp4 = join(outDir, 'promo.mp4');
  await renderEdl(edl, outMp4, {
    overlays,
    frameW: W,
    frameH: H,
    inputHasAudio: false,
    voicePath: voiceWav,
    voiceStartUs: 200_000,
    quality: 'high',
  });
  const final = await probeMedia(outMp4);
  console.log(
    `✅ ${outMp4} — ${(final.durationUs / 1e6).toFixed(1)}s · ${dir.template}/${dir.bgMood}`,
  );
  await exec('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    '1.5',
    '-i',
    outMp4,
    '-frames:v',
    '1',
    join(outDir, 'poster.png'),
  ]);
}
void main();
