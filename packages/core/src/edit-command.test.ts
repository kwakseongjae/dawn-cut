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
      'cutSourceRange',
      'deleteWordRange',
      'removeFillers',
      'removeSilences',
    ]);
    for (const entry of m) {
      expect(entry.inputSchema).toBeTruthy();
      expect(typeof entry.inputSchema).toBe('object');
    }
  });
});
