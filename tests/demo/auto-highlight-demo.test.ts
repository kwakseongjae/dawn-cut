import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  appendAudit,
  applyCommand,
  buildTranscriptModel,
  createInitialTimeline,
  timelineToEdl,
  verifyAudit,
} from '@dawn-cut/core';
import { renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { describe, expect, it } from 'vitest';

// 데모: 자동 하이라이트(롱폼→쇼츠) — 긴 한국어 클립을 핵심만 남긴 짧은 클립으로 command bus가 컷.
// "한 프롬프트 → 60초 쇼츠" 와우 루프의 코어 verb(autoHighlight). before/after를 output/에 아카이빙.
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const COOK = join(ROOT, 'output/sources/ko-cook.mp4');
const WHISPER = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const haveAssets = existsSync(COOK) && existsSync(WHISPER);
const SRC_SECS = 40; // 충분한 문장 수 확보
const TARGET_SECS = 12;
const out = (...p: string[]) => {
  const dir = join(ROOT, 'output', ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, p[p.length - 1]!);
};

describe.skipIf(!haveAssets)('자동 하이라이트 데모 — 롱폼 → 핵심만 쇼츠', () => {
  it('transcribe → autoHighlight(command bus) → 길이 단축 + before/after 렌더', async () => {
    const wav = out('tmp', 'hl.wav');
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-t',
      String(SRC_SECS),
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
    const timeline = createInitialTimeline('cook', SRC_SECS * 1_000_000, 30);

    const cmd = { type: 'autoHighlight', targetSeconds: TARGET_SECS } as const;
    const { after, removedProgramUs } = applyCommand({ timeline, transcript }, cmd);
    const audit = appendAudit([], cmd, removedProgramUs);
    expect(verifyAudit(audit)).toBe(true);

    const beforeUs = timeline.durationProgram;
    const afterUs = after.timeline.durationProgram;
    expect(afterUs).toBeLessThan(beforeUs); // 잘렸다
    expect(afterUs).toBeGreaterThan(0);

    const before = out('highlight', 'cook-full.mp4');
    const short = out('highlight', 'cook-highlight.mp4');
    await renderEdl(timelineToEdl(timeline, COOK), before, {});
    await renderEdl(timelineToEdl(after.timeline, COOK), short, {});

    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(
      `[AUTO-HIGHLIGHT] ${(beforeUs / 1e6).toFixed(1)}s → ${(afterUs / 1e6).toFixed(1)}s ` +
        `(target ${TARGET_SECS}s, −${(removedProgramUs / 1e6).toFixed(1)}s) → ${short}`,
    );
    expect(existsSync(short)).toBe(true);
  }, 180_000);
});
