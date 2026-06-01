import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type DrawCtx,
  type OverlayClip,
  SUBTITLE_PRESETS,
  buildTranscriptModel,
  createInitialTimeline,
  detectFillers,
  drawSubtitle,
  extractChapters,
  formatChapters,
  formatSrt,
  pickKeywords,
  timelineToEdl,
  transcriptToCues,
  wrapCaption,
} from '@dawn-cut/core';
import { extractAudio, probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

/** 자막 cue를 PNG로 래스터화(렌더러와 동일한 core drawSubtitle 사용, 헤드리스).
 *  emphasis = 키워드 강조 어절 집합(있으면 그 단어만 style.emphasisColor로). */
function rasterizeCaption(
  text: string,
  style: Parameters<typeof drawSubtitle>[4],
  emphasis?: Set<string>,
): Buffer {
  const w = 1000;
  const h = 150;
  const c = createCanvas(w, h);
  drawSubtitle(c.getContext('2d') as unknown as DrawCtx, w, h, text, style, emphasis);
  return c.toBuffer('image/png');
}

// 외부 실제 에셋(output/sources/*, scripts/output-demo-assets.sh)으로 파이프라인을
// 돌려 사람이 확인할 결과물을 output/ 에 아카이빙한다. verify 에는 포함되지 않는다.
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'output/sources');
const OUT = resolve(ROOT, 'output');
const KO = join(SRC, 'korean-talk.mp4');
const CLIP = join(SRC, 'clip.mp4');
const PHOTO = join(SRC, 'photo.jpg');
const GIF = join(SRC, 'earth.gif');
const WHISPER = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const haveAssets = existsSync(KO) && existsSync(CLIP) && existsSync(PHOTO) && existsSync(GIF);
const out = (...p: string[]) => {
  const dir = join(OUT, ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, p[p.length - 1]!);
};

