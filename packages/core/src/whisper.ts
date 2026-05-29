// whisper.cpp 자연모드(-ml 없음) JSON을 어절 단위 Word[]로 변환한다.
// 순수 TS — node:fs / node:child_process import 금지(00-SEED #1, dependency-cruiser 강제).
//
// 배경(docs/poc/CYCLE0-STT-KOREAN-GATE.md, artifacts/stt-spike/ANALYSIS.md):
//   현 sidecar는 `-ml 1`로 토큰당 1세그먼트를 받았는데, 한국어 BPE는 한 음절을
//   바이트 경계로 쪼개 JSON이 유효 UTF-8조차 아니게 만들었다(자막 깨짐의 근본 원인).
//   자연모드(-ml 제거)는 유효 UTF-8이고 세그먼트 tokens[]에 per-token offset이 이미
//   들어있다. whisper BPE의 leading-space(' '/'▁')가 어절 경계와 정합하므로,
//   leading-space에서 새 어절을 시작하고 비-space 토큰은 직전 어절에 이어붙이면
//   어절(단어+조사)이 무손실로 복원된다(char-accuracy 96.59%, mojibake 0 실측).
//
// 적대검증(wf_0b6fdb32)에서 잡힌 break 5종 반영:
//   - 여는 구두점 드롭/비대칭 괄호(중대) → pendingPunct 버퍼 + leading 구두점 분기
//   - 다중 선행공백 잔존(경미) → /^[ ▁]+/ 정규식 strip
//   - 특수토큰 brittleness(경미) → token.id(>=50257) + 대소문자 무관 텍스트 정규식
//   - 비단조 offset 무가드(중대) → prevStart 클램프(T-INV-2)
//   - zero-width 토큰 from==to(경미) → minDurationUs 클램프(T-INV-3)
import type { Word } from './types.js';

export interface WhisperOffsets {
  from: number; // ms
  to: number; // ms
}
export interface WhisperToken {
  text?: string;
  offsets?: WhisperOffsets;
  p?: number; // token probability 0..1
  id?: number; // whisper token id (특수토큰 식별용)
}
export interface WhisperSegment {
  tokens?: WhisperToken[];
}
export interface WhisperNaturalJson {
  result?: { language?: string };
  transcription?: WhisperSegment[];
}

export interface WhisperToWordsOptions {
  mediaId: string;
  /** 결정적 id 생성기(0-based index). 기본 `${mediaId}:w${i}`. 랜덤 금지. */
  makeId?: (index: number) => string;
  /** ms→µs 스케일. 기본 1000 (04 §0 계약: µs = ms*1000). */
  msToUs?: number;
  /** zero-width 토큰의 최소 노출폭(µs). 기본 1ms 상당. T-INV-3 보장. */
  minDurationUs?: number;
}

// [_BEG_]/[_EOT_]/[_TT_225] 등. 대소문자·숫자 혼용 허용(모델/버전 brittleness 회피).
const SPECIAL_TEXT_RE = /^\[_[A-Za-z0-9]+(_[A-Za-z0-9]+)*_?\]$/;
const ANGLE_SPECIAL_RE = /^<\|.*\|>$/; // <|endoftext|> 류
// whisper 멀티링궐 어휘 = 51865. 특수토큰 id는 50257 이상(timestamp 토큰 포함).
const SPECIAL_TOKEN_ID_MIN = 50257;
const LEADING_SPACE_RE = /^[ ▁]+/; // ASCII space + SentencePiece ▁(U+2581)
const PUNCT_RE = /^[\p{P}\p{S}]+$/u;

function isSpecialToken(tok: WhisperToken): boolean {
  if (typeof tok.id === 'number' && tok.id >= SPECIAL_TOKEN_ID_MIN) return true;
  const raw = tok.text;
  if (raw == null) return true;
  const t = raw.trim();
  if (t.length === 0) return true;
  if (SPECIAL_TEXT_RE.test(t)) return true;
  if (ANGLE_SPECIAL_RE.test(t)) return true;
  return false;
}

function stripLeadingSpace(text: string): { lead: boolean; core: string } {
  const m = LEADING_SPACE_RE.exec(text);
  if (m) return { lead: true, core: text.slice(m[0].length) };
  return { lead: false, core: text };
}

function isPurePunctuation(core: string): boolean {
  return core.length > 0 && PUNCT_RE.test(core);
}

interface Acc {
  text: string;
  from: number; // ms
  to: number; // ms
  ps: number[];
}

