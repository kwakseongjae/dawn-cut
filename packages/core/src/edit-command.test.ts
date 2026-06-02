import { describe, expect, it } from 'vitest';
import {
  type EditorState,
  applyCommand,
  commandManifest,
  parseEditCommand,
  safeParseEditCommand,
} from './edit-command.js';
import { validateSync } from './sync.js';
import { createInitialTimeline } from './timeline.js';
import { buildTranscriptModel } from './transcript.js';
import type { Word } from './types.js';

// [text, startSec, endSec] → 단일 미디어 'm1' 위의 전사 + 전체를 덮는 단일 클립 타임라인.
function scene(rows: [string, number, number][]): EditorState {
  const words: Word[] = rows.map(([text, s, e], i) => ({
    id: `m1:w${i}`,
    text,
    sourceStart: Math.round(s * 1_000_000),
    sourceEnd: Math.round(e * 1_000_000),
    confidence: 1,
    mediaId: 'm1',
  }));
  const dur = Math.max(...rows.map((r) => r[2])) * 1_000_000;
  return {
    transcript: buildTranscriptModel(words, 'm1', 'ko'),
    timeline: createInitialTimeline('m1', dur, 30),
  };
}

describe('applyCommand — command bus dispatcher', () => {
  it('removeFillers: 말버릇 어절을 컷하고 길이가 줄며 불변식 유지', () => {
    const state = scene([
      ['음', 0, 0.5],
      ['안녕하세요', 0.5, 1.5],
      ['어', 1.5, 2.0],
      ['오픈소스입니다', 2.0, 3.0],
    ]);
    const out = applyCommand(state, { type: 'removeFillers' });
    expect(out.removedProgramUs).toBeGreaterThan(990_000); // 음+어 ~1s (±1 frame snap)
    expect(out.after.timeline.durationProgram).toBeLessThan(2_010_000);
    expect(out.after.timeline.durationProgram).toBeGreaterThan(1_990_000);
    // post-condition 불변식(throw 안 났으면 통과지만 명시 단언)
    expect(validateSync(out.after.timeline, out.after.transcript)).toEqual([]);
    // before는 원본 그대로(불변)
    expect(out.before).toBe(state);
    expect(out.before.timeline.durationProgram).toBe(3_000_000);
  });

  it('deleteWordRange: 한 단어 범위 삭제', () => {
    const state = scene([
      ['하나', 0, 1],
      ['둘', 1, 2],
      ['셋', 2, 3],
    ]);
    const id = state.transcript.order[1]!; // '둘'
    const out = applyCommand(state, { type: 'deleteWordRange', fromWordId: id, toWordId: id });
    expect(out.removedProgramUs).toBeGreaterThan(990_000);
    expect(validateSync(out.after.timeline, out.after.transcript)).toEqual([]);
  });

  it('removeSilences: 주어진 무음 구간 제거 (padUs 기본 0)', () => {
    const state = scene([
      ['말', 0, 1],
      ['끝', 2, 3],
    ]);
    const out = applyCommand(state, {
      type: 'removeSilences',
      silences: [{ start: 1_000_000, end: 2_000_000 }],
    });
    expect(out.removedProgramUs).toBeGreaterThan(990_000);
    expect(validateSync(out.after.timeline, out.after.transcript)).toEqual([]);
  });

  it('cutSourceRange: 소스 구간 직접 컷', () => {
    const state = scene([
      ['앞', 0, 1],
      ['뒤', 2, 3],
    ]);
    const out = applyCommand(state, {
      type: 'cutSourceRange',
      mediaId: 'm1',
      sourceStart: 2_000_000,
      sourceEnd: 3_000_000,
    });
    expect(out.removedProgramUs).toBeGreaterThan(990_000);
    expect(validateSync(out.after.timeline, out.after.transcript)).toEqual([]);
  });

  it('applyGlossary: 전사 단어 치환(타임라인 불변, sync 유지)', () => {
    const state = scene([
      ['던컷', 0, 1],
      ['좋아요', 1, 2],
    ]);
    const out = applyCommand(state, {
      type: 'applyGlossary',
      pairs: [{ from: '던컷', to: 'dawn-cut' }],
    });
    const texts = out.after.transcript.order.map((id) => out.after.transcript.words[id]!.text);
    expect(texts).toContain('dawn-cut');
    expect(out.removedProgramUs).toBe(0); // 타임라인 변화 없음
    expect(validateSync(out.after.timeline, out.after.transcript)).toEqual([]);
  });

  it('setSubtitleStyle: 부분 병합(비파괴, 타임라인 불변)', () => {
    const state = { ...scene([['x', 0, 1]]), subtitleStyle: { color: '#fff' } };
    const out = applyCommand(state, { type: 'setSubtitleStyle', patch: { bg: 'transparent' } });
    expect(out.after.subtitleStyle).toEqual({ color: '#fff', bg: 'transparent' });
    expect(out.removedProgramUs).toBe(0);
  });

  it('replaceSubtitleStyle: 전체 교체', () => {
    const state = { ...scene([['x', 0, 1]]), subtitleStyle: { color: '#fff' } };
    const out = applyCommand(state, { type: 'replaceSubtitleStyle', style: { fontScale: 0.5 } });
    expect(out.after.subtitleStyle).toEqual({ fontScale: 0.5 });
  });

  it('highlightKeyword: 키워드 강조 on(+색) 패치(비파괴, 타임라인 불변)', () => {
    const state = { ...scene([['x', 0, 1]]), subtitleStyle: { color: '#fff' } };
    const out = applyCommand(state, { type: 'highlightKeyword', color: '#ffd54f' });
    expect(out.after.subtitleStyle).toEqual({
      color: '#fff',
      emphasizeKeywords: true,
      emphasisColor: '#ffd54f',
    });
    expect(out.removedProgramUs).toBe(0);
  });

  it('highlightKeyword: 색 생략 시 emphasizeKeywords만 켠다', () => {
    const out = applyCommand(scene([['x', 0, 1]]), { type: 'highlightKeyword' });
    expect(out.after.subtitleStyle).toEqual({ emphasizeKeywords: true });
  });

  it('applyColorgrade: 전 비디오클립에 색보정 이펙트 추가(길이 불변, 불변식 유지)', () => {
    const state = scene([
      ['앞', 0, 1],
      ['뒤', 1, 2],
    ]);
    const out = applyCommand(state, { type: 'applyColorgrade', preset: 'warm' });
    const clips = Object.values(out.after.timeline.clips);
    expect(clips.every((c) => c.effects?.some((e) => e.kind === 'color'))).toBe(true);
    expect(out.removedProgramUs).toBe(0);
    expect(validateSync(out.after.timeline, out.after.transcript)).toEqual([]);
  });

  it('applyZoom: 펀치인 줌 이펙트 추가', () => {
    const state = scene([['a', 0, 2]]);
    const out = applyCommand(state, {
      type: 'applyZoom',
      from: 1,
      to: 1.1,
      startUs: 0,
      endUs: 2_000_000,
    });
    const clip = Object.values(out.after.timeline.clips)[0]!;
    expect(clip.effects?.some((e) => e.kind === 'zoom')).toBe(true);
    expect(out.removedProgramUs).toBe(0);
  });

  it('applyColorgrade: 잘못된 preset 거부(Zod)', () => {
    const state = scene([['a', 0, 1]]);
    expect(() => applyCommand(state, { type: 'applyColorgrade', preset: 'neon' })).toThrow();
  });

  it('applyAutoEnhance: 계산된 eq를 color 이펙트로 기록(길이 불변, 불변식 유지)', () => {
    const state = scene([
      ['앞', 0, 1],
      ['뒤', 1, 2],
    ]);
    const out = applyCommand(state, {
      type: 'applyAutoEnhance',
      eq: { contrast: 1.1, saturation: 1.35, brightness: 0.05, gamma: 1.02 },
    });
    const clips = Object.values(out.after.timeline.clips);
    expect(clips.every((c) => c.effects?.some((e) => e.kind === 'color' && 'eq' in e))).toBe(true);
    expect(out.removedProgramUs).toBe(0); // 비파괴(길이 불변)
    expect(validateSync(out.after.timeline, out.after.transcript)).toEqual([]);
  });

  it('correctWord: 어절 텍스트 교정(타임스탬프/id 보존, confidence=1, sync 유지)', () => {
    const state = scene([
      ['던컷', 0, 1],
      ['좋아요', 1, 2],
    ]);
    const id = state.transcript.order[0]!;
    const before = state.transcript.words[id]!;
    const out = applyCommand(state, { type: 'correctWord', wordId: id, text: 'dawn-cut' });
    const after = out.after.transcript.words[id]!;
    expect(after.text).toBe('dawn-cut');
    expect(after.sourceStart).toBe(before.sourceStart); // 타임스탬프 보존
    expect(after.sourceEnd).toBe(before.sourceEnd);
    expect(after.confidence).toBe(1); // 사람 검수 → 확정
    expect(out.removedProgramUs).toBe(0); // 타임라인 불변
    expect(validateSync(out.after.timeline, out.after.transcript)).toEqual([]);
  });

  it('correctWord: 모르는 wordId면 no-op(상태 보존)', () => {
    const state = scene([['x', 0, 1]]);
    const out = applyCommand(state, { type: 'correctWord', wordId: 'nope', text: 'y' });
    expect(out.after.transcript).toBe(state.transcript);
  });

  it('correctWord: 빈 텍스트 거부(Zod min(1))', () => {
    const state = scene([['x', 0, 1]]);
    const id = state.transcript.order[0]!;
    expect(() => applyCommand(state, { type: 'correctWord', wordId: id, text: '' })).toThrow();
  });

  it('autoHighlight: 핵심만 남기고 길이를 줄인다(타깃 근처), 불변식 유지', () => {
    // 10개 문장(각 1s). 키워드가 풍부한 쪽이 남도록 점수 차등.
    const rows: [string, number, number][] = [];
    for (let i = 0; i < 10; i++) {
      // 키워드 밀도를 다르게: 짝수 문장은 평범, 홀수는 '오픈소스 던컷 자막' 같은 풍부한 명사.
      rows.push([
        i % 2 === 0 ? `음 그냥 그래요${i}.` : `오픈소스 던컷 자막 핵심 기능${i}.`,
        i,
        i + 1,
      ]);
    }
    const state = scene(rows);
    const before = state.timeline.durationProgram; // 10s
    const out = applyCommand(state, { type: 'autoHighlight', targetSeconds: 4 });
    expect(out.after.timeline.durationProgram).toBeLessThan(before); // 잘렸다
    expect(out.after.timeline.durationProgram).toBeGreaterThan(0); // 최소 1문장은 남는다
    expect(out.removedProgramUs).toBeGreaterThan(0);
    expect(validateSync(out.after.timeline, out.after.transcript)).toEqual([]);
  });

  it('autoHighlight: targetSeconds 생략 시 기본 60(Zod default) — 짧은 영상은 거의 그대로', () => {
    const cmd = parseEditCommand({ type: 'autoHighlight' });
    expect(cmd).toMatchObject({ type: 'autoHighlight', targetSeconds: 60 });
  });
});

