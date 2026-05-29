import { liveWords, wordToProgram } from './sync.js';
import type { TimelineModel, TranscriptModel } from './types.js';

/** A subtitle cue in PROGRAM coordinates (i.e. timed against the edited result). */
export interface SubtitleCue {
  index: number; // 1-based
  startUs: number;
  endUs: number;
  text: string;
}

export interface CueOptions {
  /** Start a new cue when the program gap between words exceeds this. */
  maxGapUs?: number;
  /** Cap words per cue. */
  maxWordsPerCue?: number;
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
    });
    group = [];
  };

  // 문장 끝(.?!…) 어절에서 cue를 끊어 자막이 완결된 문장(또는 그 일부)으로 보이게 한다.
  // 그렇지 않으면 8어절 컷이 "…소개합니다. 이"처럼 다음 문장 첫 어절을 물고 끊긴다.
  const endsSentence = /[.?!。…]$/u;
  for (const tok of toks) {
    const prev = group[group.length - 1];
    if (prev && (tok.start - prev.end > maxGapUs || group.length >= maxWords)) flush();
    group.push(tok);
    if (endsSentence.test(tok.text)) flush();
  }
  flush();
  return cues;
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
