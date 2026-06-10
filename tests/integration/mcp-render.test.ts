import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type Word,
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
const exec = promisify(execFile);
const FFMPEG = process.env.DAWN_FFMPEG ?? 'ffmpeg';

/** 영상의 한 지점·영역 평균 RGB(g18과 동일 기법: crop → scale=1:1 → rawvideo 1픽셀). */
async function regionRGB(
  video: string,
  atSec: string,
  crop: string,
): Promise<[number, number, number]> {
  const { stdout } = (await exec(
    FFMPEG,
    ['-y', '-ss', atSec, '-i', video, '-vf', `crop=${crop},scale=1:1`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer', maxBuffer: 1_000_000 },
  )) as unknown as { stdout: Buffer };
  return [stdout[0] ?? 0, stdout[1] ?? 0, stdout[2] ?? 0];
}

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

  it('자막 번인 기본 포함 — 번인 on/off 픽셀 차이로 검증 (issue #1: 에이전트 출력 == GUI 출력)', async () => {
    const probe = await probeMedia(SAMPLE);
    const dur = Math.min(probe.durationUs, 2_000_000);
    // 전체 구간을 덮는 2어절 transcript → cue 1개("안녕하세요 반갑습니다")가 0~1.4s 표시.
    const words: Word[] = [
      { id: 'm:w0', text: '안녕하세요', sourceStart: 0, sourceEnd: 600_000, confidence: 1, mediaId: 'm' },
      { id: 'm:w1', text: '반갑습니다', sourceStart: 600_000, sourceEnd: 1_400_000, confidence: 1, mediaId: 'm' },
    ];
    const project = makeProject(
      SAMPLE,
      buildTranscriptModel(words, 'm', 'ko'),
      createInitialTimeline('m', dur, probe.fps || 30),
    );
    const dir = mkdtempSync(join(tmpdir(), 'dawn-mcp-burn-'));
    const dawnPath = join(dir, 'p.dawn');
    writeFileSync(dawnPath, serializeProject(project), 'utf8');

    const s = new DawnSession();
    s.open(dawnPath);
    const burnt = join(dir, 'out-burn.mp4');
    const plain = join(dir, 'out-plain.mp4');
    const resBurn = await s.render(burnt); // 기본값 = 번인 on
    const resPlain = await s.render(plain, undefined, { burnSubtitles: false });
    expect(resBurn.burnedSubtitleFrames).toBeGreaterThan(0);
    expect(resPlain.burnedSubtitleFrames).toBe(0);

    // 자막 밴드(기본 pos x=0.1,y=0.8,scale=0.8 → 640×360 기준 64,288 512×76)에서
    // 같은 프레임의 평균 RGB가 번인 on/off 간에 분명히 달라야 한다(텍스트 픽셀 합성 증거).
    const bandW = Math.round(0.8 * probe.width);
    const bandH = Math.round((bandW * 150) / 1000);
    const bandX = Math.round(0.1 * probe.width);
    const bandY = Math.min(Math.round(0.8 * probe.height), probe.height - bandH);
    const crop = `${bandW}:${bandH}:${bandX}:${bandY}`;
    const a = await regionRGB(burnt, '0.7', crop);
    const b = await regionRGB(plain, '0.7', crop);
    const diff = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    expect(diff).toBeGreaterThan(10);
  }, 120_000);
});
