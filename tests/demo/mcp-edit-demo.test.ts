import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  buildTranscriptModel,
  createInitialTimeline,
  deserializeProject,
  makeProject,
  serializeProject,
  timelineToEdl,
} from '@dawn-cut/core';
import { DawnSession } from '@dawn-cut/mcp/session';
import { renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { describe, expect, it } from 'vitest';

// P4 데모: 외부 AI가 MCP tool로 dawn-cut을 조작하는 것과 동일한 경로(DawnSession)를 실제 요리
// 프로젝트에 돌려, 도구 호출 트레이스 + 해시체인 감사로그를 output/mcp/session-log.md 에 남기고,
// MCP가 적용한 편집(따뜻한 색보정)을 실제 영상으로 렌더한다. 테스트 전용(미배포).
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
const probe = async (p: string) => {
  const { stdout } = await exec('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate',
    '-of',
    'json',
    p,
  ]);
  const s = JSON.parse(stdout).streams[0] as {
    width: number;
    height: number;
    r_frame_rate: string;
  };
  const [n, d] = s.r_frame_rate.split('/').map(Number);
  return { width: s.width, height: s.height, fps: Math.round((n ?? 30) / (d || 1)) };
};

describe.skipIf(!haveAssets)('MCP 데모 — 외부 AI 제어(DawnSession) on 실제 프로젝트', () => {
  it('open→manifest→dry_run→apply→save→audit 트레이스 + MCP 편집 영상', async () => {
    // 1) 실제 요리 클립(앞 8s)으로 .dawn 프로젝트를 만든다.
    const SECS = 8;
    const pr = await probe(COOK);
    const wav = out('tmp', 'mcp.wav');
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
    const timeline = createInitialTimeline('cook', SECS * 1_000_000, pr.fps || 30);
    const projPath = out('mcp', 'project.dawn');
    writeFileSync(projPath, serializeProject(makeProject(COOK, transcript, timeline)));

    // 2) MCP 서버의 세션(외부 AI가 tool로 호출하는 것과 동일 경로)으로 편집한다.
    const s = new DawnSession();
    const log: string[] = ['# MCP 세션 — 외부 AI가 tool로 dawn-cut을 조작한 트레이스', ''];
    const step = (tool: string, args: unknown, result: unknown) => {
      log.push(
        `### ${tool}(${JSON.stringify(args)})`,
        '```json',
        JSON.stringify(result, null, 2),
        '```',
        '',
      );
    };

    const opened = s.open(projPath);
    step('open_project', { path: 'project.dawn' }, opened);

    const verbs = s.manifest().map((t) => t.name);
    step('command_manifest', {}, { verbs });
    expect(verbs).toContain('applyColorgrade');

    // 외부 AI가 내릴 법한 편집: 따뜻한 색보정 + 자막 쇼츠 스타일.
    const commands = [
      { type: 'applyColorgrade', preset: 'warm' },
      {
        type: 'replaceSubtitleStyle',
        style: { color: '#ffffff', emphasisColor: '#ffe14d', fontWeight: '800', strokeWidth: 12 },
      },
    ];

    const dry = s.dryRun(commands);
    step('dry_run', { commands }, dry);
    expect(dry.ok).toBe(true);

    const applied = s.apply(commands as Parameters<DawnSession['apply']>[0]);
    step('apply', { commands }, applied);
    expect(applied.auditCount).toBe(2);
    expect(applied.auditVerified).toBe(true);

    const savedPath = out('mcp', 'edited.dawn');
    step('save_project', { path: 'edited.dawn' }, s.save(savedPath));

    const audit = s.auditLog();
    step(
      'audit_log',
      {},
      {
        verified: audit.verified,
        chain: audit.entries.map((e) => ({
          seq: e.seq,
          cmd: (e.command as { type: string }).type,
          hash: `${e.hash.slice(0, 12)}…`,
        })),
      },
    );

    writeFileSync(out('mcp', 'session-log.md'), `${log.join('\n')}\n`);

    // 3) MCP가 적용한 편집(저장된 .dawn)을 실제 영상으로 렌더 — 외부 AI 편집 → 실제 결과물.
    const saved = deserializeProject(readFileSync(savedPath, 'utf8'));
    const mp4 = out('mcp', 'edited.mp4');
    await renderEdl(timelineToEdl(saved.timeline, COOK), mp4, {
      frameW: pr.width,
      frameH: pr.height,
    });
    const gif = out('mcp', 'edited.gif');
    const pal = out('tmp', 'mcp-pal.png');
    const vf = 'fps=11,scale=560:-2:flags=lanczos';
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      mp4,
      '-vf',
      `${vf},palettegen=stats_mode=diff`,
      pal,
    ]);
    await exec('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      mp4,
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
      `[MCP] open→manifest→dry_run→apply(audit ${applied.auditCount}, verified ${applied.auditVerified})→save → ${mp4}`,
    );
    expect(existsSync(out('mcp', 'session-log.md'))).toBe(true);
    expect(existsSync(mp4)).toBe(true);
  }, 120_000);
});
