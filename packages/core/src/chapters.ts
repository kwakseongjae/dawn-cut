// 자동 챕터/타임스탬프 추출 — 전사(어절 타임스탬프)에서 챕터 경계를 찾아
// 유튜브 설명란용 "M:SS 제목" 텍스트를 만든다. 순수 TS, 룰베이스(클라우드 LLM 없음).
import { liveWords, wordToProgram } from './sync.js';
import type { TimelineModel, TranscriptModel } from './types.js';

export interface Chapter {
  startUs: number; // program 좌표(편집 결과 기준)
  title: string;
}

export interface ChapterOptions {
  /** 챕터 최소 길이(µs). 이보다 짧은 챕터는 만들지 않는다. 기본 20s. */
  minChapterUs?: number;
  /** 이보다 큰 program 공백(직전 어절 끝→다음 어절 시작)을 챕터 경계 후보로 본다. 기본 1.2s. */
  gapUs?: number;
  /** 제목 최대 글자수(코드포인트). 기본 30. */
  maxTitleChars?: number;
}

const SENTENCE_END = /[.?!。…]+$/u;
const TRAILING_PUNCT = /[\s.?!,、。…·]+$/u;

function glyphLen(s: string): number {
  return [...s].length;
}

/** 어절들을 이어 maxChars 이내의 제목으로 만든다(어절 경계에서 자르고 …). */
function makeTitle(words: string[], maxChars: number): string {
  const full = words.join(' ').replace(TRAILING_PUNCT, '').trim();
  if (full === '') return '(제목 없음)';
  if (glyphLen(full) <= maxChars) return full;
  let out = '';
  for (const w of full.split(/\s+/)) {
    const cand = out ? `${out} ${w}` : w;
    if (glyphLen(cand) > maxChars) break;
    out = cand;
  }
  if (out === '') out = [...full].slice(0, maxChars).join('');
  return `${out}…`;
}

/**
 * 전사에서 챕터를 추출한다. 경계 규칙: "충분한 길이(minChapterUs)가 지난 뒤,
 * 문장이 끝났거나(. ? !) 큰 공백(gapUs)이 오면" 새 챕터를 시작한다.
 * 첫 챕터의 시작은 유튜브 규약에 맞춰 항상 0:00으로 맞춘다.
 */
export function extractChapters(
  transcript: TranscriptModel,
  timeline: TimelineModel,
  opts: ChapterOptions = {},
): Chapter[] {
  const minChapterUs = opts.minChapterUs ?? 20_000_000;
  const gapUs = opts.gapUs ?? 1_200_000;
  const maxTitleChars = opts.maxTitleChars ?? 30;

  type PW = { text: string; start: number; end: number };
  const toks: PW[] = [];
  for (const id of liveWords(timeline, transcript)) {
    const w = transcript.words[id];
    if (!w) continue;
    const p = wordToProgram(timeline, w);
    if (p) toks.push({ text: w.text.trim(), start: p.start, end: p.end });
  }
  if (toks.length === 0) return [];

  const chapters: Chapter[] = [];
  let chapStart = toks[0]!.start;
  let chapWords: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const prev = i > 0 ? toks[i - 1] : undefined;
    const elapsed = t.start - chapStart;
    const gap = prev ? t.start - prev.end : 0;
    const atBoundary =
      prev !== undefined &&
      elapsed >= minChapterUs &&
      (gap > gapUs || SENTENCE_END.test(prev.text));
    if (atBoundary) {
      chapters.push({ startUs: chapStart, title: makeTitle(chapWords, maxTitleChars) });
      chapStart = t.start;
      chapWords = [];
    }
    chapWords.push(t.text);
  }
  chapters.push({ startUs: chapStart, title: makeTitle(chapWords, maxTitleChars) });
  // 유튜브 챕터는 첫 항목이 반드시 0:00 이어야 한다.
  chapters[0]!.startUs = 0;
  return chapters;
}

function stamp(us: number): string {
  const total = Math.max(0, Math.floor(us / 1_000_000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 유튜브 설명란용 "M:SS 제목" 줄 목록 텍스트. */
export function formatChapters(chapters: Chapter[]): string {
  return chapters.map((c) => `${stamp(c.startUs)} ${c.title}`).join('\n');
}
