import { describe, expect, it } from 'vitest';
import { splitClipAt } from './commands.js';
import { type EditorState, applyCommand } from './edit-command.js';
import { timelineToEdl, validateEdl } from './edl.js';
import {
  createInitialTimeline,
  reconcileTransitions,
  validateTimeline,
  videoClips,
} from './timeline.js';
import { buildTranscriptModel } from './transcript.js';

// B4 — 경계 전환: 동사 2종 + TL-INV-5 + 구조 편집 정합 + EDL 매핑. 길이 완전 불변이 핵심.
const FPS = 30;
const DUR = 8_000_000;

function twoClipState(): EditorState {
  const t0 = createInitialTimeline('m', DUR, FPS);
  const timeline = splitClipAt(t0, 4_000_000);
  return { timeline, transcript: buildTranscriptModel([], 'm', 'und') };
}

describe('addTransition / removeTransition (command bus)', () => {
  it('전체 경계 일괄(afterClipId 생략) — 길이·클립 불변, TL-INV 전체 통과', () => {
    const s = twoClipState();
    const { after } = applyCommand(s, {
      type: 'addTransition',
      kind: 'crossfade',
      durationUs: 500_000,
    });
    expect(after.timeline.transitions).toHaveLength(1);
    expect(after.timeline.transitions![0]!.kind).toBe('crossfade');
    expect(after.timeline.durationProgram).toBe(DUR);
    expect(videoClips(after.timeline)).toHaveLength(2);
    expect(validateTimeline(after.timeline)).toEqual([]);
  });
  it('같은 경계 재적용 = 교체(중복 금지)', () => {
    const s = twoClipState();
    const a = applyCommand(s, { type: 'addTransition', kind: 'crossfade', durationUs: 500_000 });
    const b = applyCommand(a.after, {
      type: 'addTransition',
      kind: 'dipToBlack',
      durationUs: 300_000,
    });
    expect(b.after.timeline.transitions).toHaveLength(1);
    expect(b.after.timeline.transitions![0]!.kind).toBe('dipToBlack');
  });
  it('과대 D는 경계 양쪽 길이로 클램프(프레임 스냅)', () => {
    const s = twoClipState(); // 각 클립 4s
    const { after } = applyCommand(s, {
      type: 'addTransition',
      kind: 'crossfade',
      durationUs: 10_000_000, // 10s > min(4s,4s)
    });
    const d = after.timeline.transitions![0]!.durationUs;
    expect(d).toBeLessThanOrEqual(4_000_000);
    expect(validateTimeline(after.timeline)).toEqual([]);
  });
  it('마지막 클립 뒤/미존재 클립은 명시적 에러', () => {
    const s = twoClipState();
    const last = videoClips(s.timeline)[1]!.id;
    expect(() =>
      applyCommand(s, {
        type: 'addTransition',
        kind: 'crossfade',
        durationUs: 500_000,
        afterClipId: last,
      }),
    ).toThrow(/last clip/);
    expect(() =>
      applyCommand(s, {
        type: 'addTransition',
        kind: 'crossfade',
        durationUs: 500_000,
        afterClipId: 'nope',
      }),
    ).toThrow(/unknown clip/);
  });
  it('단일 클립 = no-op(플래너가 시도해도 안전)', () => {
    const t0 = createInitialTimeline('m', DUR, FPS);
    const s: EditorState = { timeline: t0, transcript: buildTranscriptModel([], 'm', 'und') };
    const { after } = applyCommand(s, {
      type: 'addTransition',
      kind: 'crossfade',
      durationUs: 500_000,
    });
    expect(after.timeline.transitions).toBeUndefined();
  });
  it('removeTransition — 특정/전부', () => {
    const s = twoClipState();
    const a = applyCommand(s, { type: 'addTransition', kind: 'crossfade', durationUs: 500_000 });
    const removed = applyCommand(a.after, { type: 'removeTransition' });
    expect(removed.after.timeline.transitions).toBeUndefined();
  });
});

describe('구조 편집과의 정합', () => {
  it('splitAt: 분할 클립 뒤 경계의 전환은 -b 뒤로 이동(경계 보존)', () => {
    const s = twoClipState();
    const firstId = videoClips(s.timeline)[0]!.id;
    const { after } = applyCommand(s, {
      type: 'addTransition',
      kind: 'crossfade',
      durationUs: 500_000,
      afterClipId: firstId,
    });
    // 첫 클립(0~4s)을 2s에서 다시 분할 → 전환은 여전히 '4s 경계'(= firstId-b 뒤)에 있어야 한다.
    const split2 = splitClipAt(after.timeline, 2_000_000);
    expect(validateTimeline(split2)).toEqual([]);
    expect(split2.transitions).toHaveLength(1);
    expect(split2.transitions![0]!.afterClipId).toBe(`${firstId}-b`);
  });
  it('reconcileTransitions: 깨진 참조·마지막 경계 drop, 1프레임 미만 drop', () => {
    const s = twoClipState();
    const [c0, c1] = videoClips(s.timeline);
    const m = {
      ...s.timeline,
      transitions: [
        { id: 't1', afterClipId: 'ghost', kind: 'crossfade' as const, durationUs: 500_000 },
        { id: 't2', afterClipId: c1!.id, kind: 'crossfade' as const, durationUs: 500_000 },
        { id: 't3', afterClipId: c0!.id, kind: 'dipToBlack' as const, durationUs: 10_000 }, // <1frame
      ],
    };
    expect(reconcileTransitions(m.transitions, m)).toBeUndefined();
  });
});

describe('EDL 매핑', () => {
  it('afterClipId → afterIndex, validateEdl 통과, totalDuration 불변', () => {
    const s = twoClipState();
    const { after } = applyCommand(s, {
      type: 'addTransition',
      kind: 'dipToBlack',
      durationUs: 600_000,
    });
    const edl = timelineToEdl(after.timeline, '/tmp/x.mp4');
    expect(edl.transitions).toHaveLength(1);
    expect(edl.transitions![0]!.afterIndex).toBe(0);
    expect(edl.transitions![0]!.kind).toBe('dipToBlack');
    // D는 프레임 스냅된다(600ms → 18프레임 = 599,994µs @30fps) — ±1프레임 허용.
    expect(Math.abs(edl.transitions![0]!.durationUs - 600_000)).toBeLessThan(33_334);
    expect(edl.totalDuration).toBe(DUR);
    expect(validateEdl(edl, after.timeline)).toEqual([]);
  });
  it('전환 없으면 edl.transitions 필드 자체가 없다(렌더 인자 바이트 동일 전제)', () => {
    const s = twoClipState();
    const edl = timelineToEdl(s.timeline, '/tmp/x.mp4');
    expect('transitions' in edl).toBe(false);
  });
});
