import { liveWords, wordToProgram } from './sync.js';
import type { TimelineModel, TranscriptModel } from './types.js';

/** 어절 단위 타이밍(애니메이션 자막용). 프로그램 좌표(µs). */
export interface CueWord {
  text: string;
  startUs: number;
  endUs: number;
}

/** A subtitle cue in PROGRAM coordinates (i.e. timed against the edited result). */
export interface SubtitleCue {
  index: number; // 1-based
  startUs: number;
  endUs: number;
  text: string;
  /** 이 cue를 이루는 어절들(프로그램 시간). transcriptToCues가 채운다.
   *  단어별 reveal/karaoke 애니메이션 자막의 입력(captionFrames). */
  words?: CueWord[];
}

export interface CueOptions {
  /** Start a new cue when the program gap between words exceeds this. */
  maxGapUs?: number;
  /** Cap words per cue. */
  maxWordsPerCue?: number;
  /**
   * Cap characters per cue (default ∞). Short-form/쇼츠 captions read best as a
   * single punchy line — set this low (~12–16) to break long runs into snappy cues.
   * A single word longer than the cap still gets its own cue (never split mid-word).
   */
  maxCharsPerCue?: number;
}

/**
 * Build subtitle cues from the (edited) transcript, timed in program coords.
 * Only live words are included; they are grouped into cues, breaking on a
 * program-time gap (a cut) or a word-count cap. (G9)
 */
export function transcriptToCues(
  transcript: TranscriptModel,
  timeline: TimelineModel,
  opts: CueOptions = {},
): SubtitleCue[] {
  const maxGapUs = opts.maxGapUs ?? 600_000;
  const maxWords = opts.maxWordsPerCue ?? 8;
  const maxChars = opts.maxCharsPerCue ?? Number.POSITIVE_INFINITY;

  type Tok = { text: string; start: number; end: number };
  const toks: Tok[] = [];
  for (const id of liveWords(timeline, transcript)) {
    const p = wordToProgram(timeline, transcript.words[id]!);
    if (p) toks.push({ text: transcript.words[id]!.text.trim(), start: p.start, end: p.end });
  }

  const cues: SubtitleCue[] = [];
  let group: Tok[] = [];
  const flush = () => {
    if (group.length === 0) return;
    cues.push({
      index: cues.length + 1,
      startUs: group[0]!.start,
      endUs: group[group.length - 1]!.end,
      text: group.map((t) => t.text).join(' '),
      words: group.map((t) => ({ text: t.text, startUs: t.start, endUs: t.end })),
    });
    group = [];
  };

  // 문장 끝(.?!…) 어절에서 cue를 끊어 자막이 완결된 문장(또는 그 일부)으로 보이게 한다.
  // 그렇지 않으면 8어절 컷이 "…소개합니다. 이"처럼 다음 문장 첫 어절을 물고 끊긴다.
  const endsSentence = /[.?!。…]$/u;
  // 누적 문자 수(공백 포함)로, 새 어절을 더하면 maxChars를 넘는지 본다.
  const groupChars = () =>
    group.reduce((n, t) => n + t.text.length, 0) + Math.max(0, group.length - 1);
  for (const tok of toks) {
    const prev = group[group.length - 1];
    const overChars = group.length > 0 && groupChars() + 1 + tok.text.length > maxChars;
    if (prev && (tok.start - prev.end > maxGapUs || group.length >= maxWords || overChars)) flush();
    group.push(tok);
    if (endsSentence.test(tok.text)) flush();
  }
  flush();
  return cues;
}

/** 자막 애니메이션 모드. none=정적, reveal=어절 누적, karaoke=현재 어절 강조,
 *  typewriter=글자 누적(타자기), pop=정적 텍스트 + 등장 스케일-인(오버레이 키프레임이 담당). */
export type CaptionAnimation = 'none' | 'reveal' | 'karaoke' | 'typewriter' | 'pop';

// 타자기 프레임 상한 — 글자수가 많아도 PNG/IPC 폭증을 막는다(긴 cue는 글자를 묶어 ≤24프레임).
const MAX_TYPEWRITER_FRAMES = 24;

/** 한 cue를 시간에 따라 그릴 '서브프레임'. 각 프레임은 [startUs,endUs) 동안 보이는 정적 자막. */
export interface CaptionFrame {
  /** 이 프레임에 렌더할 텍스트(reveal=누적 어절, karaoke/none=전체). */
  text: string;
  /** karaoke: 이 프레임에서 강조할 현재 어절 표면형(emphasis로 전달). reveal/none은 undefined. */
  activeWord?: string;
  startUs: number;
  endUs: number;
}

