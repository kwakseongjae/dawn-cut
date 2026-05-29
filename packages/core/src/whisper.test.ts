import { describe, expect, it } from 'vitest';
import { buildTranscriptModel, validateTranscript } from './transcript.js';
import { type WhisperNaturalJson, type WhisperToken, whisperNaturalToWords } from './whisper.js';

// ── helpers ─────────────────────────────────────────────────────────
type Tok = [text: string, from?: number, to?: number, p?: number, id?: number];
function seg(...toks: Tok[]): WhisperNaturalJson {
  return {
    result: { language: 'ko' },
    transcription: [
      {
        tokens: toks.map(([text, from, to, p, id]): WhisperToken => {
          const t: WhisperToken = { text };
          if (from !== undefined) t.offsets = { from, to: to ?? from };
          if (p !== undefined) t.p = p;
          if (id !== undefined) t.id = id;
          return t;
        }),
      },
    ],
  };
}
const texts = (j: WhisperNaturalJson) =>
  whisperNaturalToWords(j, { mediaId: 'm' }).map((w) => w.text);

describe('whisperNaturalToWords — leading-space 어절 머지 (Cycle-0 게이트)', () => {
  // artifacts/stt-spike/natural.json seg0 구조 재현(문장1).
  const sentence1 = seg(
    ['[_BEG_]', 0, 0, 1, 50363],
    [' 안녕', 10, 400, 0.95],
    ['하세요', 400, 810, 0.95],
    ['?', 1070, 1160, 0.8],
    [' 오늘은', 1160, 1660, 0.9],
    [' 오픈', 1660, 1940, 0.9],
    ['소스', 1940, 2330, 0.9],
    [' 영상', 2330, 2630, 0.9],
    [' 편집기', 2630, 3130, 0.9],
    [' 던', 3130, 3300, 0.9],
    ['컷', 3300, 3430, 0.9],
    ['을', 3430, 3590, 0.9],
    [' 소개', 3590, 3920, 0.9],
    ['합니다', 3920, 4400, 0.9],
    ['.', 4400, 4500, 0.8],
  );

  it('어절(단어+조사)을 무손실 복원, 구두점은 직전 어절에 흡수', () => {
    expect(texts(sentence1)).toEqual([
      '안녕하세요?',
      '오늘은',
      '오픈소스',
      '영상',
      '편집기',
      '던컷을',
      '소개합니다.',
    ]);
  });

  it('mojibake(U+FFFD) 0 — 자연모드 무손실', () => {
    for (const w of whisperNaturalToWords(sentence1, { mediaId: 'm' })) {
      expect(w.text).not.toContain('�');
    }
  });

  it('ms→µs(×1000), from=첫토큰/to=마지막토큰', () => {
    const ws = whisperNaturalToWords(sentence1, { mediaId: 'm' });
    expect(ws[0]).toMatchObject({ text: '안녕하세요?', sourceStart: 10_000, sourceEnd: 1_160_000 });
    expect(ws[1]).toMatchObject({ text: '오늘은', sourceStart: 1_160_000 });
    expect(ws[2]).toMatchObject({ text: '오픈소스', sourceStart: 1_660_000 });
  });

  it('buildTranscriptModel + validateTranscript = [] (T-INV 전부 통과)', () => {
    const ws = whisperNaturalToWords(sentence1, { mediaId: 'm' });
    const model = buildTranscriptModel(ws, 'm', 'ko');
    expect(validateTranscript(model)).toEqual([]);
  });
});

