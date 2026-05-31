import { describe, expect, it } from 'vitest';
import { dryRunCommands } from './dryrun.js';
import type { EditorState } from './edit-command.js';
import { transcriptToCues } from './subtitles.js';
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

describe('dryRunCommands — 제안 묶음 미리보기(순수·원자적)', () => {
  it('정상 다중 명령: 순차 적용 diff(길이·cue 개수)를 보고하고 새 after 반환', () => {
    const state = scene([
      ['음', 0, 0.5],
      ['안녕하세요.', 0.5, 1.5],
      ['어', 1.5, 2.0],
      ['오픈소스입니다.', 2.0, 3.0],
      ['반갑습니다.', 3.0, 4.0],
    ]);
    const before = state.timeline.durationProgram; // 4_000_000
    const cueBefore = transcriptToCues(state.transcript, state.timeline).length;

    // 1) 말버릇(음/어) 컷 → ~1s 단축, 2) 마지막 단어 삭제 → 추가 단축.
    const lastId = state.transcript.order[4]!; // '반갑습니다.'
    const { report, after } = dryRunCommands(state, [
      { type: 'removeFillers' },
      { type: 'deleteWordRange', fromWordId: lastId, toWordId: lastId },
    ]);

    expect(report.ok).toBe(true);
    expect(report.error).toBeUndefined();
    expect(after).not.toBeNull();

    // diff 일관성: removed == before - after, 그리고 실제로 줄었다.
    expect(report.beforeDurationUs).toBe(before);
    expect(report.removedProgramUs).toBe(report.beforeDurationUs - report.afterDurationUs);
    expect(report.removedProgramUs).toBeGreaterThan(1_990_000); // 음+어(~1s) + '반갑습니다'(~1s)
    expect(report.afterDurationUs).toBeLessThan(before);

    // cue 개수도 줄어든다(라이브 단어가 사라졌으므로).
    expect(report.cueCountBefore).toBe(cueBefore);
    expect(report.cueCountAfter).toBeLessThan(report.cueCountBefore);

    // 반환된 after는 실제 적용된 새 상태 + 불변식 유지.
    expect(after!.timeline.durationProgram).toBe(report.afterDurationUs);
    expect(validateSync(after!.timeline, after!.transcript)).toEqual([]);

    // 순수성: 입력 state는 전혀 변형되지 않았다(원본 길이 보존).
    expect(state.timeline.durationProgram).toBe(before);
  });

  it('잘못된 명령: ok:false + error + after:null, 원자적(부분 적용 금지·원본 보존)', () => {
    const state = scene([
      ['하나', 0, 1],
      ['둘', 1, 2],
      ['셋', 2, 3],
    ]);
    const before = state.timeline.durationProgram;
    const cueBefore = transcriptToCues(state.transcript, state.timeline).length;
    const firstId = state.transcript.order[0]!; // '하나'

    // 1번째 명령은 유효(첫 단어 삭제)하지만, 2번째가 잘못된 type → 전체 롤백되어야 한다.
    const { report, after } = dryRunCommands(state, [
      { type: 'deleteWordRange', fromWordId: firstId, toWordId: firstId },
      { type: 'totally-unknown-verb' },
    ]);

    expect(report.ok).toBe(false);
    expect(report.error).toBeTruthy();
    expect(after).toBeNull();

    // 원자성: 부분 적용(첫 명령) 결과가 새어나오지 않고 '변화 없음'으로 보고.
    expect(report.removedProgramUs).toBe(0);
    expect(report.beforeDurationUs).toBe(before);
    expect(report.afterDurationUs).toBe(before);
    expect(report.cueCountBefore).toBe(cueBefore);
    expect(report.cueCountAfter).toBe(cueBefore);

    // 입력 state는 불변.
    expect(state.timeline.durationProgram).toBe(before);
    expect(state.transcript.order).toHaveLength(3);
  });

  it('빈 commands: ok:true이고 모든 diff 지표가 변화 0', () => {
    const state = scene([
      ['가', 0, 1],
      ['나', 1, 2],
    ]);
    const before = state.timeline.durationProgram;
    const cueBefore = transcriptToCues(state.transcript, state.timeline).length;

    const { report, after } = dryRunCommands(state, []);

    expect(report.ok).toBe(true);
    expect(report.error).toBeUndefined();
    expect(report.removedProgramUs).toBe(0);
    expect(report.beforeDurationUs).toBe(before);
    expect(report.afterDurationUs).toBe(before);
    expect(report.cueCountBefore).toBe(cueBefore);
    expect(report.cueCountAfter).toBe(cueBefore);

    // 변화가 없으니 after는 입력과 동등(길이 동일)하며 not-null.
    expect(after).not.toBeNull();
    expect(after!.timeline.durationProgram).toBe(before);
  });

  it('결정적: 같은 입력을 두 번 dry-run하면 동일한 리포트', () => {
    const state = scene([
      ['음', 0, 0.5],
      ['테스트입니다.', 0.5, 1.5],
    ]);
    const cmds = [{ type: 'removeFillers' }];
    const a = dryRunCommands(state, cmds).report;
    const b = dryRunCommands(state, cmds).report;
    expect(a).toEqual(b);
  });
});
