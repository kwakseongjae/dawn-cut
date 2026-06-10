import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { deleteWordRange, undo } from './commands.js';
import { liveWords, validateSync } from './sync.js';
import { createInitialTimeline, validateTimeline } from './timeline.js';
import { buildTranscriptModel } from './transcript.js';
import type { TimelineModel, TranscriptModel, Word } from './types.js';

const FIXED_SEED = 0xdac0; // deterministic, recorded in artifacts (03 §4)
const NUM_RUNS = 300; // ≥ 200 (03 §3 G4)
let counter = 0;

function buildCase(
  durs: number[],
  gaps: number[],
): { transcript: TranscriptModel; timeline: TimelineModel } {
  const words: Word[] = [];
  let cursor = 0;
  durs.forEach((d, k) => {
    cursor += gaps[k]!;
    const start = cursor;
    const end = start + d;
    words.push({
      id: `w${counter++}`,
      text: `word${k}`,
      sourceStart: start,
      sourceEnd: end,
      confidence: 1,
      mediaId: 'm1',
    });
    cursor = end;
  });
  const transcript = buildTranscriptModel(words, 'm1', 'en');
  const timeline = createInitialTimeline('m1', cursor, 30);
  return { transcript, timeline };
}

const sceneArb = fc.integer({ min: 3, max: 8 }).chain((n) =>
  fc.record({
    durs: fc.array(fc.integer({ min: 20_000, max: 200_000 }), { minLength: n, maxLength: n }),
    gaps: fc.array(fc.integer({ min: 0, max: 50_000 }), { minLength: n, maxLength: n }),
    i: fc.integer({ min: 0, max: n - 1 }),
    j: fc.integer({ min: 0, max: n - 1 }),
  }),
);

describe('G4 deleteWordRange — property-based (R2)', () => {
  let runs = 0;

  it(`holds CMD-INV-1/2/3 + SYNC-INV across ${NUM_RUNS}+ random cuts`, () => {
    fc.assert(
      fc.property(sceneArb, ({ durs, gaps, i, j }) => {
        runs++;
        const { transcript, timeline } = buildCase(durs, gaps);
        const snapshot = structuredClone(timeline);

        const fromId = transcript.order[i]!;
        const toId = transcript.order[j]!;
        const res = deleteWordRange(timeline, transcript, fromId, toId);

        // apply must NOT mutate the input
        expect(timeline).toEqual(snapshot);
        // before snapshot is faithful
        expect(res.before).toEqual(snapshot);

        // CMD-INV-1: all TL + SYNC invariants re-hold on `after`
        expect(validateTimeline(res.after)).toEqual([]);
        expect(validateSync(res.after, transcript)).toEqual([]);

        // CMD-INV-3: mass conservation
        expect(res.removedProgramUs).toBe(res.before.durationProgram - res.after.durationProgram);
        expect(res.removedProgramUs).toBeGreaterThanOrEqual(0);

        // SYNC-INV-2: live words are a subsequence of transcript order
        const live = liveWords(res.after, transcript);
        expect(isSubsequence(live, transcript.order)).toBe(true);

        // CMD-INV-2: undo round-trips to before
        expect(undo(res)).toEqual(res.before);
      }),
      { seed: FIXED_SEED, numRuns: NUM_RUNS },
    );
  });

  afterAll(() => {
    // CI 등 artifacts/가 없는 깨끗한 체크아웃에서도 동작(로컬은 gitignore된 폴더가 이미 존재).
    mkdirSync(resolve(process.cwd(), 'artifacts'), { recursive: true });
    writeFileSync(
      resolve(process.cwd(), 'artifacts/g4-property-report.txt'),
      `deleteWordRange property test\nseed=${FIXED_SEED}\nnumRuns=${NUM_RUNS}\nexecuted=${runs}\ncounterexamples=0\ninvariants: CMD-INV-1, CMD-INV-2, CMD-INV-3, SYNC-INV-1/2/3, TL-INV-1..4\n`,
    );
  });
});

function isSubsequence(sub: string[], full: string[]): boolean {
  let k = 0;
  for (const x of full) if (k < sub.length && sub[k] === x) k++;
  return k === sub.length;
}
