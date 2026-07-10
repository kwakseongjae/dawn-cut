import { describe, expect, it } from 'vitest';
import { splitClipAt } from './commands.js';
import { type EditorState, applyCommand } from './edit-command.js';
import { segmentProgramDuration, timelineToEdl, validateEdl } from './edl.js';
import { programToSource, programToSpeed } from './preview.js';
import { validateSync, wordToProgram } from './sync.js';
import {
  clipProgramDuration,
  createInitialTimeline,
  validateTimeline,
  videoClips,
} from './timeline.js';
import { buildTranscriptModel } from './transcript.js';
import type { Word } from './types.js';

// B5 — 배속: 프로그램/소스 이중 좌표계. 프로그램 길이 = round(소스/speed), SYNC 라운드트립 유지.
const FPS = 30;
const DUR = 8_000_000;

function mkWord(id: string, startUs: number, endUs: number): Word {
  return {
    id,
    mediaId: 'm',
    text: id,
    sourceStart: startUs,
    sourceEnd: endUs,
    confidence: 0.9,
  };
}

function stateWithWords(): EditorState {
  const timeline = createInitialTimeline('m', DUR, FPS);
  const words = [
    mkWord('w1', 500_000, 1_100_000),
    mkWord('w2', 1_200_000, 1_900_000),
    mkWord('w3', 4_100_000, 4_700_000),
    mkWord('w4', 7_000_000, 7_600_000),
  ];
  return { timeline, transcript: buildTranscriptModel(words, 'm', 'ko') };
}

describe('setSpeed (command bus)', () => {
  it('2× — 프로그램 길이 절반, 소스 좌표 불변, 전 불변식 통과', () => {
    const s = stateWithWords();
    const { after } = applyCommand(s, { type: 'setSpeed', speed: 2 });
    expect(after.timeline.durationProgram).toBe(DUR / 2);
    const c = videoClips(after.timeline)[0]!;
    expect(c.sourceEnd - c.sourceStart).toBe(DUR); // 소스 불변
    expect(clipProgramDuration(c)).toBe(DUR / 2);
    expect(validateTimeline(after.timeline)).toEqual([]);
    expect(validateSync(after.timeline, after.transcript)).toEqual([]);
  });
  it('0.5× — 프로그램 길이 2배', () => {
    const s = stateWithWords();
    const { after } = applyCommand(s, { type: 'setSpeed', speed: 0.5 });
    expect(after.timeline.durationProgram).toBe(DUR * 2);
    expect(validateSync(after.timeline, after.transcript)).toEqual([]);
  });
  it('speed=1 재적용 = 필드 제거(원복)', () => {
    const s = stateWithWords();
    const a = applyCommand(s, { type: 'setSpeed', speed: 2 });
    const b = applyCommand(a.after, { type: 'setSpeed', speed: 1 });
    expect(b.after.timeline.durationProgram).toBe(DUR);
    expect(videoClips(b.after.timeline)[0]!.speed).toBeUndefined();
  });
  it('미존재 clipId는 명시적 에러', () => {
    const s = stateWithWords();
    expect(() => applyCommand(s, { type: 'setSpeed', speed: 2, clipId: 'nope' })).toThrow(
      /unknown clip/,
    );
  });
  it('부분 배속: 두 클립 중 하나만 1.5× — 나머지 클립 시작이 재적층된다', () => {
    const s = stateWithWords();
    const split = { ...s, timeline: splitClipAt(s.timeline, 4_000_000) };
    const first = videoClips(split.timeline)[0]!;
    const { after } = applyCommand(split, { type: 'setSpeed', speed: 2, clipId: first.id });
    const [c0, c1] = videoClips(after.timeline);
    // 분할점은 프레임 스냅되므로 ±1프레임 허용. 재적층은 정확히 c0 프로그램 길이.
    expect(Math.abs(clipProgramDuration(c0!) - 2_000_000)).toBeLessThan(33_334);
    expect(c1!.timelineStart).toBe(clipProgramDuration(c0!)); // 재적층
    expect(Math.abs(after.timeline.durationProgram - 6_000_000)).toBeLessThan(33_334);
    expect(validateSync(after.timeline, after.transcript)).toEqual([]);
  });
});