describe('whisperNaturalToWords — 적대검증 break 회귀가드', () => {
  it('특수토큰 견고성: id≥50257 / [_..._] / 대소문자 / <|..|> 전부 스킵', () => {
    const j = seg(
      ['[_BEG_]', 0, 0, 1, 50363],
      ['[_TT_225]', 0, 0],
      ['[_beg_]', 0, 0],
      ['<|endoftext|>', 0, 0],
      ['딴', 0, 0, 0.9, 99999], // id≥50257 → 스킵(텍스트가 한글이어도)
      [' 진짜', 100, 300, 0.9],
      ['단어', 300, 500, 0.9],
    );
    expect(texts(j)).toEqual(['진짜단어']);
  });

  it('여는 구두점 무손실 + 비대칭 괄호 없음', () => {
    const j = seg(
      [' (', 0, 10],
      [' note', 10, 100],
      [')', 100, 110],
      [' "', 200, 210],
      [' hi', 210, 300],
    );
    expect(texts(j)).toEqual(['(note)', '"hi']);
  });

  it('다중 선행공백 strip — 임베디드 공백 0', () => {
    expect(texts(seg(['  word', 0, 100]))).toEqual(['word']);
  });

  it('영문/숫자 혼용 유지', () => {
    const j = seg(
      [' Dawn', 0, 100],
      ['Cut', 100, 200],
      [' v2', 200, 300],
      [' 2026', 300, 400],
      ['년', 400, 500],
    );
    expect(texts(j)).toEqual(['DawnCut', 'v2', '2026년']);
  });

  it('T-INV-2: 비단조 offset 입력도 sourceStart 단조 클램프', () => {
    const j: WhisperNaturalJson = {
      transcription: [
        { tokens: [{ text: ' 가', offsets: { from: 500, to: 600 } }] },
        { tokens: [{ text: ' 나', offsets: { from: 100, to: 200 } }] },
      ],
    };
    const ws = whisperNaturalToWords(j, { mediaId: 'm' });
    expect(ws.map((w) => w.text)).toEqual(['가', '나']);
    for (let i = 1; i < ws.length; i++) {
      expect(ws[i]!.sourceStart).toBeGreaterThanOrEqual(ws[i - 1]!.sourceStart);
    }
  });

  it('T-INV-3: zero-width 토큰(from==to)도 sourceEnd>sourceStart', () => {
    const ws = whisperNaturalToWords(seg([' 이', 5500, 5500, 0.9]), { mediaId: 'm' });
    expect(ws[0]!.sourceEnd).toBeGreaterThan(ws[0]!.sourceStart);
    expect(ws[0]!.sourceEnd).toBe(5_501_000); // 5500000 + minDur(1000)
  });

  it('T-INV-4: 빈/구두점-only 입력은 크래시 없이 [] 반환', () => {
    expect(
      whisperNaturalToWords(seg(['[_BEG_]', 0, 0], [' ', 0, 0], [' ...', 0, 10]), { mediaId: 'm' }),
    ).toEqual([]);
    expect(whisperNaturalToWords({}, { mediaId: 'm' })).toEqual([]);
  });

  it('결정적 id: 동일 입력 = 동일 id, 커스텀 makeId 주입', () => {
    const j = seg([' 가', 0, 100], [' 나', 100, 200]);
    const a = whisperNaturalToWords(j, { mediaId: 'X' });
    const b = whisperNaturalToWords(j, { mediaId: 'X' });
    expect(a.map((w) => w.id)).toEqual(['X:w0', 'X:w1']);
    expect(a.map((w) => w.id)).toEqual(b.map((w) => w.id));
    const c = whisperNaturalToWords(j, { mediaId: 'X', makeId: (i) => `t${i}` });
    expect(c.map((w) => w.id)).toEqual(['t0', 't1']);
  });

  it('confidence: 저신뢰 어절 플래그 가능, 전부 [0,1]', () => {
    const ws = whisperNaturalToWords(seg([' 몸', 0, 100, 0.134], [' 정상', 100, 200, 0.98]), {
      mediaId: 'm',
    });
    expect(ws[0]!.confidence).toBeLessThan(0.3); // 검수 하이라이트 후보
    for (const w of ws) {
      expect(w.confidence).toBeGreaterThanOrEqual(0);
      expect(w.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('전략 C over-split 회귀 방지: 명사/조사가 1어절로 유지(언어규칙 미적용)', () => {
    expect(texts(seg([' 바보', 0, 100]))).toEqual(['바보']);
    expect(texts(seg([' 저보다', 0, 100]))).toEqual(['저보다']);
    expect(texts(seg([' 가보다', 0, 100]))).toEqual(['가보다']);
  });
});
