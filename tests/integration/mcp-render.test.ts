import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildTranscriptModel,
  createInitialTimeline,
  makeProject,
  serializeProject,
} from '@dawn-cut/core';
import { DawnSession } from '@dawn-cut/mcp/session';
import { probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { describe, expect, it } from 'vitest';

// MCP render tool: 외부 AI 파이프라인의 마지막 단계(open→apply→render)를 실제 ffmpeg로 검증.
const SAMPLE = resolve(process.cwd(), 'fixtures/sample.mp4');

describe.skipIf(!existsSync(SAMPLE))('MCP render tool (DawnSession.render, 실제 ffmpeg)', () => {
  it('open(.dawn) → apply(vivid 색보정) → render → 실제 mp4 산출', async () => {
    const probe = await probeMedia(SAMPLE);
    const dur = Math.min(probe.durationUs, 3_000_000); // 앞 ~3s만(빠르게)
    const project = makeProject(
      SAMPLE,
      buildTranscriptModel([], 'm', 'ko'),
      createInitialTimeline('m', dur, probe.fps || 30),
    );
    const dir = mkdtempSync(join(tmpdir(), 'dawn-mcp-render-'));
    const dawnPath = join(dir, 'p.dawn');
    writeFileSync(dawnPath, serializeProject(project), 'utf8');

    const s = new DawnSession();
    s.open(dawnPath);
    s.apply([{ type: 'applyColorgrade', preset: 'vivid' }] as Parameters<DawnSession['apply']>[0]);

    const out = join(dir, 'out.mp4');
    const res = await s.render(out);
    expect(existsSync(out)).toBe(true);
    expect(res.durationUs).toBeGreaterThan(0);
  }, 60_000);
});