/**
 * whisper.cpp 자연모드(-ml 없음) JSON → 어절 단위 Word[].
 *
 * 알고리즘: 전 세그먼트 tokens[]를 순회.
 *  1) 특수토큰(id≥50257 또는 [_..._]/<|..|>) 스킵.
 *  2) leading-space(' '/'▁')면 새 어절 시작, 비-space면 직전 어절에 이어붙임(BPE 규칙).
 *  3) 순수 구두점은 leading이면 다음 어절의 여는 부호로 버퍼, 아니면 직전 어절에 흡수
 *     (구두점은 절대 독립 어절이 되지 않고 절대 드롭되지 않음 — 무손실).
 *  4) ms→µs 변환, sourceStart 단조 클램프(T-INV-2), sourceEnd>sourceStart 클램프(T-INV-3),
 *     빈 텍스트 제거(T-INV-4), confidence = 구성 토큰 p 산술평균(0..1 clamp).
 *
 * id는 makeId(index)로 결정적 생성(랜덤 금지) — 동일 입력 = 동일 출력.
 */
export function whisperNaturalToWords(
  json: WhisperNaturalJson,
  opts: WhisperToWordsOptions,
): Word[] {
  const mediaId = opts.mediaId;
  const scale = opts.msToUs ?? 1000;
  const minDur = opts.minDurationUs ?? scale;
  const makeId = opts.makeId ?? ((i: number) => `${mediaId}:w${i}`);

  const accs: Acc[] = [];
  let cur: Acc | null = null;
  let pendingPunct = '';
  let pendingFrom = -1;

  const flush = (): void => {
    if (cur && cur.text.length > 0) accs.push(cur);
    cur = null;
  };

  for (const seg of json.transcription ?? []) {
    for (const tok of seg.tokens ?? []) {
      if (isSpecialToken(tok)) continue;
      const raw = tok.text ?? '';
      const { lead, core } = stripLeadingSpace(raw);
      if (core.length === 0) continue; // 공백만인 토큰

      const fromMs = tok.offsets?.from ?? 0;
      const toMs = Math.max(tok.offsets?.to ?? fromMs, fromMs);
      const p = typeof tok.p === 'number' ? tok.p : 0;

      if (isPurePunctuation(core)) {
        // leading-space 구두점 = 다음 어절의 여는 부호(' "', ' ('): 현재 어절 닫고 버퍼.
        // 비-leading 구두점 = 현재 어절의 닫는 부호('.','?',','): 흡수.
        // 현재 어절 없으면 어느 쪽이든 버퍼(여는 부호 무손실).
        if (lead) {
          flush();
          pendingPunct += core;
          if (pendingFrom < 0) pendingFrom = fromMs;
        } else if (cur) {
          cur.text += core;
          cur.to = Math.max(cur.to, toMs);
          cur.ps.push(p);
        } else {
          pendingPunct += core;
          if (pendingFrom < 0) pendingFrom = fromMs;
        }
        continue;
      }

      if (lead || cur === null) {
        flush();
        const startFrom = pendingPunct ? Math.min(pendingFrom, fromMs) : fromMs;
        cur = { text: pendingPunct + core, from: startFrom, to: toMs, ps: [p] };
        pendingPunct = '';
        pendingFrom = -1;
      } else {
        cur.text += core;
        cur.to = Math.max(cur.to, toMs);
        cur.ps.push(p);
      }
    }
  }
  flush();
  // 끝에 남은 여는 부호는 마지막 어절에 흡수(무손실). 어절이 없으면 드롭(구두점뿐인 입력).
  if (pendingPunct && accs.length > 0) {
    accs[accs.length - 1]!.text += pendingPunct;
  }

  const words: Word[] = [];
  let prevStart = 0;
  for (let i = 0; i < accs.length; i++) {
    const a = accs[i]!;
    const text = a.text.trim();
    if (text === '') continue; // T-INV-4
    let start = a.from * scale;
    if (start < prevStart) start = prevStart; // T-INV-2: sourceStart 비감소 보장
    let end = a.to * scale;
    if (end <= start) end = start + minDur; // T-INV-3: sourceEnd > sourceStart
    prevStart = start;
    const conf = a.ps.length ? a.ps.reduce((s, v) => s + v, 0) / a.ps.length : 0;
    words.push({
      id: makeId(words.length),
      text,
      sourceStart: start,
      sourceEnd: end,
      confidence: Math.min(1, Math.max(0, conf)),
      mediaId,
    });
  }
  return words;
}
