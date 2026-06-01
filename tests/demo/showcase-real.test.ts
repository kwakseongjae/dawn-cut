import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type DrawCtx,
  type EditorState,
  type OverlayClip,
  SUBTITLE_PRESETS,
  buildTranscriptModel,
  createInitialTimeline,
  detectFillers,
  drawSubtitle,
  pickKeywords,
  planAndPreview,
  plannerManifest,
  timelineToEdl,
  transcriptToCues,
  wrapCaption,
} from '@dawn-cut/core';
import { renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { isLlmAvailable, llmPlanProvider, shutdownLlm } from '@dawn-cut/sidecar-llm';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { createCanvas } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ── 실제 콘텐츠 쇼케이스(테스트 전용, output은 gitignore라 미배포) ──
// 외부에서 받은 진짜 한국어 쇼츠로 "raw 클립 → 자동 자막 + 시네마틱 색보정 + 말버릇/자연어 편집"을
// 사람이 체감할 결과물(mp4/gif)로 output/showcase/ 에 남긴다.
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'output/sources');
const OUT = resolve(ROOT, 'output');
const TALK = join(SRC, 'ko-cook.mp4'); // 레시피 내레이션 + 음식 비주얼(STT/자막/키워드/색보정/NL)
const FOOD = join(SRC, 'ko-food.mp4'); // 먹방 비주얼(색보정 대비)
const WHISPER = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const haveAssets = existsSync(TALK) && existsSync(FOOD) && existsSync(WHISPER);
const TALK_SECS = 16; // 데모용 앞 16초.

const out = (...p: string[]) => {
  const dir = join(OUT, ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, p[p.length - 1]!);
};

/** core drawSubtitle로 자막 cue를 PNG 래스터화(키워드는 emphasisColor로 강조). */
function rasterizeCaption(
  text: string,
  style: Parameters<typeof drawSubtitle>[4],
  emph?: Set<string>,
): Buffer {
  const w = 1100;
  const h = 240; // 쇼츠형 큰 글씨가 잘리지 않게 캔버스를 키운다.
  const c = createCanvas(w, h);
  drawSubtitle(c.getContext('2d') as unknown as DrawCtx, w, h, text, style, emph);
  return c.toBuffer('image/png');
}

const probeRes = async (p: string) => {
  const { stdout } = await exec('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    p,
  ]);
  const j = JSON.parse(stdout) as {
    streams: { width: number; height: number; r_frame_rate: string }[];
    format: { duration: string };
  };
  const s = j.streams[0]!;
  const [n, d] = s.r_frame_rate.split('/').map(Number);
  return {
    width: s.width,
    height: s.height,
    fps: Math.round((n ?? 30) / (d || 1)),
    durationUs: Math.round(Number(j.format.duration) * 1e6),
  };
};

const toGif = async (mp4: string, gif: string, secs: number, w = 600) => {
  const pal = out('tmp', `pal-${secs}-${w}.png`);
  const vf = `fps=12,scale=${w}:-2:flags=lanczos`;
  await exec('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-t',
    String(secs),
    '-i',
    mp4,
    '-vf',
    `${vf},palettegen=stats_mode=diff`,
    pal,
  ]);
  await exec('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-t',
    String(secs),
    '-i',
    mp4,
    '-i',
    pal,
    '-lavfi',
    `${vf}[x];[x][1:v]paletteuse=dither=bayer`,
    '-loop',
    '0',
    gif,
  ]);
};

const gradedClip = (timeline: ReturnType<typeof createInitialTimeline>, preset: string) => {
  const id = timeline.tracks[0]!.clips[0]!;
  return {
    ...timeline,
    clips: {
      ...timeline.clips,
      [id]: { ...timeline.clips[id]!, effects: [{ kind: 'color', preset } as const] },
    },
  };
};

// beforeAll에서 한 번만 전사해 공유(STT는 느리다).
let talk: {
  state: EditorState;
  probe: Awaited<ReturnType<typeof probeRes>>;
  fillers: number;
} | null = null;

