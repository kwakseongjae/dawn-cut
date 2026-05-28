import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInitialTimeline, frameUs, timelineToEdl } from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { synthesizeTts } from '@dawn-cut/sidecar-tts';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const SAMPLE = resolve(ROOT, 'fixtures/sample.mp4');
const OUT = resolve(ROOT, 'artifacts/g17b-voicemix.mp4');

describe('G17b voiceover mix — TTS mixed into export (real say + ffmpeg)', () => {
  it('mixes a synthesized voiceover over the program audio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g17b-'));
    const voice = join(dir, 'voice.wav');
    await synthesizeTts('dawn cut adds a voiceover', voice, { voice: 'Samantha' });
    expect(existsSync(voice)).toBe(true);

    const { durationUs } = await probeMedia(SAMPLE);
    const timeline = createInitialTimeline('m1', durationUs, 30);
    const edl = timelineToEdl(timeline, SAMPLE);
    await renderEdl(edl, OUT, { voicePath: voice, voiceStartUs: 500_000 });

    expect(existsSync(OUT)).toBe(true);
    const out = await probeMedia(OUT);
    expect(out.hasAudio).toBe(true);
    // amix duration=first → output length stays at the program (base) length
    expect(Math.abs(out.durationUs - edl.totalDuration)).toBeLessThanOrEqual(3 * frameUs(30));
  });
});
