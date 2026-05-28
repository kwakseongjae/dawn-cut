import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  buildTranscriptModel,
  createInitialTimeline,
  deleteWordRange,
  formatSrt,
  makeProject,
  removeSilences,
  serializeProject,
  timelineToEdl,
  transcriptToCues,
  validateOverlays,
  videoClips,
} from '@dawn-cut/core';
import type { OverlayClip } from '@dawn-cut/core';
import {
  detectSilences,
  extractAudio,
  hasSubtitleStream,
  probeMedia,
  renderEdl,
  writeSrt,
} from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const TALK = resolve(ROOT, 'demo/talk.mp4');
const OUT = resolve(ROOT, 'demo-output');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const hasWhisper = existsSync(WHISPER_BIN);
const exec = promisify(execFile);
const o = (f: string) => join(OUT, f);

describe.skipIf(!hasWhisper || !existsSync(TALK))('DEMO — full pipeline on real assets', () => {
  beforeAll(() => mkdirSync(join(OUT, 'overlays'), { recursive: true }));

  it('import → transcribe → edit → silence-cut → export mp4/gif/srt + project', async () => {
    const summary: Record<string, unknown> = {};

    // 1) probe + transcribe (real whisper)
    const probe = await probeMedia(TALK);
    summary.source = { durationUs: probe.durationUs, fps: probe.fps, hasAudio: probe.hasAudio };
    const wav = o('_audio.wav');
    await extractAudio(TALK, wav);
    const tr = await transcribe(wav, { mediaId: 'demo' });
    const transcript = buildTranscriptModel(tr.words, 'demo', tr.language);
    writeFileSync(
      o('transcript.txt'),
      transcript.order.map((id) => transcript.words[id]!.text).join(' '),
    );
    writeFileSync(
      o('transcript.json'),
      JSON.stringify({ language: tr.language, words: tr.words }, null, 2),
    );
    summary.transcript = { language: tr.language, wordCount: transcript.order.length };

    // 2) text-based edit: delete the first 3 words
    let timeline = createInitialTimeline('demo', probe.durationUs, probe.fps || 30);
    const fullDur = timeline.durationProgram;
    const d = deleteWordRange(timeline, transcript, transcript.order[0]!, transcript.order[2]!);
    timeline = d.after;
    summary.afterDeleteWordsUs = timeline.durationProgram;

    // 3) auto silence removal (real ffmpeg detection)
    const silences = await detectSilences(TALK, { noiseDb: -30, minSilenceUs: 500_000 });
    const rs = removeSilences(timeline, 'demo', silences, 0);
    timeline = rs.after;
    summary.silencesDetected = silences.length;
    summary.finalDurationUs = timeline.durationProgram;
    summary.clips = videoClips(timeline).length;
    summary.removedUs = fullDur - timeline.durationProgram;

    // 4) exports
    const edl = timelineToEdl(timeline, TALK);
    const srt = formatSrt(transcriptToCues(transcript, timeline));
    await writeSrt(o('subtitles.srt'), srt);
    await renderEdl(edl, o('edited.mp4'), { subtitlesPath: o('subtitles.srt') });
    await renderEdl(edl, o('edited.gif'), { format: 'gif' });
    writeFileSync(o('project.dawn'), serializeProject(makeProject(TALK, transcript, timeline)));

    // 5) REAL image overlay compositing: burn photo1 (top-right) + photo2 (bottom-left)
    for (const img of ['photo1.jpg', 'photo2.jpg']) {
      const src = resolve(ROOT, 'demo', img);
      if (existsSync(src)) copyFileSync(src, join(OUT, 'overlays', img));
    }
    const overlays: OverlayClip[] = [
      {
        id: 'p1',
        kind: 'image',
        src: resolve(ROOT, 'demo/photo1.jpg'),
        x: 0.6,
        y: 0.06,
        scale: 0.34,
        opacity: 1,
        startUs: 0,
        endUs: timeline.durationProgram,
        z: 0,
      },
      {
        id: 'p2',
        kind: 'image',
        src: resolve(ROOT, 'demo/photo2.jpg'),
        x: 0.06,
        y: 0.58,
        scale: 0.34,
        opacity: 0.85,
        startUs: 0,
        endUs: timeline.durationProgram,
        z: 1,
      },
    ].filter((o) => existsSync(o.src));
    summary.overlays = overlays.length;
    if (overlays.length) {
      expect(validateOverlays(overlays, timeline.durationProgram)).toEqual([]);
      await renderEdl(edl, o('edited-overlay.mp4'), {
        overlays,
        frameW: probe.width,
        frameH: probe.height,
      });
      // capture a representative frame for visual proof
      await exec('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        '2',
        '-i',
        o('edited-overlay.mp4'),
        '-frames:v',
        '1',
        o('overlay-frame.png'),
      ]);
      expect(existsSync(o('edited-overlay.mp4'))).toBe(true);
      expect(existsSync(o('overlay-frame.png'))).toBe(true);
    }

    // ── assertions: every output exists & is valid ──
    expect(existsSync(o('edited.mp4'))).toBe(true);
    expect(existsSync(o('edited.gif'))).toBe(true);
    expect(existsSync(o('subtitles.srt'))).toBe(true);
    expect(existsSync(o('project.dawn'))).toBe(true);
    expect(await hasSubtitleStream(o('edited.mp4'))).toBe(true);
    const outProbe = await probeMedia(o('edited.mp4'));
    summary.exportedMp4DurationUs = outProbe.durationUs;
    expect(outProbe.durationUs).toBeGreaterThan(0);
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> /);

    writeFileSync(o('summary.json'), JSON.stringify(summary, null, 2));
  });
});
