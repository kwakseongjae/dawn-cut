import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type DrawCtx,
  type EditorState,
  type OverlayClip,
  type SubtitleStyle,
  applyCommand,
  buildTranscriptModel,
  captionFrames,
  createInitialTimeline,
  drawSubtitle,
  pickKeywords,
  stylePackById,
  timelineToEdl,
  transcriptToCues,
  wrapCaption,
} from '@dawn-cut/core';
import { renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { createCanvas } from '@napi-rs/canvas';
import { beforeAll, describe, expect, it } from 'vitest';

// P0 #3 데모: '1클릭 스타일 팩'이 command bus(applyCommand)를 거쳐 실제 편집 결과물이 되는 걸 보인다.
// 같은 요리 클립에 서로 다른 팩(viral-punch=reveal, mukbang-sizzle=karaoke)을 적용 → 팩이 색·자막
// 스타일·애니메이션·말버릇 컷을 통째로 바꾼다. 렌더는 '적용된 state.subtitleStyle'을 그대로 따른다.
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const COOK = join(ROOT, 'output/sources/ko-cook.mp4');
const WHISPER = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const haveAssets = existsSync(COOK) && existsSync(WHISPER);
const SECS = 14;
const out = (...p: string[]) => {
  const dir = join(ROOT, 'output', ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, p[p.length - 1]!);
};
const probe = async (p: string) => {
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
const toGif = async (mp4: string, gif: string, w: number) => {
  const pal = out('tmp', 'ppal.png');
  const vf = `fps=11,scale=${w}:-2:flags=lanczos`;
  await exec('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-t',
    '12',
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
    '12',
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

let base: { state: EditorState; w: number; h: number } | null = null;

describe.skipIf(!haveAssets)('스타일 팩 1클릭 — command bus 적용 → 실제 결과물', () => {
  beforeAll(async () => {
    const pr = await probe(COOK);
    const wav = out('tmp', 'packs.wav');
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
    base = {
      state: {
        transcript: buildTranscriptModel(tr.words, 'cook', tr.language),
        timeline: createInitialTimeline('cook', SECS * 1_000_000, pr.fps || 30),
      },
      w: pr.width,
      h: pr.height,
    };
  }, 120_000);

  // 적용된 state로 자막 오버레이 생성 — 팩의 subtitleStyle(애니 포함)을 그대로 따른다.
  function captionOverlays(state: EditorState): OverlayClip[] {
    const style = (state.subtitleStyle ?? {}) as SubtitleStyle;
    const anim = style.animation ?? 'none';
    const cues = transcriptToCues(state.transcript, state.timeline, {
      maxWordsPerCue: 4,
      maxCharsPerCue: 13,
      maxGapUs: 400_000,
    });
    const ov: OverlayClip[] = [];
    let fi = 0;
    for (const cue of cues) {
      const keys = new Set(pickKeywords(cue.text, { max: 1 }));
      for (const fr of captionFrames(cue, anim)) {
        const emphasis = anim === 'karaoke' && fr.activeWord ? new Set([fr.activeWord]) : keys;
        const png = out('tmp', `pk-cap-${fi}.png`);
        const c = createCanvas(1100, 240);
        drawSubtitle(
          c.getContext('2d') as unknown as DrawCtx,
          1100,
          240,
          wrapCaption(fr.text, { maxCharsPerLine: 16, maxLines: 2 }),
          style,
          emphasis,
        );
        writeFileSync(png, c.toBuffer('image/png'));
        ov.push({
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
    return ov;
  }

  it.each([{ packId: 'viral-punch' }, { packId: 'mukbang-sizzle' }])(
    '[$packId] 팩을 command bus로 적용 → 자막+색+(말버릇) 결과물 렌더',
    async ({ packId }) => {
      if (!base) throw new Error('no transcript');
      const pack = stylePackById(packId);
      expect(pack).toBeDefined();

      // 팩 = plan. command bus로 순서대로 적용(GUI 승인/ MCP apply와 동일 경로).
      let st: EditorState = { ...base.state, subtitleStyle: {} };
      for (const cmd of pack!.commands) {
        const { after } = applyCommand(st, cmd);
        st = {
          timeline: after.timeline,
          transcript: after.transcript,
          subtitleStyle: after.subtitleStyle ?? {},
        };
      }
      // 팩이 자막 스타일/애니를 실제로 세팅했는지 확인.
      expect((st.subtitleStyle as SubtitleStyle).animation).toBeTruthy();

      const mp4 = out('packs', `cook-${packId}.mp4`);
      await renderEdl(timelineToEdl(st.timeline, COOK), mp4, {
        overlays: captionOverlays(st),
        frameW: base.w,
        frameH: base.h,
      });
      await toGif(mp4, out('packs', `cook-${packId}.gif`), 620);

      // biome-ignore lint/suspicious/noConsole: demo output
      console.log(`[PACK] ${packId}: ${pack!.commands.length} commands(command bus) → ${mp4}`);
      expect(existsSync(mp4)).toBe(true);
    },
    150_000,
  );
});
