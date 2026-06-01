import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type DrawCtx,
  type EditCommand,
  type EditorState,
  SUBTITLE_PRESETS,
  applyCommand,
  buildTranscriptModel,
  createInitialTimeline,
  drawSubtitle,
  planAndPreview,
  plannerManifest,
  timelineToEdl,
} from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { isLlmAvailable, llmPlanProvider } from '@dawn-cut/sidecar-llm';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

// P3-LLM 데모: 진짜 로컬 LLM(llama.cpp + Qwen2.5-1.5B)이 자유형 한국어를 plan으로 바꾸는 걸
// 사람이 볼 수 있게 output/llm/ 에 아카이빙한다. 룰 플래너가 못 하는 자유형/복합 요청이 핵심.
// 모델/바이너리 없으면 자동 skip. verify에는 미포함(무거운 ops).
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'output/sources');
const OUT = resolve(ROOT, 'output');
const CLIP = join(SRC, 'clip.mp4');
const haveAssets = existsSync(CLIP);
const llm = isLlmAvailable();
const out = (...p: string[]) => {
  const dir = join(OUT, ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, p[p.length - 1]!);
};
const fmt = (us: number) => `${(us / 1e6).toFixed(2)}s`;

function labelPng(text: string): Buffer {
  const c = createCanvas(1000, 150);
  const style = { ...SUBTITLE_PRESETS.korean, fontScale: 0.62 };
  drawSubtitle(c.getContext('2d') as unknown as DrawCtx, 1000, 150, text, style);
  return c.toBuffer('image/png');
}

const minimalState = (mediaId: string, durationUs: number, fps: number): EditorState => ({
  timeline: createInitialTimeline(mediaId, durationUs, fps),
  transcript: buildTranscriptModel([], mediaId, 'ko'),
});

describe.skipIf(!haveAssets || !llm.available)('LLM editing demo (로컬 LLM, 실제 추론)', () => {
  it('자유형 한국어 → 로컬 LLM plan을 output/llm/plan.md 에 아카이빙', async () => {
    const probe = await probeMedia(CLIP);
    const state = minimalState('clip', probe.durationUs, probe.fps || 30);
    const manifest = plannerManifest();

    // 룰 플래너가 못 하거나(복합/자막) 정형 키워드가 아닌 자유형 표현들.
    const inputs = [
      '전체적으로 좀 더 따뜻하고 아늑한 느낌으로 만들어줘',
      '쨍하고 생동감 있게, 쇼츠st 느낌으로 가줘',
      '자막을 노란색으로 키우고 굵게 해줘',
      '영상 톤을 차분하게 가라앉혀줘',
      '어... 음... 같은 말버릇 좀 정리해줄래?',
    ];
    const lines: string[] = [
      '# 자유형 자연어 → 로컬 LLM 편집 plan',
      '',
      `모델: \`${llm.modelPath}\` · grammar: plannerGrammar(안전 부분집합) · ChatML`,
      '',
    ];
    for (const nl of inputs) {
      const { plan, report, errors } = await planAndPreview(nl, state, llmPlanProvider, manifest);
      const desc =
        plan.length === 0 ? '(plan 없음)' : plan.map((c) => `\`${describeCmd(c)}\``).join(', ');
      lines.push(
        `### "${nl}"`,
        `- plan: ${desc}`,
        `- dryRun: ok=${report.ok}, 길이 ${fmt(report.beforeDurationUs)}→${fmt(report.afterDurationUs)}` +
          (errors.length ? `, errors=${errors.length}` : ''),
        '',
      );
      // biome-ignore lint/suspicious/noConsole: demo output
      console.log(`[LLM] "${nl}" → ${desc}`);
    }
    const md = out('llm', 'plan.md');
    writeFileSync(md, `${lines.join('\n')}\n`);
    expect(existsSync(md)).toBe(true);
  });

  it('자유형 색보정 요청 → LLM plan → 커맨드 버스 → before/after mp4 + gif', async () => {
    const probe = await probeMedia(CLIP);
    const dur = Math.min(probe.durationUs, 6_000_000);
    const state = minimalState('clip', dur, probe.fps || 30);
    const nl = '전체적으로 좀 더 따뜻하고 아늑한 느낌으로 만들어줘';

    const { plan, report } = await planAndPreview(nl, state, llmPlanProvider, plannerManifest());
    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(`[LLM-EDIT] "${nl}" → ${plan.map(describeCmd).join(', ')} (ok=${report.ok})`);
    expect(plan.length).toBeGreaterThan(0);

    // LLM이 제안한 모든 명령을 커맨드 버스로 커밋(룩/자막 변경, 길이 불변).
    let cur = state;
    for (const cmd of plan) cur = applyCommand(cur, cmd).after;
    expect(cur.timeline.durationProgram).toBe(state.timeline.durationProgram);

    const fw = probe.width;
    const fh = probe.height;
    const beforeMp4 = out('llm', 'before.mp4');
    const afterMp4 = out('llm', 'after.mp4');
    await renderEdl(timelineToEdl(state.timeline, CLIP), beforeMp4, {
      overlays: [mkLabel('원본', dur, 0.19)],
      frameW: fw,
      frameH: fh,
    });
    await renderEdl(timelineToEdl(cur.timeline, CLIP), afterMp4, {
      overlays: [mkLabel('로컬 AI: 자유형 명령', dur, 0.06)],
      frameW: fw,
      frameH: fh,
    });

    const compare = out('llm', 'llm-before-after.mp4');
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      beforeMp4,
      '-i',
      afterMp4,
      '-filter_complex',
      '[0:v][1:v]hstack=inputs=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      compare,
    ]);
    const gif = out('llm', 'llm-before-after.gif');
    const pal = out('tmp', 'llmpal.png');
    const vf = 'fps=12,scale=640:-2:flags=lanczos';
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      compare,
      '-vf',
      `${vf},palettegen`,
      pal,
    ]);
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      compare,
      '-i',
      pal,
      '-lavfi',
      `${vf}[x];[x][1:v]paletteuse`,
      '-loop',
      '0',
      gif,
    ]);
    expect(existsSync(compare)).toBe(true);
    expect(existsSync(gif)).toBe(true);
  });
});

function describeCmd(c: EditCommand): string {
  if (c.type === 'applyColorgrade') return `applyColorgrade:${c.preset}`;
  if (c.type === 'replaceSubtitleStyle' || c.type === 'setSubtitleStyle') return c.type;
  return c.type;
}

function mkLabel(text: string, dur: number, x: number): import('@dawn-cut/core').OverlayClip {
  const png = out('tmp', `llm-${text.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 8)}.png`);
  writeFileSync(png, labelPng(text));
  return {
    id: `lbl-${text.slice(0, 4)}`,
    kind: 'image',
    src: png,
    x,
    y: 0.03,
    scale: x < 0.1 ? 0.85 : 0.62,
    opacity: 1,
    startUs: 0,
    endUs: dur,
    z: 100,
  };
}
