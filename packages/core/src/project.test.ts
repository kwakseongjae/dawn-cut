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

  it('round-trips subtitle position + style (schemaVersion 2)', () => {
    const { transcript, timeline } = scene();
    const p = makeProject('/x/sample.mp4', transcript, timeline, {
      subtitlePos: { x: 0.05, y: 0.05, scale: 0.6 },
      subtitleStyle: { color: '#ff0000', bg: 'transparent', fontFamily: 'Georgia, serif' },
    });
    expect(p.schemaVersion).toBe(2);
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
