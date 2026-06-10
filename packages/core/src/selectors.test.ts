import { describe, expect, it } from 'vitest';
import { makeWord, scene } from './_testkit.js';
import { deleteWordRange } from './commands.js';
import { applyCommand } from './edit-command.js';
import { ruleBasedPlan } from './rule-planner.js';
import { findSilences, findWords } from './selectors.js';
import { createInitialTimeline } from './timeline.js';
import { buildTranscriptModel } from './transcript.js';

/** 한국어 강의 장면 — 어절 사이에 0.8s 무음 갭 1개. */
function koScene() {
  const words = [
    makeWord('안녕하세요.', 0, 500_000, 'm1'),
    makeWord('오늘은', 600_000, 1_000_000, 'm1'),
    makeWord('던컷을', 1_100_000, 1_500_000, 'm1'),
    makeWord('소개합니다.', 1_550_000, 2_000_000, 'm1'),
    // 0.8s 죽은 구간 (2.0s ~ 2.8s)
    makeWord('자막은', 2_800_000, 3_200_000, 'm1'),
    makeWord('자동입니다.', 3_250_000, 3_700_000, 'm1'),
  ];
  const transcript = buildTranscriptModel(words, 'm1', 'ko');
  const timeline = createInitialTimeline('m1', 4_000_000, 30);
  return { words, transcript, timeline };
}

describe('findWords — NL 구절 → wordId 핸들 (read-only)', () => {
  it('단일 토큰은 조사 변형을 흡수해 포함-매치한다("던컷" ⊂ "던컷을")', () => {
    const { transcript, timeline } = koScene();
    const r = findWords(transcript, timeline, '던컷');
    expect(r.length).toBe(1);
    expect(r[0]!.text).toBe('던컷을');
    expect(r[0]!.fromWordId).toBe(r[0]!.toWordId);
    expect(r[0]!.programEndUs).toBeGreaterThan(r[0]!.programStartUs);
  });

  it('다중 토큰 구절은 연속 어절만 매치한다', () => {
    const { transcript, timeline } = koScene();
    expect(findWords(transcript, timeline, '오늘은 던컷')).toHaveLength(1);
    // 연속이 아니면(중간에 다른 어절) 매치 없음
    expect(findWords(transcript, timeline, '오늘은 소개합니다')).toHaveLength(0);
  });

  it('전사에 없는 구절은 빈 배열(환각 금지)', () => {
    const { transcript, timeline } = koScene();
    expect(findWords(transcript, timeline, '브이로그')).toEqual([]);
  });

  it('이미 컷된(라이브 아닌) 어절은 매치하지 않는다', () => {
    const { transcript, timeline } = koScene();
    const target = findWords(transcript, timeline, '던컷')[0]!;
    const { after } = deleteWordRange(timeline, transcript, target.fromWordId, target.toWordId);
    expect(findWords(transcript, after, '던컷')).toEqual([]);
  });

  it('결과 핸들을 deleteWordRange에 그대로 넣으면 해당 구간이 컷된다(end-to-end)', () => {
    const { transcript, timeline } = koScene();
    const r = findWords(transcript, timeline, '오늘은')[0]!;
    const out = applyCommand(
      { timeline, transcript },
      { type: 'deleteWordRange', fromWordId: r.fromWordId, toWordId: r.toWordId },
    );
    expect(out.removedProgramUs).toBeGreaterThan(0);
  });

  it('limit을 지키고 겹침 없이 왼쪽부터 그리디 매치한다', () => {
    const { transcript, timeline } = scene(); // alpha..echo
    const all = findWords(transcript, timeline, 'a'); // alpha/bravo/charlie/delta(포함 a)
    const two = findWords(transcript, timeline, 'a', { limit: 2 });
    expect(two.length).toBe(2);
    expect(two.map((r) => r.fromWordId)).toEqual(all.slice(0, 2).map((r) => r.fromWordId));
  });
});

describe('findSilences — 발화 공백 → 소스 구간 핸들 (read-only)', () => {
  it('minMs 이상 갭만 소스 좌표로 반환한다(기본 500ms)', () => {
    const { transcript, timeline } = koScene();
    const s = findSilences(transcript, timeline);
    expect(s).toHaveLength(1);
    expect(s[0]!.start).toBe(2_000_000);
    expect(s[0]!.end).toBe(2_800_000);
    expect(s[0]!.durationUs).toBe(800_000);
  });

  it('낮은 임계(50ms)면 어절 사이 정상 간격도 잡힌다 — 임계가 동작함', () => {
    const { transcript, timeline } = koScene();
    expect(findSilences(transcript, timeline, { minMs: 50 }).length).toBeGreaterThan(1);
  });

  it('결과를 removeSilences에 그대로 넣으면 길이가 갭만큼 줄어든다(end-to-end)', () => {
    const { transcript, timeline } = koScene();
    const silences = findSilences(transcript, timeline).map(({ start, end }) => ({ start, end }));
    const out = applyCommand(
      { timeline, transcript },
      { type: 'removeSilences', silences, padUs: 0 },
    );
    // 컷은 프레임 경계로 양자화될 수 있어 ±1frame(33,334µs) 허용 — 프로젝트 규약.
    expect(Math.abs(out.removedProgramUs - 800_000)).toBeLessThanOrEqual(33_334);
  });
});

describe('ruleBasedPlan 셀렉터 연동 — NL 컷 개방 (issue #2)', () => {
  it('"\'X\' 라는 말 잘라줘" → deleteWordRange 합성', () => {
    const { transcript, timeline } = koScene();
    const plan = ruleBasedPlan("'던컷' 이라는 말 잘라줘", { timeline, transcript });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ type: 'deleteWordRange' });
  });

  it('전사에 없는 인용구는 합성하지 않는다(환각 금지)', () => {
    const { transcript, timeline } = koScene();
    expect(ruleBasedPlan("'브이로그' 부분 잘라줘", { timeline, transcript })).toEqual([]);
  });

  it('"무음 제거해줘" → findSilences 기반 removeSilences 합성', () => {
    const { transcript, timeline } = koScene();
    const plan = ruleBasedPlan('무음 제거해줘', { timeline, transcript });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ type: 'removeSilences' });
    const cmd = plan[0] as { silences: { start: number; end: number }[] };
    expect(cmd.silences).toHaveLength(1);
  });

  it('"0.3초 이상 무음 빼줘"는 임계를 반영한다', () => {
    const { transcript, timeline } = koScene();
    const plan = ruleBasedPlan('0.3초 이상 무음 빼줘', { timeline, transcript });
    const cmd = plan.find((c) => c.type === 'removeSilences') as
      | { silences: unknown[] }
      | undefined;
    expect(cmd).toBeDefined();
    expect(cmd!.silences.length).toBe(1); // 0.8s 갭만 0.3s 이상
  });

  it('무음이 하나도 없으면 removeSilences를 합성하지 않는다', () => {
    const { transcript, timeline } = scene(); // 갭 10ms뿐
    expect(ruleBasedPlan('무음 제거해줘', { timeline, transcript })).toEqual([]);
  });
});