/**
 * cue를 애니메이션 서브프레임 배열로 펼친다(순수·결정적). 렌더러/데모는 각 프레임을
 * 기존 drawSubtitle로 래스터화해 [startUs,endUs) 오버레이로 합성하면 단어별 reveal/karaoke가 된다.
 * (새 렌더 엔진 불필요 — cue당 다중 PNG 오버레이로 표현. karaoke는 activeWord를 emphasis로 넘기면
 *  기존 키워드 강조 경로가 그대로 현재 어절을 칠한다.)
 *
 * - mode 'none' 또는 어절<2: 단일 프레임(cue 전체, 기존 정적 자막과 동일).
 * - 'reveal': 어절 k까지 누적한 텍스트를 어절 k의 시작~다음 어절 시작 구간에 보인다.
 * - 'karaoke': 전체 텍스트를 보이되 현재 어절을 activeWord로 표시.
 * 첫 프레임은 cue.startUs, 마지막 프레임은 cue.endUs에 맞춘다. start<end를 항상 보장.
 */
export function captionFrames(cue: SubtitleCue, mode: CaptionAnimation = 'none'): CaptionFrame[] {
  const words = cue.words ?? [];
  // pop은 '등장 모션'(텍스트 진행 아님)이라 none처럼 cue 전체 1프레임. 스케일-인은 오버레이 키프레임.
  if (mode === 'none' || mode === 'pop') {
    return [{ text: cue.text, startUs: cue.startUs, endUs: cue.endUs }];
  }
  // 타자기: 글자(코드포인트=한글 음절 1자) 누적 substring을 cue 구간에 균등분할. 상한으로 묶음.
  if (mode === 'typewriter') {
    const chars = [...cue.text];
    if (chars.length <= 1) {
      return [{ text: cue.text, startUs: cue.startUs, endUs: cue.endUs }];
    }
    const step = Math.max(1, Math.ceil(chars.length / MAX_TYPEWRITER_FRAMES));
    const cuts: number[] = [];
    for (let k = step; k < chars.length; k += step) cuts.push(k);
    cuts.push(chars.length); // 마지막은 항상 전체
    const span = Math.max(1, cue.endUs - cue.startUs);
    return cuts.map((k, i) => {
      const startUs = Math.round(cue.startUs + (span * i) / cuts.length);
      const rawEnd =
        i === cuts.length - 1
          ? cue.endUs
          : Math.round(cue.startUs + (span * (i + 1)) / cuts.length);
      return { text: chars.slice(0, k).join(''), startUs, endUs: Math.max(startUs + 1, rawEnd) };
    });
  }
  if (words.length <= 1) {
    return [{ text: cue.text, startUs: cue.startUs, endUs: cue.endUs }];
  }
  return words.map((w, i) => {
    const rawStart = i === 0 ? cue.startUs : w.startUs;
    const rawEnd = i === words.length - 1 ? cue.endUs : (words[i + 1]?.startUs ?? cue.endUs);
    const startUs = rawStart;
    const endUs = Math.max(rawStart + 1, rawEnd); // start<end 보장(어절 타임스탬프 동률 방어)
    if (mode === 'reveal') {
      return {
        text: words
          .slice(0, i + 1)
          .map((x) => x.text)
          .join(' '),
        startUs,
        endUs,
      };
    }
    return { text: cue.text, activeWord: w.text, startUs, endUs };
  });
}

function srtTime(us: number): string {
  const ms = Math.round(us / 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/** Render cues as an SRT document. */
export function formatSrt(cues: SubtitleCue[]): string {
  return cues
    .map((c) => `${c.index}\n${srtTime(c.startUs)} --> ${srtTime(c.endUs)}\n${c.text}\n`)
    .join('\n');
}

/** Returns a list of SUB-INV violations ([] == valid). */
export function validateCues(cues: SubtitleCue[], timeline: TimelineModel): string[] {
  const errors: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    if (c.startUs >= c.endUs) errors.push(`SUB-INV-2: cue ${c.index} start>=end`);
    if (c.text.trim() === '') errors.push(`SUB-INV-2: cue ${c.index} empty text`);
    if (c.startUs < 0 || c.endUs > timeline.durationProgram) {
      errors.push(`SUB-INV-3: cue ${c.index} outside program [0,${timeline.durationProgram}]`);
    }
    if (i > 0) {
      const prev = cues[i - 1]!;
      if (c.startUs < prev.endUs) errors.push(`SUB-INV-1: cue ${c.index} overlaps previous`);
      if (c.index !== prev.index + 1)
        errors.push(`SUB-INV-1: cue index not sequential at ${c.index}`);
    }
  }
  return errors;
}