describe('SYNC 라운드트립 (비정수 배속 포함)', () => {
  for (const speed of [0.5, 0.75, 1.5, 2, 3]) {
    it(`speed=${speed} — 모든 어절 wordToProgram→programToWord 왕복 무손실`, () => {
      const s = stateWithWords();
      const { after } = applyCommand(s, { type: 'setSpeed', speed });
      // validateSync의 SYNC-INV-1이 정확히 이 왕복을 전 어절에 대해 검사한다.
      expect(validateSync(after.timeline, after.transcript)).toEqual([]);
      // 프로그램 좌표도 배속대로 축소/확대됐는지 하나만 표본 확인.
      const p = wordToProgram(after.timeline, after.transcript.words.w3!);
      expect(p).not.toBeNull();
      expect(Math.abs(p!.start - Math.round(4_100_000 / speed))).toBeLessThanOrEqual(1);
    });
  }
});

describe('splitAt × 배속', () => {
  it('2× 클립을 프로그램 2s(=소스 4s)에서 분할 — 양쪽 speed 승계·프로그램 길이 보존', () => {
    const s = stateWithWords();
    const { after } = applyCommand(s, { type: 'setSpeed', speed: 2 });
    const split = splitClipAt(after.timeline, 2_000_000);
    const [c0, c1] = videoClips(split);
    expect(videoClips(split)).toHaveLength(2);
    expect(c0!.speed).toBe(2);
    expect(c1!.speed).toBe(2);
    // 소스 분할점 = 4s(프로그램 2s × 2배속), 프레임 스냅 허용.
    expect(Math.abs(c0!.sourceEnd - 4_000_000)).toBeLessThan(33_334);
    expect(split.durationProgram).toBe(after.timeline.durationProgram);
    expect(validateTimeline(split)).toEqual([]);
  });
});

describe('EDL × 배속', () => {
  it('세그먼트 speed 전달 + 프로그램 적층 + validateEdl 통과', () => {
    const s = stateWithWords();
    const split = { ...s, timeline: splitClipAt(s.timeline, 4_000_000) };
    const first = videoClips(split.timeline)[0]!;
    const { after } = applyCommand(split, { type: 'setSpeed', speed: 2, clipId: first.id });
    const edl = timelineToEdl(after.timeline, '/tmp/x.mp4');
    expect(edl.segments[0]!.speed).toBe(2);
    expect(edl.segments[1]!.speed).toBeUndefined();
    const p0 = segmentProgramDuration(edl.segments[0]!);
    expect(Math.abs(p0 - 2_000_000)).toBeLessThan(33_334); // 분할점 프레임 스냅 ±1frame
    expect(edl.segments[1]!.programStart).toBe(p0);
    expect(Math.abs(edl.totalDuration - 6_000_000)).toBeLessThan(33_334);
    expect(validateEdl(edl, after.timeline)).toEqual([]);
    // 프리뷰 매핑: 프로그램 1s(2× 구간) → 소스 ≈2s, (p0+1s)(1× 구간) → 소스 ≈분할점+1s.
    expect(Math.abs(programToSource(edl, 1_000_000)! - 2_000_000)).toBeLessThan(2);
    const srcSplit = edl.segments[1]!.sourceStart;
    expect(programToSource(edl, p0 + 1_000_000)).toBe(srcSplit + 1_000_000);
    expect(programToSpeed(edl, 1_000_000)).toBe(2);
    expect(programToSpeed(edl, p0 + 1_000_000)).toBe(1);
  });
});

describe('전환 × 배속 상호작용', () => {
  it('배속 클립 경계의 전환 D는 프로그램 길이 기준으로 클램프·유지', () => {
    const s = stateWithWords();
    const split = { ...s, timeline: splitClipAt(s.timeline, 4_000_000) };
    const a = applyCommand(split, {
      type: 'addTransition',
      kind: 'crossfade',
      durationUs: 500_000,
    });
    const b = applyCommand(a.after, { type: 'setSpeed', speed: 3 }); // 각 클립 4s→1.333s
    const trs = b.after.timeline.transitions;
    expect(trs).toHaveLength(1);
    expect(trs![0]!.durationUs).toBeLessThanOrEqual(500_000); // ≤ min(프로그램 길이)
    expect(validateTimeline(b.after.timeline)).toEqual([]);
  });
});
