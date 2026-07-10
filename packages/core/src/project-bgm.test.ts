import { describe, expect, it } from 'vitest';
import { deserializeProject, makeProject, serializeProject } from './project.js';
import { createInitialTimeline } from './timeline.js';
import { buildTranscriptModel } from './transcript.js';

// B7 — .dawn 라운드트립에 bgm(선택 필드, v3 하위호환) 포함.
describe('project bgm roundtrip', () => {
  const timeline = createInitialTimeline('m', 8_000_000, 30);
  const tx = buildTranscriptModel([], 'm', 'und');

  it('bgm 있는 프로젝트 — 직렬화/역직렬화 무손실', () => {
    const bgm = {
      src: '/tmp/dawn-lofi.m4a',
      title: '새벽 로파이',
      startUs: 500_000,
      endUs: 7_500_000,
      volume: 0.25,
      loop: true,
      duck: true,
    };
    const p = makeProject('/tmp/a.mp4', tx, timeline, { bgm });
    const back = deserializeProject(serializeProject(p));
    expect(back.bgm).toEqual(bgm);
  });

  it('bgm 없는 프로젝트 — 필드 자체가 없다(하위호환)', () => {
    const p = makeProject('/tmp/a.mp4', tx, timeline, {});
    expect('bgm' in p).toBe(false);
    const back = deserializeProject(serializeProject(p));
    expect(back.bgm).toBeUndefined();
  });
});
