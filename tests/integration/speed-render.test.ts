import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyCommand,
  buildTranscriptModel,
  createInitialTimeline,
  splitClipAt,
  timelineToEdl,
  videoClips,
} from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// B5 — 배속 실렌더: 출력 길이 == 프로그램 길이(setpts/atempo 정산), 배속+전환 동시 정확.
const SAMPLE = resolve(process.cwd(), 'fixtures/sample.mp4');
const FRAME_US = 33_334;
const tx = buildTranscriptModel([], 'm', 'und');

describe('B5 speed render', () => {
  it('2× — 출력 길이 == 원본/2 (±2frame), 오디오 스트림 유지', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-b5-2x-'));
    const probe = await probeMedia(SAMPLE);
    const t0 = createInitialTimeline('m', probe.durationUs, 30);
    const { after } = applyCommand(
      { timeline: t0, transcript: tx },
      { type: 'setSpeed', speed: 2 },
    );
    const out = join(dir, 'x2.mp4');
    await renderEdl(timelineToEdl(after.timeline, SAMPLE), out, {});
    const final = await probeMedia(out);
    expect(Math.abs(final.durationUs - probe.durationUs / 2)).toBeLessThanOrEqual(2 * FRAME_US);
    expect(final.hasAudio).toBe(true);
  }, 60_000);

  it('0.5× — 출력 길이 == 원본×2 (±2frame)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-b5-half-'));
    const probe = await probeMedia(SAMPLE);
    const t0 = createInitialTimeline('m', probe.durationUs, 30);
    const { after } = applyCommand(
      { timeline: t0, transcript: tx },
      { type: 'setSpeed', speed: 0.5 },
    );
    const out = join(dir, 'half.mp4');
    await renderEdl(timelineToEdl(after.timeline, SAMPLE), out, {});
    const final = await probeMedia(out);
    expect(Math.abs(final.durationUs - probe.durationUs * 2)).toBeLessThanOrEqual(2 * FRAME_US);
  }, 60_000);

  it('부분 배속(앞 클립만 2×) + crossfade — 출력 길이 == 프로그램 길이 (±2frame)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dawn-b5-mix-'));
    const probe = await probeMedia(SAMPLE);
    const timeline = splitClipAt(createInitialTimeline('m', probe.durationUs, 30), 4_000_000);
    const first = videoClips(timeline)[0]!;
    let st = { timeline, transcript: tx };
    st = {
      ...st,
      timeline: applyCommand(st, { type: 'setSpeed', speed: 2, clipId: first.id }).after.timeline,
    };
    st = {
      ...st,
      timeline: applyCommand(st, { type: 'addTransition', kind: 'crossfade', durationUs: 400_000 })
        .after.timeline,
    };
    const edl = timelineToEdl(st.timeline, SAMPLE);
    const out = join(dir, 'mix.mp4');
    await renderEdl(edl, out, {});
    const final = await probeMedia(out);
    expect(Math.abs(final.durationUs - st.timeline.durationProgram)).toBeLessThanOrEqual(
      2 * FRAME_US,
    );
  }, 60_000);
});
