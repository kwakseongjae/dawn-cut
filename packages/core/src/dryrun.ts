// Dry-run — '제안 → 사용자 확인' 파이프라인의 핵심. 비전(자연어→AI가 dawn-cut을
// tool/MCP로 조작)에서 에이전트는 EditCommand 묶음을 제안하고, 사용자/에이전트는
// 실제 상태를 오염시키지 않은 채 그 묶음을 미리 적용해 '무엇이 어떻게 바뀌는지'
// (프로그램 길이 변화·cue 개수 변화)를 확인한 뒤에야 커밋한다.
//
// applyCommand를 순차로 흘려(각 결과를 다음 입력으로) 결정적·순수하게 평가하고,
// 단 하나라도 실패하면 원자적으로 롤백한다(부분 적용 금지·원본 상태 유지).
import { type EditorState, applyCommand } from './edit-command.js';
import { transcriptToCues } from './subtitles.js';

/**
 * Dry-run 결과 리포트 — 커밋 전에 사용자/에이전트에게 보여줄 diff 요약.
 * 모든 길이는 µs(정수), 모든 개수는 cue 단위.
 */
export interface DryRunReport {
  /** 모든 명령이 불변식을 깨지 않고 적용됐는가. false면 error에 사유. */
  ok: boolean;
  /** 적용으로 줄어든 프로그램 길이(before - after, µs). 실패 시 0. */
  removedProgramUs: number;
  /** 적용 전 프로그램 길이(µs). */
  beforeDurationUs: number;
  /** 적용 후 프로그램 길이(µs). 실패 시 beforeDurationUs와 동일. */
  afterDurationUs: number;
  /** 적용 전 자막 cue 개수. */
  cueCountBefore: number;
  /** 적용 후 자막 cue 개수. 실패 시 cueCountBefore와 동일. */
  cueCountAfter: number;
  /** ok:false일 때만 채워지는 실패 사유(첫 throw 메시지). */
  error?: string;
}

/** transcript+timeline에서 라이브 cue 개수를 센다(자막 미리보기 diff 지표). */
function cueCount(state: EditorState): number {
  return transcriptToCues(state.transcript, state.timeline).length;
}

/**
 * 명령 묶음을 실제 상태 변경 없이 미리 평가한다(순수·결정적).
 *
 * - `commands`를 순서대로 applyCommand에 흘려 각 결과(after)를 다음 입력으로 사용한다.
 * - 하나라도 throw(잘못된 명령/불변식 위반)하면 원자적으로 중단한다:
 *   `ok:false` + `error`(사유) + `after:null`을 돌려주고, 리포트의 길이/개수 지표는
 *   '변화 없음'(원본 그대로)으로 보고한다. 부분 적용 결과는 절대 노출하지 않는다.
 * - 빈 `commands`는 성공이며 모든 diff 지표가 0/동일이다.
 *
 * 반환된 `after`는 새 EditorState(성공) 또는 null(실패). 입력 `state`는 절대 변형되지 않는다.
 *
 * @param state    평가 기준이 되는 현재 편집 상태(불변).
 * @param commands 직렬화된 EditCommand 후보 배열(unknown — 경계에서 applyCommand가 검증).
 * @returns        diff 요약 리포트와, 성공 시 적용된 새 상태(실패 시 null).
 */
export function dryRunCommands(
  state: EditorState,
  commands: unknown[],
): { report: DryRunReport; after: EditorState | null } {
  const beforeDurationUs = state.timeline.durationProgram;
  const cueCountBefore = cueCount(state);

  let current = state;
  try {
    for (const command of commands) {
      // applyCommand는 새 state를 반환하고 입력은 변형하지 않는다 → 순차 누적.
      current = applyCommand(current, command).after;
    }
  } catch (err) {
    // 원자성: 부분 적용된 current는 버리고 원본 기준 '변화 없음'으로 보고.
    return {
      report: {
        ok: false,
        removedProgramUs: 0,
        beforeDurationUs,
        afterDurationUs: beforeDurationUs,
        cueCountBefore,
        cueCountAfter: cueCountBefore,
        error: err instanceof Error ? err.message : String(err),
      },
      after: null,
    };
  }

  const afterDurationUs = current.timeline.durationProgram;
  return {
    report: {
      ok: true,
      removedProgramUs: beforeDurationUs - afterDurationUs,
      beforeDurationUs,
      afterDurationUs,
      cueCountBefore,
      cueCountAfter: cueCount(current),
    },
    after: current,
  };
}
