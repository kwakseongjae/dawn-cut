import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  buildTranscriptModel,
  createInitialTimeline,
  makeProject,
  serializeProject,
} from '@dawn-cut/core';
import { DawnSession } from '@dawn-cut/mcp/session';
import { shutdownLlm } from '@dawn-cut/sidecar-llm';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { afterAll, describe, expect, it } from 'vitest';

// 캡스톤(P3+P4 융합): 외부 AI가 MCP로 dawn-cut을 '자연어'로 조작 → plan → apply → render → mp4.
// open_project → plan("...") → apply(commands) → render. 같은 command bus + 감사 + dry-run.
const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const COOK = join(ROOT, 'output/sources/ko-cook.mp4');
const WHISPER = resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const haveAssets = existsSync(COOK) && existsSync(WHISPER);
const out = (...p: string[]) => {
  const dir = join(ROOT, 'output', ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, p[p.length - 1]!);
};

afterAll(() => shutdownLlm());

describe.skipIf(!haveAssets)('MCP 캡스톤 — 외부 AI가 자연어로 편집→렌더', () => {
  it('open → plan(자연어) → apply → render → mp4 + 세션 로그', async () => {
    // 1) 실제 요리 클립(앞 10s)으로 .dawn 프로젝트.
    const { stdout } = await exec('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate',
      '-of',
      'json',
      COOK,
    ]);
    const v = JSON.parse(stdout).streams[0] as {
      width: number;
      height: number;
      r_frame_rate: string;
    };
    const [n, d] = v.r_frame_rate.split('/').map(Number);
    const fps = Math.round((n ?? 30) / (d || 1));
    const wav = out('tmp', 'mcpai.wav');
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-t',
      '10',
      '-i',
      COOK,
      '-ar',
      '16000',
      '-ac',
      '1',
      wav,
    ]);
    const tr = await transcribe(wav, { mediaId: 'cook', lang: 'ko' });
    const project = makeProject(
      COOK,
      buildTranscriptModel(tr.words, 'cook', tr.language),
      createInitialTimeline('cook', 10_000_000, fps),
    );
    const dawnPath = out('mcp', 'ai-project.dawn');
    writeFileSync(dawnPath, serializeProject(project));

    // 2) MCP 세션(= 외부 AI 경로). 자연어 지시 → plan → apply → render.
    const s = new DawnSession();
    const opened = s.open(dawnPath);
    const nl = '전체적으로 따뜻하게 색보정하고 말버릇도 정리해줘';
    const planned = await s.plan(nl);
    // biome-ignore lint/suspicious/noConsole: demo output
    console.log(
      `[MCP-AI] "${nl}" → engine=${planned.engine} cmds=${planned.commands.map((c) => c.type).join(',')}`,
    );
    expect(planned.report.ok).toBe(true);

    let auditCount = 0;
    if (planned.commands.length > 0) {
      const res = s.apply(planned.commands);
      auditCount = res.auditCount;
    }
    const mp4 = out('mcp', 'ai-edited.mp4');
    const rendered = await s.render(mp4);

    writeFileSync(
      out('mcp', 'ai-session.md'),
      [
        '# MCP 캡스톤 — 외부 AI가 자연어로 dawn-cut 편집',
        '',
        `자연어 지시: **"${nl}"**`,
        `미디어: \`${opened.mediaPath}\` (${v.width}x${v.height})`,
        '',
        `1. plan(${planned.engine}) → ${planned.commands.map((c) => `\`${c.type}\``).join(', ') || '(없음)'}`,
        `2. dry_run: ok=${planned.report.ok}, 길이 ${(planned.report.beforeDurationUs / 1e6).toFixed(2)}s→${(planned.report.afterDurationUs / 1e6).toFixed(2)}s`,
        `3. apply → 감사 ${auditCount}건`,
        `4. render → \`${mp4}\` (${(rendered.durationUs / 1e6).toFixed(2)}s)`,
        '',
        '> open → plan(자연어) → apply → render. 같은 command bus·불변식·감사로그를 외부 AI가 구동.',
      ].join('\n'),
    );

    expect(existsSync(mp4)).toBe(true);
    expect(rendered.durationUs).toBeGreaterThan(0);
  }, 180_000);
});
