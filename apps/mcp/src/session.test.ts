import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Word,
  buildTranscriptModel,
  createInitialTimeline,
  makeProject,
  serializeProject,
} from '@dawn-cut/core';
import { describe, expect, it } from 'vitest';
import { DawnSession } from './session.js';

function writeProject(): { path: string; dir: string } {
  const words: Word[] = [
    ['안녕하세요', 0, 0.6],
    ['반갑습니다', 0.6, 1.4],
  ].map(([text, s, e], i) => ({
    id: `m:w${i}`,
    text: text as string,
    sourceStart: Math.round((s as number) * 1_000_000),
    sourceEnd: Math.round((e as number) * 1_000_000),
    confidence: 1,
    mediaId: 'm',
  }));
  const transcript = buildTranscriptModel(words, 'm', 'ko');
  const timeline = createInitialTimeline('m', 2_000_000, 30);
  const project = makeProject('/media/clip.mp4', transcript, timeline);
  const dir = mkdtempSync(join(tmpdir(), 'dawn-mcp-'));
  const path = join(dir, 'p.dawn');
  writeFileSync(path, serializeProject(project), 'utf8');
  return { path, dir };
}

describe('DawnSession — MCP command-bus over .dawn', () => {
  it('open → manifest → dry_run → apply(colorgrade) → save: 상태 변경 + 감사체인 검증', () => {
    const { path, dir } = writeProject();
    const s = new DawnSession();

    const opened = s.open(path);
    expect(opened.mediaPath).toBe('/media/clip.mp4');
    expect(opened.summary.durationUs).toBe(2_000_000);

    // 명령 표면에 9 verb가 보인다.
    expect(s.manifest().map((t) => t.name)).toContain('applyColorgrade');

    const cmds = [{ type: 'applyColorgrade', preset: 'cinematic' }];

    // dry_run은 미리보기(상태 불변): ok=true, 룩 변경이라 길이 보존.
    const report = s.dryRun(cmds);
    expect(report.ok).toBe(true);
    expect(report.afterDurationUs).toBe(2_000_000);
    // dry_run 후에도 세션 요약은 그대로(자막스타일 없음/길이 동일).
    expect(s.summary().durationUs).toBe(2_000_000);

    // apply = 유일한 상태 변경 지점 + 감사 1건.
    const res = s.apply(cmds as Parameters<DawnSession['apply']>[0]);
    expect(res.auditCount).toBe(1);
    expect(res.auditVerified).toBe(true);
    expect(res.auditHead).toBeTruthy();
    expect(res.summary.durationUs).toBe(2_000_000); // EDL-INV: 색보정은 길이 불변

    // save + 재오픈 → 색보정 효과가 클립에 영속된다.
    const out = join(dir, 'out.dawn');
    expect(s.save(out).path).toBe(out);
    const reopened = JSON.parse(readFileSync(out, 'utf8')) as {
      timeline: { clips: Record<string, { effects?: { kind: string }[] }> };
    };
    const clip = Object.values(reopened.timeline.clips)[0]!;
    expect(clip.effects?.some((ef) => ef.kind === 'color')).toBe(true);
  });

  it('open 전 호출은 throw, 잘못된 명령은 dry_run에서 ok:false', () => {
    const s = new DawnSession();
    expect(() => s.summary()).toThrow();
    const { path } = writeProject();
    s.open(path);
    const bad = s.dryRun([{ type: 'nope-verb' }]);
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
  });

  it('여러 명령 순차 적용 → 감사체인 누적·검증', () => {
    const { path } = writeProject();
    const s = new DawnSession();
    s.open(path);
    const res = s.apply([
      { type: 'applyColorgrade', preset: 'warm' },
      { type: 'removeFillers' },
    ] as Parameters<DawnSession['apply']>[0]);
    expect(res.auditCount).toBe(2);
    expect(res.auditVerified).toBe(true);
  });
});
