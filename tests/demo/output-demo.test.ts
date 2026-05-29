import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type OverlayClip,
  buildTranscriptModel,
  createInitialTimeline,
  detectFillers,
  extractChapters,
  formatChapters,
  formatSrt,
  timelineToEdl,
  transcriptToCues,
} from '@dawn-cut/core';
import { extractAudio, probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { describe, expect, it } from 'vitest';

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

  it('외부 영상에 사진+gif 오버레이 합성 → output/overlay/ 에 아카이빙', async () => {
    const probe = await probeMedia(CLIP);
    const timeline = createInitialTimeline('clip', probe.durationUs, probe.fps || 30);
    const edl = timelineToEdl(timeline, CLIP);
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
});
