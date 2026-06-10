// 1회성 데모 스크립트 — MCP 헤드리스 렌더의 자막 번인을 output/에 아카이브 (issue #1 검증 캡쳐).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  type Word,
  buildTranscriptModel,
  createInitialTimeline,
  makeProject,
  serializeProject,
} from '@dawn-cut/core';
import { DawnSession } from '@dawn-cut/mcp/session';
import { probeMedia } from '@dawn-cut/sidecar-ffmpeg';

const ROOT = resolve(import.meta.dirname, '..');
const SAMPLE = join(ROOT, 'fixtures/sample.mp4');
const OUT_DIR = join(ROOT, 'output/mcp-burn');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
const probe = await probeMedia(SAMPLE);
const dur = Math.min(probe.durationUs, 3_000_000);
const words: Word[] = [
  { id: 'm:w0', text: '에이전트가', sourceStart: 0, sourceEnd: 900_000, confidence: 1, mediaId: 'm' },
  { id: 'm:w1', text: '직접 만든', sourceStart: 900_000, sourceEnd: 1_800_000, confidence: 1, mediaId: 'm' },
  { id: 'm:w2', text: '자막입니다', sourceStart: 1_800_000, sourceEnd: 2_700_000, confidence: 1, mediaId: 'm' },
];
const project = makeProject(
  SAMPLE,
  buildTranscriptModel(words, 'm', 'ko'),
  createInitialTimeline('m', dur, probe.fps || 30),
  { subtitleStyle: { preset: 'shorts' } as never },
);
const dawnPath = join(OUT_DIR, 'demo.dawn');
writeFileSync(dawnPath, serializeProject(project), 'utf8');

const s = new DawnSession();
s.open(dawnPath);
const res = await s.render(join(OUT_DIR, 'demo-burn.mp4'));
console.log('rendered:', res);
}
void main();
