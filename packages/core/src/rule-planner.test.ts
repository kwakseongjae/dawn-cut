import { describe, expect, it } from 'vitest';
import { type EditorState, applyCommand } from './edit-command.js';
import { ruleBasedPlan, rulePlanProvider, ruleProvider } from './rule-planner.js';
import { createInitialTimeline } from './timeline.js';
import { buildTranscriptModel } from './transcript.js';
import type { Word } from './types.js';

// 단일 미디어 'm1' 위의 전사 + 전체를 덮는 단일 클립 타임라인.
function scene(rows: [string, number, number][] = [['안녕하세요', 0, 1]]): EditorState {
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

describe('ruleBasedPlan — 색보정 프리셋 매핑', () => {
  const s = scene();

  it('"시네마틱하게 해줘" → applyColorgrade(cinematic)', () => {
    expect(ruleBasedPlan('시네마틱하게 해줘', s)).toEqual([
      { type: 'applyColorgrade', preset: 'cinematic' },
    ]);
  });

  it('"영화 같은 느낌으로 색 보정해줘" → cinematic(영화 같은)', () => {
    expect(ruleBasedPlan('영화 같은 느낌으로 색 보정해줘', s)).toEqual([
      { type: 'applyColorgrade', preset: 'cinematic' },
    ]);
  });

  it('"따뜻하게 톤 바꿔줘" → warm', () => {
    expect(ruleBasedPlan('따뜻하게 톤 바꿔줘', s)).toEqual([
      { type: 'applyColorgrade', preset: 'warm' },
    ]);
  });

  it('"화면 차갑게 해줘" → cool', () => {
    expect(ruleBasedPlan('화면 차갑게 해줘', s)).toEqual([
      { type: 'applyColorgrade', preset: 'cool' },
    ]);
  });

  it('"선명하게 보정해줘" → punch', () => {
    expect(ruleBasedPlan('선명하게 보정해줘', s)).toEqual([
      { type: 'applyColorgrade', preset: 'punch' },
    ]);
  });

  it('"플랫하게 색 빼줘" → flat', () => {
    expect(ruleBasedPlan('플랫하게 색 빼줘', s)).toEqual([
      { type: 'applyColorgrade', preset: 'flat' },
    ]);
  });

  it('우선순위: 시네마틱이 다른 톤 키워드보다 먼저 채택(결정적)', () => {
    expect(ruleBasedPlan('따뜻한 시네마틱 느낌으로 해줘', s)).toEqual([
      { type: 'applyColorgrade', preset: 'cinematic' },
    ]);
  });
});

describe('ruleBasedPlan — 말버릇/필러 제거', () => {
  const s = scene();

  it('"말버릇 좀 빼줘" → removeFillers', () => {
    expect(ruleBasedPlan('말버릇 좀 빼줘', s)).toEqual([{ type: 'removeFillers' }]);
  });

  it('"추임새 다 제거해줘" → removeFillers', () => {
    expect(ruleBasedPlan('추임새 다 제거해줘', s)).toEqual([{ type: 'removeFillers' }]);
  });

  it('"필러 단어 삭제" → removeFillers', () => {
    expect(ruleBasedPlan('필러 단어 삭제', s)).toEqual([{ type: 'removeFillers' }]);
  });
});

describe('ruleBasedPlan — 미지원·모호·정보부족 → []', () => {
  const s = scene();

  it('빈 문자열 → []', () => {
    expect(ruleBasedPlan('', s)).toEqual([]);
  });

  it('무관한 잡담 → []', () => {
    expect(ruleBasedPlan('오늘 날씨 정말 좋네요', s)).toEqual([]);
  });

  it('무음 제거(정보부족: 감지 좌표 필요) → [] (의도적 제외)', () => {
    expect(ruleBasedPlan('무음 구간 다 잘라줘', s)).toEqual([]);
    expect(ruleBasedPlan('공백 빼줘', s)).toEqual([]);
  });

  it('자막 스타일 프리셋(미지원) → []', () => {
    expect(ruleBasedPlan('자막 틱톡 스타일로 바꿔줘', s)).toEqual([]);
  });

  it('대상어만 있고 동사 없으면 필러 제거 보류 → []', () => {
    expect(ruleBasedPlan('말버릇', s)).toEqual([]);
  });
});

describe('ruleBasedPlan — 복합 의도', () => {
  const s = scene();

  it('"말버릇 빼고 시네마틱하게" → 2개(필러 제거 + 색보정)', () => {
    expect(ruleBasedPlan('말버릇 빼고 시네마틱하게', s)).toEqual([
      { type: 'removeFillers' },
      { type: 'applyColorgrade', preset: 'cinematic' },
    ]);
  });

  it('"추임새 제거하고 따뜻한 톤으로 해줘" → removeFillers + warm', () => {
    expect(ruleBasedPlan('추임새 제거하고 따뜻한 톤으로 해줘', s)).toEqual([
      { type: 'removeFillers' },
      { type: 'applyColorgrade', preset: 'warm' },
    ]);
  });
});

describe('ruleBasedPlan — 결정성 & command bus 호환', () => {
  const s = scene([
    ['음', 0, 0.5],
    ['안녕하세요', 0.5, 1.5],
  ]);

  it('같은 입력 → 같은 출력(결정적)', () => {
    const a = ruleBasedPlan('말버릇 빼고 시네마틱하게', s);
    const b = ruleBasedPlan('말버릇 빼고 시네마틱하게', s);
    expect(a).toEqual(b);
  });

  it('생성된 명령은 applyCommand로 실제 적용 가능(스키마 유효)', () => {
    const cmds = ruleBasedPlan('말버릇 빼고 시네마틱하게', s);
    expect(cmds.length).toBe(2);
    let state = s;
    for (const c of cmds) {
      state = applyCommand(state, c).after;
    }
    // 색보정은 비파괴(길이 불변), 필러 '음' 제거로 길이 단축.
    expect(state.timeline.durationProgram).toBeLessThan(s.timeline.durationProgram);
  });
});

describe('rulePlanProvider / ruleProvider — planner 어댑터', () => {
  const s = scene();

  it('rulePlanProvider: prompt 무시하고 룰 플랜 JSON 반환', async () => {
    const provider = rulePlanProvider('시네마틱하게 해줘', s);
    const out = await provider('아무 prompt나 무시됨');
    expect(JSON.parse(out)).toEqual([{ type: 'applyColorgrade', preset: 'cinematic' }]);
  });

  it('ruleProvider 별칭은 rulePlanProvider와 동일 동작', async () => {
    const out = await ruleProvider('말버릇 빼줘', s)('');
    expect(JSON.parse(out)).toEqual([{ type: 'removeFillers' }]);
  });

  it('매칭 없으면 "[]" JSON 반환', async () => {
    const out = await rulePlanProvider('오늘 날씨 좋네요', s)('');
    expect(JSON.parse(out)).toEqual([]);
  });
});

describe('ruleBasedPlan — 비편집 문장 환각 방지 (적대검증 회귀)', () => {
  const s = scene();
  it('편집 의도 없는 문장(차가워서/시네마 가서 등)은 빈 plan', () => {
    for (const sentence of [
      '오늘 기분이 차가워서 우울해요',
      '시네마 가서 영화 봤어요',
      '이 음식 따뜻하게 데워줘',
      '날씨가 시원하게 느껴져요',
      '마음이 따뜻해지는 영상이네요',
    ]) {
      expect(ruleBasedPlan(sentence, s)).toEqual([]);
    }
  });
});
