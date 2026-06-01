import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type DrawCtx,
  type OverlayClip,
  SUBTITLE_PRESETS,
  buildTranscriptModel,
  captionFrames,
  createInitialTimeline,
  drawSubtitle,
  pickKeywords,
  timelineToEdl,
  transcriptToCues,
  wrapCaption,
} from '@dawn-cut/core';
import { renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

// 갤러리: 다양한 실제 레퍼런스 클립에 dawn-cut 기능을 입혀 before/after 결과물을 output/gallery/에
// 일괄 생성한다(테스트 전용, 미배포). 색보정 변주(시네마틱/웜/펀치) × 장르 + 요리 클립 자동 자막.
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'output/sources');
const WHISPER = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const out = (...p: string[]) => {
  const dir = join(ROOT, 'output', ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, p[p.length - 1]!);
};

interface Clip {
  id: string;
  file: string;
  mode: 'color' | 'caption';
  grade: 'cinematic' | 'warm' | 'punch' | 'cool';
  secs: number;
  label: string; // 장르 라벨(after 측에 표기)
}
const CLIPS: Clip[] = [
  {
    id: 'scenic',
    file: 'gallery/g_scenic.mp4',
    mode: 'color',
    grade: 'cinematic',
    secs: 8,
    label: '드론·시네마틱',
  },
  {
    id: 'city',
    file: 'gallery/g_city.mp4',
    mode: 'color',
    grade: 'punch',
    secs: 8,
    label: '야경·펀치',
  },
  {
    id: 'beauty',
    file: 'gallery/g_beauty.mp4',
    mode: 'color',
    grade: 'warm',
    secs: 8,
    label: '뷰티·웜',
  },
  { id: 'food', file: 'ko-food.mp4', mode: 'color', grade: 'warm', secs: 8, label: '먹방·웜' },
  { id: 'pet', file: 'gallery/g_pet.mp4', mode: 'color', grade: 'warm', secs: 8, label: '반려·웜' },
  {
    id: 'cook',
    file: 'ko-cook.mp4',
    mode: 'caption',
    grade: 'warm',
    secs: 14,
    label: '레시피·자동자막+웜',
  },
];

const probeRes = async (p: string) => {
  const { stdout } = await exec('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate',
    '-of',
    'json',
    p,
  ]);
  const s = JSON.parse(stdout).streams[0] as {
    width: number;
    height: number;
    r_frame_rate: string;
  };
  const [n, d] = s.r_frame_rate.split('/').map(Number);
  return { width: s.width, height: s.height, fps: Math.round((n ?? 30) / (d || 1)) };
};

function labelPng(text: string, w: number, h: number, scale: number): Buffer {
  const c = createCanvas(w, h);
  const style = { ...SUBTITLE_PRESETS.korean, fontScale: scale };
  drawSubtitle(c.getContext('2d') as unknown as DrawCtx, w, h, text, style);
  return c.toBuffer('image/png');
}
const corner = (text: string, dur: number, x: number): OverlayClip => {
  const png = out('tmp', `lbl-${text.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 10)}.png`);
  writeFileSync(png, labelPng(text, 900, 130, 0.5));
  return {
    id: `l${x}`,
    kind: 'image',
    src: png,
    x,
    y: 0.04,
    scale: 0.42,
    opacity: 1,
    startUs: 0,
    endUs: dur,
    z: 90,
  };
};

const gradedClip = (tl: ReturnType<typeof createInitialTimeline>, preset: string) => {
  const id = tl.tracks[0]!.clips[0]!;
  return {
    ...tl,
    clips: {
      ...tl.clips,
      [id]: { ...tl.clips[id]!, effects: [{ kind: 'color', preset } as const] },
    },
  };
};

