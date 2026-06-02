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

// D8 데모: 가로 소스 → 세로 9:16 쇼츠. 자동 자막(reveal) + 따뜻한 색보정 + 중앙 크롭 리프레이밍.
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const COOK = join(ROOT, 'output/sources/ko-cook.mp4');
const WHISPER = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const haveAssets = existsSync(COOK) && existsSync(WHISPER);
const SECS = 12;
const out = (...p: string[]) => {
  const dir = join(ROOT, 'output', ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, p[p.length - 1]!);
};

describe.skipIf(!haveAssets)('리프레이밍 데모 — 가로 → 세로 9:16 쇼츠', () => {
  it('자동 자막 + 웜 + 9:16 중앙크롭 → 세로 쇼츠 mp4/gif', async () => {
    const { stdout } = await exec('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate',
      '-of',
      'json',
      COOK,
    ]);
    const sv = JSON.parse(stdout).streams[0] as {
      width: number;
      height: number;
      r_frame_rate: string;
    };
    const [fn, fd] = sv.r_frame_rate.split('/').map(Number);
    const fps = Math.round((fn ?? 30) / (fd || 1));
    const wav = out('tmp', 'rf.wav');
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-t',
      String(SECS),
      '-i',
      COOK,
      '-ar',
      '16000',
      '-ac',
      '1',
      wav,
    ]);
    const tr = await transcribe(wav, { mediaId: 'cook', lang: 'ko' });
    const transcript = buildTranscriptModel(tr.words, 'cook', tr.language);
    const tl = {
      ...createInitialTimeline('cook', SECS * 1_000_000, fps),
    };
    // 웜 색보정.
    const id = tl.tracks[0]!.clips[0]!;
    const graded = {
      ...tl,
      clips: {
        ...tl.clips,
        [id]: { ...tl.clips[id]!, effects: [{ kind: 'color', preset: 'warm' } as const] },
      },
    };

    // 자막 오버레이(reveal) — 9:16 크롭 프레임 기준 좌표(renderEdl이 크롭 후 합성).
    const style = SUBTITLE_PRESETS.koreanShorts;
    const subs: OverlayClip[] = [];
    let fi = 0;
    for (const cue of transcriptToCues(transcript, tl, {
      maxWordsPerCue: 4,
      maxCharsPerCue: 12,
      maxGapUs: 400_000,
    })) {
      const keys = new Set(pickKeywords(cue.text, { max: 1 }));
      for (const fr of captionFrames(cue, 'reveal')) {
        const png = out('tmp', `rf-cap-${fi}.png`);
        const c = createCanvas(900, 220);
        drawSubtitle(
          c.getContext('2d') as unknown as DrawCtx,
          900,
          220,
          wrapCaption(fr.text, { maxCharsPerLine: 10, maxLines: 2 }),
          style,
          keys,
        );
        writeFileSync(png, c.toBuffer('image/png'));
        subs.push({
          id: `c${fi}`,
          kind: 'image',
          src: png,
          x: 0.06,
          y: 0.7,
          scale: 0.88,
          opacity: 1,
          startUs: fr.startUs,
          endUs: fr.endUs,
          z: 100,
        });
        fi++;
      }
    }

    const mp4 = out('reframe', 'cook-vertical.mp4');
    await renderEdl(timelineToEdl(graded, COOK), mp4, {
      overlays: subs,
      frameW: sv.width,
      frameH: sv.height,
      reframe: '9:16',
    });
    const gif = out('reframe', 'cook-vertical.gif');
    const pal = out('tmp', 'rfpal.png');
    const vf = 'fps=11,scale=-2:640:flags=lanczos';
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-t',
      '10',
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
      '10',
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

    // 출력이 세로 9:16인지 확인.
    const { stdout: o2 } = await exec('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      mp4,
    ]);
    const [w, h] = o2.trim().split(',').map(Number);
    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(
      `[REFRAME] ${sv.width}x${sv.height} → ${w}x${h} (9:16) + 자막 ${fi}프레임 → ${mp4}`,
    );
    expect((w ?? 1) / (h ?? 1)).toBeLessThan(1); // 세로
    expect(existsSync(gif)).toBe(true);
  }, 180_000);
});
