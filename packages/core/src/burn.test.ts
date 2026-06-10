import { describe, expect, it } from 'vitest';
import { scene } from './_testkit.js';
import {
  BURN_WRAP,
  DEFAULT_SUBTITLE_POS,
  POP_FROM,
  POP_U,
  burnFrameToOverlay,
  cueOptsForAnim,
  emphasisCores,
  subtitleBurnPlan,
} from './burn.js';
import { wrapCaption } from './caption.js';
import { validateOverlays } from './overlay.js';
import { transcriptToCues } from './subtitles.js';

describe('subtitleBurnPlan — GUI doBurn과 동형(단일 진실원천)', () => {
  it("'none'은 cue당 정확히 1프레임, 전역 pos·scale 그대로", () => {
    const { transcript, timeline } = scene();
    const plan = subtitleBurnPlan(transcript, timeline, {}, { x: 0.2, y: 0.7, scale: 0.9 });
    const cues = transcriptToCues(transcript, timeline, cueOptsForAnim('none'));
    expect(plan.length).toBe(cues.length);
    for (const f of plan) {
      expect(f.x).toBe(0.2);
      expect(f.y).toBe(0.7);
      expect(f.scale).toBe(0.9);
      expect(f.keyframes).toBeUndefined();
      expect(f.endUs).toBeGreaterThan(f.startUs);
    }
  });

  it("'pop'은 시작 스케일 60% + easeOut 키프레임 주입(doBurn과 동일 상수)", () => {
    const { transcript, timeline } = scene();
    const plan = subtitleBurnPlan(transcript, timeline, { animation: 'pop' });
    expect(plan.length).toBeGreaterThan(0);
    for (const f of plan) {
      expect(f.scale).toBeCloseTo(DEFAULT_SUBTITLE_POS.scale * POP_FROM, 10);
      expect(f.keyframes).toEqual([
        { u: POP_U, scale: DEFAULT_SUBTITLE_POS.scale, easing: 'easeOut' },
      ]);
    }
  });

  it("'karaoke'는 프레임마다 활성 어절 1개를 emphasis로 — cue 키워드가 아니라", () => {
    const { transcript, timeline } = scene();
    const plan = subtitleBurnPlan(transcript, timeline, {
      animation: 'karaoke',
      emphasizeKeywords: true,
    });
    // karaoke는 어절 수만큼 프레임이 생기고 각각 activeWord 1개 강조
    expect(plan.length).toBeGreaterThan(1);
    for (const f of plan) {
      expect(f.emphasis).toBeDefined();
      expect(f.emphasis!.length).toBe(1);
      expect(f.text).toContain(f.emphasis![0]!);
    }
  });

  it('emphasizeKeywords면 cue 원문 기준 키워드 코어(구두점 제거)를 강조한다', () => {
    const cores = emphasisCores('오픈소스 영상 편집기를 소개합니다.', true);
    expect(cores).toBeDefined();
    for (const c of cores!) expect(c).not.toMatch(/[.,!?]$/u);
    expect(emphasisCores('아무 텍스트', false)).toBeUndefined();
  });

  it('wrapped는 wrapCaption(BURN_WRAP)과 정확히 일치한다(UI 래스터와 패리티)', () => {
    const { transcript, timeline } = scene();
    const plan = subtitleBurnPlan(transcript, timeline, {});
    expect(plan.length).toBeGreaterThan(0);
    for (const f of plan) {
      expect(f.wrapped).toBe(wrapCaption(f.text, BURN_WRAP));
      expect(f.wrapped.length).toBeGreaterThan(0);
    }
  });

  it('transcript 없이 extraCues(수기 자막)만으로도 플랜이 나오고 per-cue pos를 따른다', () => {
    const { timeline } = scene();
    const cue = { index: 1, startUs: 0, endUs: 400_000, text: '수기 자막' };
    const plan = subtitleBurnPlan(null, timeline, {}, DEFAULT_SUBTITLE_POS, [
      { cue, pos: { x: 0.5, y: 0.1, scale: 1 } },
    ]);
    expect(plan.length).toBe(1);
    expect(plan[0]!.x).toBe(0.5);
    expect(plan[0]!.y).toBe(0.1);
  });

  it('burnFrameToOverlay 산출물은 overlay 불변식을 통과한다(z=100, 자막 kind)', () => {
    const { transcript, timeline } = scene();
    const plan = subtitleBurnPlan(transcript, timeline, { animation: 'pop' });
    const overlays = plan.map((f, i) => burnFrameToOverlay(f, `/tmp/f${i}.png`, `sub-${i}`));
    expect(validateOverlays(overlays, timeline.durationProgram)).toEqual([]);
    for (const o of overlays) {
      expect(o.kind).toBe('subtitle');
      expect(o.z).toBe(100);
      expect(o.opacity).toBe(1);
    }
  });

  it('결정성: 같은 입력 → 같은 플랜(JSON 동등)', () => {
    const { transcript, timeline } = scene();
    const a = subtitleBurnPlan(transcript, timeline, { animation: 'reveal' });
    const b = subtitleBurnPlan(transcript, timeline, { animation: 'reveal' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