describe.skipIf(!haveAssets || !existsSync(WHISPER))('output demo (real external assets)', () => {
  it('한국어 클립 → 전사·챕터·자막을 output/korean/ 에 아카이빙', async () => {
    const probe = await probeMedia(KO);
    const wav = out('tmp', 'ko.wav');
    await extractAudio(KO, wav);
    const tr = await transcribe(wav, { mediaId: 'korean', lang: 'ko' });
    const transcript = buildTranscriptModel(tr.words, 'korean', tr.language);
    const timeline = createInitialTimeline('korean', probe.durationUs, probe.fps || 30);

    const fullText = transcript.order.map((id) => transcript.words[id]!.text).join(' ');
    // 데모 클립은 짧으므로 minChapter를 12s로 낮춰 토픽 경계를 보여준다.
    const chapters = extractChapters(transcript, timeline, { minChapterUs: 12_000_000 });
    const chaptersTxt = formatChapters(chapters);
    const srt = formatSrt(transcriptToCues(transcript, timeline));
    const fillers = detectFillers(transcript);

    writeFileSync(out('korean', 'transcript.txt'), `${fullText}\n`);
    writeFileSync(out('korean', 'chapters.txt'), `${chaptersTxt}\n`);
    writeFileSync(out('korean', 'subtitles.srt'), srt);

    // 콘솔에 핵심 결과를 찍어 둔다(사람 확인용).
    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(
      `\n[KO] ${(probe.durationUs / 1e6).toFixed(1)}s · words=${tr.words.length} · ` +
        `chapters=${chapters.length} · fillers=${fillers.length}\n--- chapters.txt ---\n${chaptersTxt}\n`,
    );

    expect(tr.words.length).toBeGreaterThan(10);
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    expect(existsSync(out('korean', 'chapters.txt'))).toBe(true);
  });

  it('외부 영상에 색보정(cinematic) + 사진/gif 오버레이 합성 → output/overlay/', async () => {
    const probe = await probeMedia(CLIP);
    const timeline = createInitialTimeline('clip', probe.durationUs, probe.fps || 30);
    // P2-B: 클립에 색보정(cinematic) 이펙트 적용 → 렌더 시 filter_complex로 합성.
    const clipId = timeline.tracks[0]!.clips[0]!;
    const graded = {
      ...timeline,
      clips: {
        ...timeline.clips,
        [clipId]: {
          ...timeline.clips[clipId]!,
          effects: [{ kind: 'color', preset: 'cinematic' } as const],
        },
      },
    };
    const edl = timelineToEdl(graded, CLIP);
    const dur = probe.durationUs;
    const overlays: OverlayClip[] = [
      {
        id: 'photo',
        kind: 'image',
        src: PHOTO,
        x: 0.05,
        y: 0.08,
        scale: 0.34,
        opacity: 1,
        startUs: 0,
        endUs: dur,
        z: 0,
      },
      {
        id: 'earth',
        kind: 'gif',
        src: GIF,
        x: 0.7,
        y: 0.62,
        scale: 0.26,
        opacity: 1,
        startUs: 0,
        endUs: dur,
        z: 1,
      },
    ];
    const mp4 = out('overlay', 'clip-with-overlays.mp4');
    await renderEdl(edl, mp4, { overlays, frameW: probe.width, frameH: probe.height });
    // 빠른 확인용 스틸 프레임(2초 지점).
    const png = out('overlay', 'frame.png');
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      '2',
      '-i',
      mp4,
      '-frames:v',
      '1',
      png,
    ]);

    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(`\n[OVERLAY] ${CLIP} (${probe.width}x${probe.height}) + photo + gif → ${mp4}\n`);
    expect(existsSync(mp4)).toBe(true);
    expect(existsSync(png)).toBe(true);
  });

  it('한국어 자막 번인 mp4 + GIF → output/korean/ (움직이는 결과물)', async () => {
    const probe = await probeMedia(KO);
    const wav = out('tmp', 'ko2.wav');
    await extractAudio(KO, wav);
    const tr = await transcribe(wav, { mediaId: 'korean', lang: 'ko' });
    const transcript = buildTranscriptModel(tr.words, 'korean', tr.language);
    const timeline = createInitialTimeline('korean', probe.durationUs, probe.fps || 30);

    // cue마다 어절 줄바꿈 후 PNG로 굽고, 해당 시간창에만 보이는 오버레이로 합성.
    // 키워드 강조(ROI top1): cue마다 핵심 어절을 골라 노란색으로 칠한다.
    const style = { ...SUBTITLE_PRESETS.korean, emphasisColor: '#ffe14d' };
    const pos = { x: 0.1, y: 0.76, scale: 0.8 };
    const overlays: OverlayClip[] = transcriptToCues(transcript, timeline).map((cue, i) => {
      const png = out('tmp', `cap-${i}.png`);
      const keywords = new Set(pickKeywords(cue.text, { max: 2 }));
      writeFileSync(
        png,
        rasterizeCaption(
          wrapCaption(cue.text, { maxCharsPerLine: 16, maxLines: 2 }),
          style,
          keywords,
        ),
      );
      return {
        id: `cap${i}`,
        kind: 'image',
        src: png,
        x: pos.x,
        y: pos.y,
        scale: pos.scale,
        opacity: 1,
        startUs: cue.startUs,
        endUs: cue.endUs,
        z: 100,
      };
    });
    const edl = timelineToEdl(timeline, KO);
    const subbed = out('korean', 'subtitled.mp4');
    await renderEdl(edl, subbed, { overlays, frameW: probe.width, frameH: probe.height });

    // 공유용 GIF: 앞 8초, 480px, 12fps (palettegen → 작고 선명).
    const gif = out('korean', 'subtitled-preview.gif');
    const pal = out('tmp', 'pal.png');
    const vf = 'fps=12,scale=480:-2:flags=lanczos';
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-t',
      '8',
      '-i',
      subbed,
      '-vf',
      `${vf},palettegen`,
      pal,
    ]);
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-t',
      '8',
      '-i',
      subbed,
      '-i',
      pal,
      '-lavfi',
      `${vf}[x];[x][1:v]paletteuse`,
      '-loop',
      '0',
      gif,
    ]);

    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(`\n[KO-SUB] ${overlays.length} cues burned → ${subbed} (+ ${gif})\n`);
    expect(overlays.length).toBeGreaterThan(1);
    expect(existsSync(subbed)).toBe(true);
    expect(existsSync(gif)).toBe(true);
  });
});