const toGif = async (mp4: string, gif: string, secs: number, w: number) => {
  const pal = out('tmp', `gpal-${secs}-${w}.png`);
  const vf = `fps=11,scale=${w}:-2:flags=lanczos`;
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

const hstack = async (a: string, b: string, o: string) => {
  await exec('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    a,
    '-i',
    b,
    '-filter_complex',
    '[0:v][1:v]hstack=inputs=2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    o,
  ]);
};

describe('갤러리 — 다양한 실제 레퍼런스 × dawn-cut 기능', () => {
  it.each(CLIPS)(
    '[$id] $label',
    async (clip) => {
      const file = join(SRC, clip.file);
      if (!existsSync(file)) {
        // biome-ignore lint/suspicious/noConsole: demo skip note
        console.log(`[GALLERY] skip ${clip.id} (소스 없음: ${clip.file})`);
        return;
      }
      const pr = await probeRes(file);
      const tl = createInitialTimeline(clip.id, clip.secs * 1_000_000, pr.fps || 30);
      const before = out('gallery', `${clip.id}-before.mp4`);
      const after = out('gallery', `${clip.id}-after.mp4`);
      const afterOv: OverlayClip[] = [
        corner(`dawn-cut · ${clip.label}`, clip.secs * 1_000_000, 0.04),
      ];

      if (clip.mode === 'caption' && existsSync(WHISPER)) {
        const wav = out('tmp', `${clip.id}.wav`);
        await exec('ffmpeg', [
          '-y',
          '-loglevel',
          'error',
          '-t',
          String(clip.secs),
          '-i',
          file,
          '-ar',
          '16000',
          '-ac',
          '1',
          wav,
        ]);
        const tr = await transcribe(wav, { mediaId: clip.id, lang: 'ko' });
        const transcript = buildTranscriptModel(tr.words, clip.id, tr.language);
        const cues = transcriptToCues(transcript, tl, {
          maxWordsPerCue: 4,
          maxCharsPerCue: 13,
          maxGapUs: 400_000,
        });
        const style = SUBTITLE_PRESETS.koreanShorts;
        // 단어별 reveal 애니메이션: cue를 captionFrames로 펼쳐 어절이 말과 함께 또박또박 등장.
        let fi = 0;
        for (const cue of cues) {
          const keys = new Set(pickKeywords(cue.text, { max: 1 }));
          for (const fr of captionFrames(cue, 'reveal')) {
            const png = out('tmp', `${clip.id}-cap-${fi}.png`);
            const c = createCanvas(1100, 240);
            drawSubtitle(
              c.getContext('2d') as unknown as DrawCtx,
              1100,
              240,
              wrapCaption(fr.text, { maxCharsPerLine: 16, maxLines: 2 }),
              style,
              keys,
            );
            writeFileSync(png, c.toBuffer('image/png'));
            afterOv.push({
              id: `c${fi}`,
              kind: 'image',
              src: png,
              x: 0.08,
              y: 0.64,
              scale: 0.84,
              opacity: 1,
              startUs: fr.startUs,
              endUs: fr.endUs,
              z: 100,
            });
            fi++;
          }
        }
        // biome-ignore lint/suspicious/noConsole: demo output
        console.log(
          `[GALLERY] ${clip.id}: ${cues.length} cues → ${fi} reveal 프레임 + ${clip.grade} 색보정`,
        );
      }

      await renderEdl(timelineToEdl(tl, file), before, {
        overlays: [corner('원본', clip.secs * 1_000_000, 0.04)],
        frameW: pr.width,
        frameH: pr.height,
      });
      await renderEdl(timelineToEdl(gradedClip(tl, clip.grade), file), after, {
        overlays: afterOv,
        frameW: pr.width,
        frameH: pr.height,
      });

      const cmp = out('gallery', `${clip.id}-before-after.mp4`);
      await hstack(before, after, cmp);
      await toGif(
        cmp,
        out('gallery', `${clip.id}-before-after.gif`),
        clip.secs,
        pr.height >= pr.width ? 460 : 720,
      );

      expect(existsSync(cmp)).toBe(true);
    },
    150_000,
  );
});
