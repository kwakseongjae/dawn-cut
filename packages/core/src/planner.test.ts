import { describe, expect, it } from 'vitest';
import { type EditorState, commandManifest } from './edit-command.js';
import {
  PLANNER_VERBS,
  type PlanProvider,
  buildPlanPrompt,
  parsePlan,
  planAndPreview,
  plannerManifest,
  summarizeState,
} from './planner.js';
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

/** 고정 문자열을 반환하는 결정적 목 provider. */
const mockProvider = (fixed: string): PlanProvider => {
  return async () => fixed;
};

const MANIFEST = commandManifest();

describe('summarizeState — 컴팩트 요약(전체 전사 미주입)', () => {
  it('길이/어절수/cue/필러/챕터/스타일 집계를 만든다', () => {
    const state = scene([
      ['음', 0, 0.5],
      ['안녕하세요.', 0.5, 1.5],
      ['어', 1.5, 2.0],
      ['반갑습니다.', 2.0, 3.0],
    ]);
    const s = summarizeState(state);
    expect(s.durationUs).toBe(3_000_000);
    expect(s.wordCount).toBe(4);
    expect(s.cueCount).toBeGreaterThan(0);
    expect(s.fillerCount).toBe(2); // '음', '어'
    expect(Array.isArray(s.chapters)).toBe(true);
    expect(s.hasSubtitleStyle).toBe(false);
  });

  it('subtitleStyle 존재 시 hasSubtitleStyle=true', () => {
    const state = scene([['하나', 0, 1]]);
    state.subtitleStyle = { color: '#fff' };
    expect(summarizeState(state).hasSubtitleStyle).toBe(true);
  });
});

describe('buildPlanPrompt — 프롬프트 조립', () => {
  it('요청·요약·도구 스키마를 담고, 외부정보 verb는 금지 표시', () => {
    const state = scene([['하나', 0, 1]]);
    const prompt = buildPlanPrompt('말버릇 지워줘', summarizeState(state), MANIFEST);
    expect(prompt).toContain('말버릇 지워줘');
    expect(prompt).toContain('removeFillers');
    // 외부정보가 필요한 verb는 사용 금지로 표시되어야 한다.
    expect(prompt).toMatch(/removeSilences.*사용 금지/);
    expect(prompt).toMatch(/cutSourceRange.*사용 금지/);
    // 상태 요약(JSON)이 포함된다.
    expect(prompt).toContain('"wordCount"');
  });
});

