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
      schemaVersion: 2 as 1,
    });
    expect(() => deserializeProject(bad)).toThrow(/schemaVersion/);
  });

  it('rejects a corrupt project (broken invariant)', () => {
    const { transcript, timeline } = scene();
    const p = makeProject('/x/sample.mp4', transcript, timeline);
    p.timeline.durationProgram = 999_999_999; // TL-INV-4 violation
    expect(() => deserializeProject(serializeProject(p))).toThrow(/invalid project/);
  });
});
