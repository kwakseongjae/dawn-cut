import { describe, expect, it } from 'vitest';
import { scene } from './_testkit.js';
import { deleteWordRange } from './commands.js';
import { deserializeProject, makeProject, serializeProject, validateProject } from './project.js';

describe('Project (.dawn) serialization', () => {
  it('round-trips deep-equal through serialize/deserialize', () => {
    const { transcript, timeline } = scene();
    const p = makeProject('/x/sample.mp4', transcript, timeline);
    const restored = deserializeProject(serializeProject(p));
    expect(restored).toEqual(p);
  });

  it('round-trips an EDITED project (after a cut)', () => {
    const { transcript, timeline } = scene();
    const mid = transcript.order[2]!;
    const { after } = deleteWordRange(timeline, transcript, mid, mid);
    const p = makeProject('/x/sample.mp4', transcript, after);
    expect(validateProject(p)).toEqual([]);
    const restored = deserializeProject(serializeProject(p));
    expect(restored).toEqual(p);
    expect(restored.timeline.durationProgram).toBe(after.durationProgram);
  });

  it('rejects an unsupported schemaVersion', () => {
    const { transcript, timeline } = scene();
    const bad = serializeProject({
      ...makeProject('/x', transcript, timeline),
      schemaVersion: 99 as unknown as 2,
    });
    expect(() => deserializeProject(bad)).toThrow(/schemaVersion/);
  });

  it('round-trips subtitle position + style (현재 스키마 v3)', () => {
    const { transcript, timeline } = scene();
    const p = makeProject('/x/sample.mp4', transcript, timeline, {
      subtitlePos: { x: 0.05, y: 0.05, scale: 0.6 },
      subtitleStyle: { color: '#ff0000', bg: 'transparent', fontFamily: 'Georgia, serif' },
    });
    expect(p.schemaVersion).toBe(3);
    const restored = deserializeProject(serializeProject(p));
    expect(restored.subtitlePos).toEqual({ x: 0.05, y: 0.05, scale: 0.6 });
    expect(restored.subtitleStyle?.color).toBe('#ff0000');
    expect(restored.subtitleStyle?.fontFamily).toBe('Georgia, serif');
  });

  it('accepts a legacy schemaVersion 1 project (subtitle settings absent)', () => {
    const { transcript, timeline } = scene();
    const legacy = JSON.stringify({
      schemaVersion: 1,
      mediaPath: '/x/sample.mp4',
      transcript,
      timeline,
    });
    const restored = deserializeProject(legacy);
    expect(restored.schemaVersion).toBe(1);
    expect(restored.subtitlePos).toBeUndefined();
  });

  it('rejects a corrupt project (broken invariant)', () => {
    const { transcript, timeline } = scene();
    const p = makeProject('/x/sample.mp4', transcript, timeline);
    p.timeline.durationProgram = 999_999_999; // TL-INV-4 violation
    expect(() => deserializeProject(serializeProject(p))).toThrow(/invalid project/);
  });
});

describe('Project v3 — 작업 현황 전체 저장 (issue #17)', () => {
  it('오버레이/수기자막/TTS/리프레임/색/사전이 손실 없이 라운드트립된다', () => {
    const { transcript, timeline } = scene();
    const p = makeProject('/x/sample.mp4', transcript, timeline, {
      overlays: [
        {
          id: 'ov1',
          kind: 'sticker',
          name: '🔥',
          src: '/assets/fire.png',
          x: 0.1,
          y: 0.2,
          scale: 0.3,
          opacity: 1,
          startUs: 0,
          endUs: 300_000,
          z: 10,
          rotation: 15,
        },
      ],
      manualCues: [
        {
          id: 'mc1',
          text: '수기 자막',
          startUs: 0,
          endUs: 200_000,
          pos: { x: 0.5, y: 0.1, scale: 1 },
        },
      ],
      ttsClips: [
        {
          id: 't1',
          voice: 'Yuna',
          text: '안녕',
          wavPath: '/tmp/t1.wav',
          startUs: 0,
          endUs: 150_000,
        },
      ],
      reframe: '9:16',
      colorPreset: 'vivid',
      autoEnhanceEq: { contrast: 1.1, saturation: 1.2, brightness: 0.05 },
      glossary: [{ from: '던컽', to: '던컷' }],
    });
    expect(p.schemaVersion).toBe(3);
    const r = deserializeProject(serializeProject(p));
    expect(r.overlays).toHaveLength(1);
    expect(r.overlays![0]).toMatchObject({ id: 'ov1', kind: 'sticker', name: '🔥', rotation: 15 });
    expect(r.manualCues![0]!.pos).toEqual({ x: 0.5, y: 0.1, scale: 1 });
    expect(r.ttsClips![0]!.wavPath).toBe('/tmp/t1.wav');
    expect(r.reframe).toBe('9:16');
    expect(r.colorPreset).toBe('vivid');
    expect(r.autoEnhanceEq?.saturation).toBe(1.2);
    expect(r.glossary).toEqual([{ from: '던컽', to: '던컷' }]);
  });

  it('v2 문서(작업 현황 필드 없음)도 그대로 읽힌다 — 하위호환', () => {
    const { transcript, timeline } = scene();
    const v2 = JSON.stringify({
      schemaVersion: 2,
      mediaPath: '/x/sample.mp4',
      transcript,
      timeline,
      subtitlePos: { x: 0.1, y: 0.8, scale: 0.8 },
    });
    const r = deserializeProject(v2);
    expect(r.overlays).toBeUndefined();
    expect(r.manualCues).toBeUndefined();
  });

  it('시간 구간이 0/음수인 작업 현황은 거부한다(파손 파일 침묵 로드 금지)', () => {
    const { transcript, timeline } = scene();
    const p = makeProject('/x/sample.mp4', transcript, timeline, {
      manualCues: [{ id: 'bad', text: 'x', startUs: 100, endUs: 100 }],
    });
    expect(() => deserializeProject(serializeProject(p))).toThrow(/PRJ-CUE/);
  });
});
