// 자막 퀄리티 실측 — 실제 한국어 영상을 전사해 어절/신뢰도/cue 분절을 리포트한다.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  assessSpeech,
  buildTranscriptModel,
  createInitialTimeline,
  lowConfidenceWords,
  transcriptToCues,
} from '@dawn-cut/core';
import { extractAudio, probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { transcribe } from '@dawn-cut/sidecar-stt';

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'output/stt-quality');
mkdirSync(OUT, { recursive: true });

const TARGETS = ['ko-talk.mp4', 'ko-cook.mp4', 'ko-review.mp4'];

async function main() {
  const lines: string[] = [];
  for (const name of TARGETS) {
    const path = join(ROOT, 'output/sources', name);
    const probe = await probeMedia(path).catch(() => null);
    if (!probe) {
      lines.push(`## ${name}: (파일 없음 — 건너뜀)`);
      continue;
    }
    const dir = mkdtempSync(join(tmpdir(), 'dawn-stt-q-'));
    const t0 = Date.now();
    const { wavPath } = await extractAudio(path, join(dir, 'a.wav'));
    const tr = await transcribe(wavPath, { mediaId: 'm' });
    const elapsed = (Date.now() - t0) / 1000;
    const speech = assessSpeech(tr.words, probe.durationUs);
    const transcript = buildTranscriptModel(tr.words, 'm', tr.language);
    const timeline = createInitialTimeline('m', probe.durationUs, probe.fps || 30);
    const cues = transcriptToCues(transcript, timeline);
    const low = lowConfidenceWords(transcript);
    const text = tr.words.map((w) => w.text).join(' ');
    lines.push(
      `## ${name} — ${(probe.durationUs / 1e6).toFixed(1)}s`,
      `- 어절 ${tr.words.length} · cue ${cues.length} · 전사 ${elapsed.toFixed(1)}s(${(probe.durationUs / 1e6 / elapsed).toFixed(1)}x 실시간)`,
      `- speechLikely=${speech.speechLikely} 중앙신뢰도=${speech.medianConfidence.toFixed(2)} 밀도=${speech.wordsPerSec.toFixed(2)}어절/s`,
      `- 검수 대상(신뢰도<0.6): ${low.length}어절 (${((low.length / Math.max(1, tr.words.length)) * 100).toFixed(0)}%) — ${low
        .slice(0, 6)
        .map((w) => `${w.text}(${w.confidence.toFixed(2)})`)
        .join(' ')}`,
      `- 전문: ${text}`,
      '',
    );
  }
  const report = lines.join('\n');
  writeFileSync(join(OUT, 'report.md'), report);
  console.log(report);
}
void main();
