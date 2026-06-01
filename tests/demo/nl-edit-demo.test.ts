import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type DrawCtx,
  type EditorState,
  type OverlayClip,
  SUBTITLE_PRESETS,
  applyCommand,
  buildTranscriptModel,
  createInitialTimeline,
  drawSubtitle,
  dryRunCommands,
  ruleBasedPlan,
  timelineToEdl,
} from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

// P3 데모: "자연어로 편집"이 실제로 동작함을 사람이 볼 수 있는 결과물로 남긴다.
//   사용자 입력(한국어) → ruleBasedPlan(모델0) → dryRunCommands(미리보기) →
//   applyCommand(커맨드 버스 커밋) → 렌더. verify에는 포함되지 않는다(외부 에셋 필요).
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'output/sources');
const OUT = resolve(ROOT, 'output');
const CLIP = join(SRC, 'clip.mp4');
const haveAssets = existsSync(CLIP);
const out = (...p: string[]) => {
  const dir = join(OUT, ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, p[p.length - 1]!);
};

/** 한국어 라벨을 core drawSubtitle로 PNG 래스터화(헤드리스, ffmpeg 폰트 의존 제거). */
function labelPng(text: string): Buffer {
  const w = 1000;
  const h = 150;
  const c = createCanvas(w, h);
  const style = { ...SUBTITLE_PRESETS.korean, fontScale: 0.62 };
  drawSubtitle(c.getContext('2d') as unknown as DrawCtx, w, h, text, style);
  return c.toBuffer('image/png');
}

const fmt = (us: number) => `${(us / 1e6).toFixed(2)}s`;

describe.skipIf(!haveAssets)('NL editing demo (자연어 편집, 실제 동작)', () => {
  it('여러 한국어 명령 → 룰 플래너 plan + dryRun diff를 output/nl/plan.txt 에 아카이빙', async () => {
    const probe = await probeMedia(CLIP);
    const timeline = createInitialTimeline('clip', probe.durationUs, probe.fps || 30);
    const transcript = buildTranscriptModel([], 'clip', 'ko');
    const state: EditorState = { timeline, transcript };

    // 다양한 자연어 의도가 어떤 명령으로 매핑되는지(혹은 거부되는지)를 그대로 기록한다.
    const inputs = [
      '시네마틱하게', // → applyColorgrade cinematic
      '따뜻하게 만들어줘', // → applyColorgrade warm
      '차갑게 해줘', // → applyColorgrade cool
      '색감 쨍하게', // → applyColorgrade punch
      '말버릇 빼줘', // → removeFillers
      '오늘 점심 뭐 먹지', // → [] (편집 의도 아님 → 환각 금지)
    ];
    const lines: string[] = ['# 자연어 → 편집 명령 (룰 플래너, 모델 0)\n'];
    for (const nl of inputs) {
      const commands = ruleBasedPlan(nl, state);
      const { report } = dryRunCommands(state, commands);
      const verbs =
        commands.length === 0
          ? '(이해 못 함 — 아무 것도 하지 않음)'
          : commands.map((c) => c.type).join(', ');
      lines.push(
        `"${nl}"\n  → 명령: ${verbs}\n` +
          `  → 미리보기: ok=${report.ok} 길이 ${fmt(report.beforeDurationUs)}→${fmt(
            report.afterDurationUs,
          )} (제거 ${fmt(report.removedProgramUs)})\n`,
      );
    }
    const planTxt = out('nl', 'plan.txt');
    writeFileSync(planTxt, `${lines.join('\n')}\n`);
    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(`\n[NL-PLAN]\n${lines.join('\n')}\n→ ${planTxt}\n`);

    // 정형 명령은 인식, 비편집 문장은 거부.
    expect(ruleBasedPlan('시네마틱하게', state).length).toBe(1);
    expect(ruleBasedPlan('오늘 점심 뭐 먹지', state).length).toBe(0);
    expect(existsSync(planTxt)).toBe(true);
  });

  it('"시네마틱하게" → 커맨드 버스 commit → before/after 비교 mp4 + gif', async () => {
    const probe = await probeMedia(CLIP);
    // 데모는 앞 6초만(렌더 시간 단축). 소스를 6초로 캡한 타임라인.
    const dur = Math.min(probe.durationUs, 6_000_000);
    const timeline = createInitialTimeline('clip', dur, probe.fps || 30);
    const transcript = buildTranscriptModel([], 'clip', 'ko');
    const state: EditorState = { timeline, transcript };

    // 1) 자연어 → 플래너 → 미리보기 → 2) applyCommand로 실제 커밋(룩 변경, 길이 불변).
    const commands = ruleBasedPlan('시네마틱하게', state);
    expect(commands.map((c) => c.type)).toEqual(['applyColorgrade']);
    const { report } = dryRunCommands(state, commands);
    expect(report.ok).toBe(true);

    let cur = state;
    for (const cmd of commands) cur = applyCommand(cur, cmd).after;
    // 룩 변경이므로 프로그램 길이는 보존되어야 한다(EDL-INV).
    expect(cur.timeline.durationProgram).toBe(timeline.durationProgram);

    const fw = probe.width;
    const fh = probe.height;
    const beforeOv: OverlayClip[] = [mkLabel('원본', dur, { x: 0.19, y: 0.03, scale: 0.62 })];
    const afterOv: OverlayClip[] = [
      mkLabel('AI 명령: "시네마틱하게"', dur, { x: 0.1, y: 0.03, scale: 0.8 }),
    ];

    const beforeMp4 = out('nl', 'before.mp4');
    const afterMp4 = out('nl', 'after.mp4');
    await renderEdl(timelineToEdl(timeline, CLIP), beforeMp4, {
      overlays: beforeOv,
      frameW: fw,
      frameH: fh,
    });
    await renderEdl(timelineToEdl(cur.timeline, CLIP), afterMp4, {
      overlays: afterOv,
      frameW: fw,
      frameH: fh,
    });

    // 좌(원본)·우(자연어 명령 적용)를 나란히 — 한 화면에서 효과를 본다.
    const compare = out('nl', 'cinematic-before-after.mp4');
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

    // 공유용 GIF(앞 6초, 640px, 12fps, palettegen).
    const gif = out('nl', 'cinematic-before-after.gif');
    const pal = out('tmp', 'nlpal.png');
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

    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(`\n[NL-EDIT] "시네마틱하게" → ${commands[0]?.type} → ${compare} (+ ${gif})\n`);
    expect(existsSync(compare)).toBe(true);
    expect(existsSync(gif)).toBe(true);
  });
});

/** 라벨 PNG를 만들어 시간 전체에 깔리는 오버레이로 반환. */
function mkLabel(
  text: string,
  dur: number,
  pos: { x: number; y: number; scale: number },
): OverlayClip {
  const png = out('tmp', `nl-${text.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 8)}.png`);
  writeFileSync(png, labelPng(text));
  return {
    id: `lbl-${text.slice(0, 4)}`,
    kind: 'image',
    src: png,
    x: pos.x,
    y: pos.y,
    scale: pos.scale,
    opacity: 1,
    startUs: 0,
    endUs: dur,
    z: 100,
  };
}