describe('EditCommand Zod 가드 (경계 런타임 검증)', () => {
  it('알 수 없는 type / 누락 필드 거부', () => {
    expect(safeParseEditCommand({ type: 'nope' }).success).toBe(false);
    expect(safeParseEditCommand({ type: 'deleteWordRange' }).success).toBe(false);
    expect(
      safeParseEditCommand({ type: 'deleteWordRange', fromWordId: '', toWordId: 'b' }).success,
    ).toBe(false); // min(1)
    expect(
      safeParseEditCommand({ type: 'deleteWordRange', fromWordId: 'a', toWordId: 'b' }).success,
    ).toBe(true);
  });

  it('parseEditCommand는 잘못된 명령에 throw', () => {
    expect(() => parseEditCommand({ type: 'bad' })).toThrow();
  });

  it('applyCommand도 잘못된 명령을 거부(throw)', () => {
    const state = scene([['x', 0, 1]]);
    expect(() => applyCommand(state, { type: 'unknown' })).toThrow();
  });

  it('removeSilences padUs 기본값 0 적용', () => {
    const cmd = parseEditCommand({ type: 'removeSilences', silences: [] });
    expect(cmd).toMatchObject({ type: 'removeSilences', padUs: 0 });
  });
});

describe('commandManifest — MCP/tool용 JSON-Schema 파생', () => {
  it('verb별 inputSchema(JSON-Schema)를 노출', () => {
    const m = commandManifest();
    expect(m.map((x) => x.name).sort()).toEqual([
      'applyAutoEnhance',
      'applyColorgrade',
      'applyGlossary',
      'applyZoom',
      'autoHighlight',
      'correctWord',
      'cutSourceRange',
      'deleteWordRange',
      'highlightKeyword',
      'removeFillers',
      'removeSilences',
      'replaceSubtitleStyle',
      'setSubtitleStyle',
    ]);
    for (const entry of m) {
      expect(entry.inputSchema).toBeTruthy();
      expect(typeof entry.inputSchema).toBe('object');
    }
  });
});