describe.skipIf(!haveAssets)('실제 콘텐츠 쇼케이스 (real YouTube short)', () => {
  beforeAll(async () => {
    const probe = await probeRes(TALK);
    const wav = out('tmp', 'talk.wav');
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-t',
      String(TALK_SECS),
      '-i',
      TALK,
      '-ar',
      '16000',
      '-ac',
      '1',
      wav,
    ]);
    const tr = await transcribe(wav, { mediaId: 'talk', lang: 'ko' });
    const transcript = buildTranscriptModel(tr.words, 'talk', tr.language);
    const timeline = createInitialTimeline('talk', TALK_SECS * 1_000_000, probe.fps || 30);
    talk = { state: { transcript, timeline }, probe, fillers: detectFillers(transcript).length };
  }, 120_000);

  it('① raw 요리 쇼츠 → 자동 자막(키워드 강조) + 따뜻한 색보정 (before/after)', async () => {
    if (!talk) throw new Error('no transcript');
    const { state, probe } = talk;
    // 쇼츠형: 짧고 펀치감 있는 cue(≤4어절·≤13자) → 한 줄 큰 자막으로 또박또박 뜬다.
    const cues = transcriptToCues(state.transcript, state.timeline, {
      maxWordsPerCue: 4,
      maxCharsPerCue: 13,
      maxGapUs: 400_000,
    });
    expect(cues.length).toBeGreaterThan(2);

    // 자막 PNG 오버레이(쇼츠 프리셋 + cue별 핵심어 1개 노란 강조).
    const style = SUBTITLE_PRESETS.koreanShorts;
    const subs: OverlayClip[] = cues.map((cue, i) => {
      const png = out('tmp', `cap-${i}.png`);
      const keys = new Set(pickKeywords(cue.text, { max: 1 }));
      writeFileSync(
        png,
        rasterizeCaption(wrapCaption(cue.text, { maxCharsPerLine: 16, maxLines: 2 }), style, keys),
      );
      return {
        id: `c${i}`,
        kind: 'image',
        src: png,
        x: 0.08,
        y: 0.64, // 하단 재료 라벨(소주 180ml 등) 위에 자막을 둔다.
        scale: 0.84,
        opacity: 1,
        startUs: cue.startUs,
        endUs: cue.endUs,
        z: 100,
      };
    });

    const fw = probe.width;
    const fh = probe.height;
    // AFTER = 따뜻한 색보정(음식이 먹음직) + 자막. BEFORE = 원본(자막/색보정 없음).
    const after = out('showcase', 'talk-after.mp4');
    const before = out('showcase', 'talk-before.mp4');
    await renderEdl(timelineToEdl(gradedClip(state.timeline, 'warm'), TALK), after, {
      overlays: subs,
      frameW: fw,
      frameH: fh,
    });
    await renderEdl(timelineToEdl(state.timeline, TALK), before, { frameW: fw, frameH: fh });

    // 좌(원본)·우(자동편집) 비교 + 단독 결과 gif.
    const cmp = out('showcase', 'talk-before-after.mp4');
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      before,
      '-i',
      after,
      '-filter_complex',
      '[0:v][1:v]hstack=inputs=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      cmp,
    ]);
    await toGif(cmp, out('showcase', 'talk-before-after.gif'), TALK_SECS, 760);
    await toGif(after, out('showcase', 'talk-after.gif'), TALK_SECS, 420);

    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(`[SHOWCASE] talk: ${cues.length} cues, fillers=${talk.fillers} → ${cmp}`);
    expect(existsSync(cmp)).toBe(true);
    expect(existsSync(out('showcase', 'talk-after.gif'))).toBe(true);
  }, 150_000);

  it('② 음식 쇼츠 → 시네마틱 색보정 before/after (색감 대비)', async () => {
    const probe = await probeRes(FOOD);
    const secs = Math.min(10, Math.floor(probe.durationUs / 1e6));
    const timeline = createInitialTimeline('food', secs * 1_000_000, probe.fps || 30);
    const before = out('showcase', 'food-before.mp4');
    const after = out('showcase', 'food-after.mp4');
    await renderEdl(timelineToEdl(timeline, FOOD), before, {
      frameW: probe.width,
      frameH: probe.height,
    });
    await renderEdl(timelineToEdl(gradedClip(timeline, 'cinematic'), FOOD), after, {
      frameW: probe.width,
      frameH: probe.height,
    });
    const cmp = out('showcase', 'food-before-after.mp4');
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      before,
      '-i',
      after,
      '-filter_complex',
      '[0:v][1:v]hstack=inputs=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      cmp,
    ]);
    await toGif(cmp, out('showcase', 'food-before-after.gif'), secs, 760);
    expect(existsSync(cmp)).toBe(true);
  }, 150_000);

  it.skipIf(!isLlmAvailable().available)(
    '③ B: 실제 한국어 transcript로 로컬 LLM 편집 plan',
    async () => {
      if (!talk) throw new Error('no transcript');
      const inputs = [
        '말버릇 빼줘',
        '시네마틱하게',
        '자막 노란색으로 크게',
        '전체적으로 톤을 차분하게',
      ];
      const lines = [
        '# 실제 쇼츠 transcript 위에서 로컬 LLM 편집 plan',
        '',
        `(말버릇 ${talk.fillers}개 감지된 실제 한국어 클립)`,
        '',
      ];
      for (const nl of inputs) {
        const { plan, report } = await planAndPreview(
          nl,
          talk.state,
          llmPlanProvider,
          plannerManifest(),
        );
        const desc = plan.length
          ? plan
              .map((c) => c.type + (c.type === 'applyColorgrade' ? `:${c.preset}` : ''))
              .join(', ')
          : '(plan 없음)';
        lines.push(`- "${nl}" → ${desc}  (ok=${report.ok})`);
        // biome-ignore lint/suspicious/noConsole: demo output
        console.log(`[SHOWCASE-NL] "${nl}" → ${desc}`);
      }
      writeFileSync(out('showcase', 'nl-real.md'), `${lines.join('\n')}\n`);
      expect(existsSync(out('showcase', 'nl-real.md'))).toBe(true);
    },
    120_000,
  );

  afterAll(() => shutdownLlm());
});