describe('parsePlan — 텍스트에서 배열 추출 + 검증', () => {
  it('순수 JSON 배열을 파싱한다', () => {
    const { plan, errors } = parsePlan('[{"type":"removeFillers"}]');
    expect(errors).toEqual([]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.type).toBe('removeFillers');
  });

  it('코드펜스+잡설에 둘러싸인 배열도 추출한다', () => {
    const text = [
      '물론이죠! 다음 명령을 제안합니다:',
      '```json',
      '[',
      '  {"type":"removeFillers"},',
      '  {"type":"applyColorgrade","preset":"warm"}',
      ']',
      '```',
      '이대로 적용하면 됩니다.',
    ].join('\n');
    const { plan, errors } = parsePlan(text);
    expect(errors).toEqual([]);
    expect(plan.map((c) => c.type)).toEqual(['removeFillers', 'applyColorgrade']);
  });

  it('잘못된 명령은 errors에 모으고 통과분만 plan에 담는다', () => {
    const text = '[{"type":"removeFillers"},{"type":"totally-unknown"},{"type":"deleteWordRange"}]';
    const { plan, errors } = parsePlan(text);
    // removeFillers만 유효(deleteWordRange는 필수 필드 누락, unknown은 union 불일치).
    expect(plan).toHaveLength(1);
    expect(plan[0]!.type).toBe('removeFillers');
    expect(errors.length).toBe(2);
    expect(errors[0]).toContain('command[1]');
    expect(errors[1]).toContain('command[2]');
  });

  it('JSON 배열이 없으면 빈 plan + error', () => {
    const { plan, errors } = parsePlan('죄송하지만 그 요청은 수행할 수 없습니다.');
    expect(plan).toEqual([]);
    expect(errors[0]).toContain('no JSON array');
  });

  it('빈 배열은 빈 plan + error 없음', () => {
    const { plan, errors } = parsePlan('[]');
    expect(plan).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('중첩 배열(applyGlossary pairs)도 균형 추출한다', () => {
    const text = '[{"type":"applyGlossary","pairs":[{"from":"깃헙","to":"GitHub"}]}] // 끝';
    const { plan, errors } = parsePlan(text);
    expect(errors).toEqual([]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.type).toBe('applyGlossary');
  });
});

describe('planAndPreview — provider→parse→dryRun 오케스트레이션', () => {
  it('목 provider 출력으로 plan을 만들고 dry-run 리포트를 함께 반환', async () => {
    const state = scene([
      ['음', 0, 0.5],
      ['안녕하세요.', 0.5, 1.5],
      ['어', 1.5, 2.0],
      ['반갑습니다.', 2.0, 3.0],
    ]);
    const before = state.timeline.durationProgram;
    const { plan, report, errors } = await planAndPreview(
      '말버릇 지워줘',
      state,
      mockProvider('```json\n[{"type":"removeFillers"}]\n```'),
      MANIFEST,
    );
    expect(errors).toEqual([]);
    expect(plan).toHaveLength(1);
    expect(report.ok).toBe(true);
    expect(report.beforeDurationUs).toBe(before);
    expect(report.removedProgramUs).toBeGreaterThan(0); // 음+어 컷
    // 순수성: 입력 state 불변.
    expect(state.timeline.durationProgram).toBe(before);
  });

  it('잡설+코드펜스+잘못된 명령 혼합: 통과분만 적용, errors 수집', async () => {
    const state = scene([
      ['음', 0, 0.5],
      ['테스트입니다.', 0.5, 1.5],
    ]);
    const out = [
      '다음을 제안합니다:',
      '```json',
      '[{"type":"removeFillers"},{"type":"nope"}]',
      '```',
    ].join('\n');
    const { plan, report, errors } = await planAndPreview(
      '정리해줘',
      state,
      mockProvider(out),
      MANIFEST,
    );
    expect(plan).toHaveLength(1);
    expect(errors.length).toBe(1);
    expect(report.ok).toBe(true); // 통과분만으로 dry-run 성공
  });

  it('빈 plan(수행 불가): ok:true이고 변화 0', async () => {
    const state = scene([
      ['가', 0, 1],
      ['나', 1, 2],
    ]);
    const before = state.timeline.durationProgram;
    const { plan, report, errors } = await planAndPreview(
      '이상한 요청',
      state,
      mockProvider('[]'),
      MANIFEST,
    );
    expect(plan).toEqual([]);
    expect(errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.removedProgramUs).toBe(0);
    expect(report.afterDurationUs).toBe(before);
  });

  it('JSON 없는 출력: 빈 plan + error, dry-run은 변화 0', async () => {
    const state = scene([['하나', 0, 1]]);
    const { plan, report, errors } = await planAndPreview(
      '무엇이든',
      state,
      mockProvider('미안하지만 못 하겠어요.'),
      MANIFEST,
    );
    expect(plan).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
    expect(report.ok).toBe(true);
    expect(report.removedProgramUs).toBe(0);
  });
});

describe('plannerManifest — LLM 플래너 안전 부분집합', () => {
  it('PLANNER_VERBS의 verb만, 정확히 그 집합을 노출한다', () => {
    const names = plannerManifest().map((t) => t.name);
    expect(new Set(names)).toEqual(new Set(PLANNER_VERBS));
    expect(names).toHaveLength(PLANNER_VERBS.length);
  });

  it('외부 좌표·ID가 필요한 verb는 제외한다(환각 차단)', () => {
    const names = new Set(plannerManifest().map((t) => t.name));
    for (const forbidden of ['deleteWordRange', 'removeSilences', 'cutSourceRange', 'applyZoom']) {
      expect(names.has(forbidden)).toBe(false);
    }
  });

  it('plannerManifest로 만든 프롬프트엔 금지 verb가 등장하지 않는다', () => {
    const state = scene([['하나', 0, 1]]);
    const prompt = buildPlanPrompt('시네마틱하게', summarizeState(state), plannerManifest());
    expect(prompt).toContain('applyColorgrade');
    expect(prompt).not.toContain('removeSilences');
    expect(prompt).not.toContain('cutSourceRange');
  });
});

describe('parsePlan — 마크다운 인용/링크가 앞서도 진짜 명령 배열 추출 (적대검증 회귀)', () => {
  it('잡설 속 [1]·[링크]보다 뒤의 EditCommand 배열을 추출', () => {
    expect(
      parsePlan('See note [1] then:\n[{"type":"removeFillers"}]').plan.map((c) => c.type),
    ).toEqual(['removeFillers']);
    expect(
      parsePlan('문서 [가이드](http://x) 참고.\n[{"type":"removeFillers"}]').plan.map(
        (c) => c.type,
      ),
    ).toEqual(['removeFillers']);
  });
});
