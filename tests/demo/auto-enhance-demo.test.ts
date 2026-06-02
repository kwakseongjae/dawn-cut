import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  appendAudit,
  applyCommand,
  autoEnhanceParams,
  buildTranscriptModel,
  createInitialTimeline,
  timelineToEdl,
  verifyAudit,
} from '@dawn-cut/core';
import { analyzeVideo, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { describe, expect, it } from 'vitest';

// 데모: 1탭 적응형 자동 보정 — 실제 요리 클립을 분석(signalstats)해 보기 좋게 보정한다.
// 앱의 autoEnhance() 흐름을 그대로: analyzeVideo → autoEnhanceParams → applyAutoEnhance(command bus
// +감사) → renderEdl. before/after mp4 + after gif를 output/auto-enhance/에 아카이빙.
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const COOK = join(ROOT, 'output/sources/ko-cook.mp4');
const WHISPER = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const haveAssets = existsSync(COOK) && existsSync(WHISPER);
const SECS = 10;
const out = (...p: string[]) => {
  const dir = join(ROOT, 'output', ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, p[p.length - 1]!);
};

describe.skipIf(!haveAssets)('자동 보정 데모 — 둔한 클립 → 1탭으로 화사하게', () => {
  it('analyzeVideo → autoEnhanceParams → applyAutoEnhance(command bus) → before/after 렌더', async () => {
    // 짧은 슬라이스 전사(EditorState 구성용 — 길이/sync 검증).
    const wav = out('tmp', 'ae.wav');
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
    const timeline = createInitialTimeline('cook', SECS * 1_000_000, 30);

    // 분석 + 순수 매핑.
    const stats = await analyzeVideo(COOK, { sampleSec: SECS });
    const eq = autoEnhanceParams(stats);

    // command bus로 적용(앱과 동일) + 해시체인 감사.
    const cmd = { type: 'applyAutoEnhance', eq } as const;
    const { after, removedProgramUs } = applyCommand({ timeline, transcript }, cmd);
    const audit = appendAudit([], cmd, removedProgramUs);
    expect(verifyAudit(audit)).toBe(true);
    expect(removedProgramUs).toBe(0); // 비파괴(길이 불변)

    const before = out('auto-enhance', 'cook-before.mp4');
    const afterMp4 = out('auto-enhance', 'cook-after.mp4');
    await renderEdl(timelineToEdl(timeline, COOK), before, {});
    await renderEdl(timelineToEdl(after.timeline, COOK), afterMp4, {});

    // after를 공유용 gif로도.
    const gif = out('auto-enhance', 'cook-after.gif');
    const pal = out('tmp', 'aepal.png');
    const vf = 'fps=11,scale=-2:420:flags=lanczos';
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-t',
      '8',
      '-i',
      afterMp4,
      '-vf',
      `${vf},palettegen=stats_mode=diff`,
      pal,
    ]);
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-t',
      '8',
      '-i',
      afterMp4,
      '-i',
      pal,
      '-lavfi',
      `${vf}[x];[x][1:v]paletteuse=dither=bayer`,
      '-loop',
      '0',
      gif,
    ]);

    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(
      `[AUTO-ENHANCE] YAVG=${stats.yavg.toFixed(1)} SATAVG=${stats.satavg.toFixed(1)} → ` +
        `sat×${eq.saturation} contrast×${eq.contrast} bright${eq.brightness! >= 0 ? '+' : ''}${eq.brightness} gamma×${eq.gamma} → ${afterMp4}`,
    );
    expect(existsSync(afterMp4)).toBe(true);
    expect(existsSync(gif)).toBe(true);
  }, 180_000);
});
