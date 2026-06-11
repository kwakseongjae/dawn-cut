// 편집기 쇼케이스 — 실제 한국어 요리 영상(원본) → 던컷 자동 편집본.
// 에이전트와 동일한 MCP 세션 경로: 전사 → 무음 컷(셀렉터) → vivid → 자막 번인 + 9:16 렌더.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  buildTranscriptModel,
  createInitialTimeline,
  makeProject,
  serializeProject,
} from '@dawn-cut/core';
import { DawnSession } from '@dawn-cut/mcp/session';
import { extractAudio, probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'output/sources/ko-cook.mp4');
const OUT = join(ROOT, 'output/edit-showcase');
mkdirSync(OUT, { recursive: true });

async function main() {
  console.log('1) 전사(로컬 whisper)…');
  const probe = await probeMedia(SRC);
  const tmp = mkdtempSync(join(tmpdir(), 'dawn-show-'));
  const { wavPath } = await extractAudio(SRC, join(tmp, 'a.wav'));
  const tr = await transcribe(wavPath, { mediaId: 'm' });
  console.log(`   어절 ${tr.words.length}`);

  const project = makeProject(
    SRC,
    buildTranscriptModel(tr.words, 'm', tr.language),
    createInitialTimeline('m', probe.durationUs, probe.fps || 30),
    { subtitleStyle: { preset: 'shorts', emphasizeKeywords: true } as never },
  );
  const dawnPath = join(OUT, 'showcase.dawn');
  writeFileSync(dawnPath, serializeProject(project), 'utf8');

  const s = new DawnSession();
  s.open(dawnPath);

  console.log('2) 무음 컷(셀렉터) + 말버릇 제거 + vivid (command bus)…');
  const silences = s.findSilences(450).map(({ start, end }) => ({ start, end }));
  const res = s.apply([
    ...(silences.length ? [{ type: 'removeSilences', silences, padUs: 80_000 } as const] : []),
    { type: 'removeFillers' } as const,
    { type: 'applyColorgrade', preset: 'vivid' } as const,
    { type: 'highlightKeyword' } as const,
  ]);
  console.log(
    `   −${(res.removedProgramUs / 1e6).toFixed(1)}s 컷 · 감사 ${res.auditCount}개 · 체인검증 ${res.auditVerified}`,
  );

  console.log('3) 렌더 — 자막 번인 + 9:16…');
  const outMp4 = join(OUT, 'dawncut-edited.mp4');
  const r = await s.render(outMp4, '9:16');
  console.log(
    `✅ ${outMp4} — ${(r.durationUs / 1e6).toFixed(1)}s (원본 ${(probe.durationUs / 1e6).toFixed(1)}s) · 자막 프레임 ${r.burnedSubtitleFrames}`,
  );
  for (const sec of [3, 20]) {
    await exec('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(sec), '-i', outMp4, '-frames:v', '1', join(OUT, `poster-${sec}s.png`)]);
  }
}
void main();
