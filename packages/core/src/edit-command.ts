// 편집 command bus — 비전(자연어→AI가 tool/MCP로 dawn-cut 조작)의 키스톤.
// 모든 편집 동작을 '직렬화 가능한 EditCommand'로 표현하고, 단일 applyCommand
// 디스패처가 결정적 reducer로 적용한 뒤 불변식을 검증한다. 사람 GUI(store)와
// AI 에이전트가 정확히 같은 command bus를 구동한다.
//
// verb당 Zod 스키마 1개가 단일 진실원천 → (a) TS 타입(z.infer), (b) 경계의
// 런타임 가드(safeParse), (c) JSON-Schema/MCP 매니페스트(z.toJSONSchema) 모두 파생.
// Zod는 순수 TS라 packages/core 이식성 경계(dependency-cruiser)를 통과한다.
import { z } from 'zod';
import { cutSourceRange, deleteWordRange, removeSilences } from './commands.js';
import { detectFillers } from './fillers.js';
import { type GlossaryPair, applyGlossary } from './glossary.js';
import { wordToProgram } from './sync.js';
import { validateSync } from './sync.js';
import { validateTimeline } from './timeline.js';
import { buildTranscriptModel, validateTranscript } from './transcript.js';
import type { TimelineModel, TranscriptModel } from './types.js';

/** AI 에이전트와 사람 GUI가 공유하는 편집 상태. (overlays/subtitleStyle/glossary는 후속 확장) */
export interface EditorState {
  timeline: TimelineModel;
  transcript: TranscriptModel;
}

/** 적용 결과 — before/after 전체 상태 + 프로그램 길이 변화(undo·dry-run diff 기반). */
export interface CommandOutcome {
  before: EditorState;
  after: EditorState;
  removedProgramUs: number;
}

// ── verb별 Zod 스키마 (단일 진실원천) ──
const SilenceZ = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const CommandSchemas = {
  /** 단어 범위 삭제(텍스트 기반 컷). */
  deleteWordRange: z.object({
    type: z.literal('deleteWordRange'),
    fromWordId: z.string().min(1),
    toWordId: z.string().min(1),
  }),
  /** 외부에서 감지한 무음 구간 제거. (감지=sidecar IO, 명령은 결과만 받음) */
  removeSilences: z.object({
    type: z.literal('removeSilences'),
    silences: z.array(SilenceZ),
    padUs: z.number().int().nonnegative().default(0),
  }),
  /** 말버릇(음/어…) 어절을 타임라인에서 일괄 컷. lexicon 미지정 시 기본 사전. */
  removeFillers: z.object({
    type: z.literal('removeFillers'),
    lexicon: z.array(z.string()).optional(),
  }),
  /** 소스 구간 직접 컷. */
  cutSourceRange: z.object({
    type: z.literal('cutSourceRange'),
    mediaId: z.string().min(1),
    sourceStart: z.number().int().nonnegative(),
    sourceEnd: z.number().int().positive(),
  }),
  /** 고유명사 '내 사전' 치환을 전사에 적용(transcript 변환). */
  applyGlossary: z.object({
    type: z.literal('applyGlossary'),
    pairs: z.array(z.object({ from: z.string(), to: z.string() })),
  }),
} as const;

export const EditCommandSchema = z.discriminatedUnion('type', [
  CommandSchemas.deleteWordRange,
  CommandSchemas.removeSilences,
  CommandSchemas.removeFillers,
  CommandSchemas.cutSourceRange,
  CommandSchemas.applyGlossary,
]);

/** 직렬화 가능한 편집 명령. LLM/에이전트가 이 형태의 JSON을 생성한다. */
export type EditCommand = z.infer<typeof EditCommandSchema>;

/** 경계 런타임 가드 — 알 수 없는/잘못된 명령을 거부(에이전트 자가수정용 granular error). */
export function safeParseEditCommand(
  input: unknown,
): ReturnType<typeof EditCommandSchema.safeParse> {
  return EditCommandSchema.safeParse(input);
}
export function parseEditCommand(input: unknown): EditCommand {
  return EditCommandSchema.parse(input);
}

/** tool/MCP 매니페스트 — verb별 JSON-Schema(z.toJSONSchema). MCP tools/list의 입력 스키마. */
export function commandManifest(): Array<{ name: string; inputSchema: unknown }> {
  return Object.entries(CommandSchemas).map(([name, schema]) => ({
    name,
    inputSchema: z.toJSONSchema(schema),
  }));
}

/** 상태 불변식(T-INV/TL-INV/SYNC-INV) 위반 목록([]==유효). 명령 적용 후 post-condition 게이트. */
function validateState(state: EditorState): string[] {
  return [
    ...validateTimeline(state.timeline),
    ...validateTranscript(state.transcript),
    ...validateSync(state.timeline, state.transcript),
  ];
}

// ── reducer들 (순수) — timeline 변환은 기존 commands.ts CommandResult를 흡수 ──
function liveFillerIds(state: EditorState, lexicon?: string[]): string[] {
  const opts = lexicon ? { lexicon } : undefined;
  return detectFillers(state.transcript, opts).filter(
    (id) => wordToProgram(state.timeline, state.transcript.words[id]!) !== null,
  );
}

function reduce(state: EditorState, cmd: EditCommand): EditorState {
  switch (cmd.type) {
    case 'deleteWordRange': {
      const { after } = deleteWordRange(
        state.timeline,
        state.transcript,
        cmd.fromWordId,
        cmd.toWordId,
      );
      return { ...state, timeline: after };
    }
    case 'removeSilences': {
      const { after } = removeSilences(
        state.timeline,
        state.transcript.mediaId,
        cmd.silences,
        cmd.padUs,
      );
      return { ...state, timeline: after };
    }
    case 'removeFillers': {
      let timeline = state.timeline;
      for (const id of liveFillerIds(state, cmd.lexicon)) {
        timeline = deleteWordRange(timeline, state.transcript, id, id).after;
      }
      return { ...state, timeline };
    }
    case 'cutSourceRange': {
      // cutSourceRange는 (CommandResult가 아니라) 새 TimelineModel을 직접 반환한다.
      const timeline = cutSourceRange(state.timeline, cmd.mediaId, cmd.sourceStart, cmd.sourceEnd);
      return { ...state, timeline };
    }
    case 'applyGlossary': {
      // transcript 변환(단어 텍스트 치환) — 타임스탬프/id 보존이라 sync 불변식 유지.
      const words = state.transcript.order.map((id) => state.transcript.words[id]!);
      const transcript = buildTranscriptModel(
        applyGlossary(words, cmd.pairs as GlossaryPair[]),
        state.transcript.mediaId,
        state.transcript.language,
      );
      return { ...state, transcript };
    }
  }
}

/**
 * 단일 디스패처 — EditCommand를 검증·적용하고 적용 후 불변식을 강제한다.
 * 1) Zod로 명령 파싱(잘못된 형태 거부) 2) 결정적 reducer 적용
 * 3) post-condition 불변식 검증(위반 시 throw → 상태 오염 방지, 에이전트는 re-plan).
 */
export function applyCommand(state: EditorState, command: unknown): CommandOutcome {
  const cmd = parseEditCommand(command);
  const after = reduce(state, cmd);
  const violations = validateState(after);
  if (violations.length > 0) {
    throw new Error(`applyCommand(${cmd.type}) violated invariants:\n${violations.join('\n')}`);
  }
  return {
    before: state,
    after,
    removedProgramUs: state.timeline.durationProgram - after.timeline.durationProgram,
  };
}
