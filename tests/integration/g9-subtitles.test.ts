import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildTranscriptModel,
  createInitialTimeline,
  formatSrt,
  frameUs,
  removeSilences,
  timelineToEdl,
  transcriptToCues,
  validateCues,
} from '@dawn-cut/core';
import {
  detectSilences,
  extractAudio,
  hasSubtitleStream,
  probeMedia,
  renderEdl,
  writeSrt,
} from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const WHISPER_BIN = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const FRAME = frameUs(30);
const hasWhisper = existsSync(WHISPER_BIN);

describe.skipIf(!hasWhisper)('G9 subtitles — SRT + burn-in (real ffmpeg/whisper)', () => {
  it('builds valid cues from edited timeline, writes SRT, burns into export', async () => {
    // real pipeline: transcribe → initial timeline → remove silences
    const { durationUs, fps } = await probeMedia(SAMPLE);
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g9-'));
    const wav = join(dir, 'audio.wav');
    await extractAudio(SAMPLE, wav);
    const tr = await transcribe(wav, { mediaId: 'm1' });
    const transcript = buildTranscriptModel(tr.words, 'm1', tr.language);
    const timeline0 = createInitialTimeline('m1', durationUs, fps || 30);
    const silences = await detectSilences(SAMPLE, { noiseDb: -30, minSilenceUs: 500_000 });
    const { after } = removeSilences(timeline0, 'm1', silences, 0);

    // cues in program coords
    const cues = transcriptToCues(transcript, after);
    expect(cues.length).toBeGreaterThan(0);
    expect(validateCues(cues, after)).toEqual([]);
    // cues stay within the edited program duration
    for (const c of cues) expect(c.endUs).toBeLessThanOrEqual(after.durationProgram + FRAME);

    const srt = formatSrt(cues);
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);
    const srtPath = resolve(ROOT, 'artifacts/g9-subtitles.srt');
    await writeSrt(srtPath, srt);

    // mux soft subtitle track into export
    const edl = timelineToEdl(after, SAMPLE);
    const out = resolve(ROOT, 'artifacts/g9-subtitled.mp4');
    await renderEdl(edl, out, { subtitlesPath: srtPath });
    expect(existsSync(out)).toBe(true);

    // output carries a subtitle stream and preserves program duration ±1 frame
    expect(await hasSubtitleStream(out)).toBe(true);
    const rendered = await probeMedia(out);
    expect(Math.abs(rendered.durationUs - edl.totalDuration)).toBeLessThanOrEqual(FRAME);

    writeFileSync(
      resolve(ROOT, 'artifacts/g9-cues.json'),
      JSON.stringify({ cueCount: cues.length, cues, totalDuration: edl.totalDuration }, null, 2),
    );
  });
});
