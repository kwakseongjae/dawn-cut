import { extractChapters } from './chapters.js';
import { type DryRunReport, dryRunCommands } from './dryrun.js';
// /Users/kwakseongjae/Desktop/projects/dawn-cut/packages/core/src/planner.ts
// 변경점: parsePlan은 그대로 두되, JSON.parse/Array.isArray 검사를 extractFirstJsonArray
// 안으로 흡수하고, '첫 번째 [' 단일 시도 → '모든 [ 위치를 시도하여 명령 배열(원소가 모두
// 객체)을 우선 채택' 전략으로 교체. 마크다운 인용 [1]/링크 [label](url)/목록 등 산문 잡음
// 대괄호를 건너뛰어 진짜 EditCommand 배열을 회복한다. 순수성/시그니처/공개 표면 불변.
import {
  type EditCommand,
  type EditorState,
  commandManifest,
  safeParseEditCommand,
} from './edit-command.js';
import { detectFillers } from './fillers.js';
import { transcriptToCues } from './subtitles.js';

export interface StateSummary {
  durationUs: number;
  wordCount: number;
  cueCount: number;
  fillerCount: number;
  chapters: string[];
  hasSubtitleStyle: boolean;
}

export function summarizeState(state: EditorState): StateSummary {
  return {
    durationUs: state.timeline.durationProgram,
    wordCount: state.transcript.order.length,
    cueCount: transcriptToCues(state.transcript, state.timeline).length,
    fillerCount: detectFillers(state.transcript).length,
    chapters: extractChapters(state.transcript, state.timeline).map((c) => c.title),
    hasSubtitleStyle: state.subtitleStyle != null,
  };
}

export type PlanProvider = (prompt: string) => Promise<string>;

/**
 * 로컬 LLM 플래너가 NL만으로 안전히 합성할 수 있는 verb 화이트리스트.
 * grammar.ts의 plannerGrammar()와 정확히 같은 집합이어야 한다(프롬프트=문법 일치).
 * 제외: deleteWordRange/removeSilences/cutSourceRange/applyZoom(외부 좌표·ID 필요).
 */
export const PLANNER_VERBS = [
  'removeFillers',
  'applyGlossary',
  'setSubtitleStyle',
  'replaceSubtitleStyle',
  'applyColorgrade',
] as const;

/**
 * commandManifest()를 플래너 안전 verb로만 거른 매니페스트. buildPlanPrompt에 넘기면
 * 프롬프트가 안전한 도구만 노출 → 모델이 금지 verb(removeSilences 등)를 고를 여지를 없앤다.
 * plannerGrammar()(디코딩 제약)와 2중으로 같은 경계를 만든다.
 */
export function plannerManifest(): Array<{ name: string; inputSchema: unknown }> {
  const allow = new Set<string>(PLANNER_VERBS);
  return commandManifest().filter((t) => allow.has(t.name));
}

export function buildPlanPrompt(
  nl: string,
  summary: StateSummary,
  manifest: Array<{ name: string; inputSchema: unknown }>,
): string {
  const EXTERNAL_ONLY = ['removeSilences', 'cutSourceRange'];

  const tools = manifest
    .map((t) => {
      const note = EXTERNAL_ONLY.includes(t.name) ? ' (사용 금지: 외부정보 필요)' : '';
      return `- ${t.name}${note}: ${JSON.stringify(t.inputSchema)}`;
    })
    .join('\n');

  return [
    '당신은 dawn-cut(로컬 AI 비디오 에디터)의 편집 플래너다.',
    '아래 도구 스키마와 현재 상태 요약만 보고, 사용자의 요청을 수행하는',
    'EditCommand JSON 배열을 출력하라.',
    '',
    '규칙:',
    '1) 출력은 오직 JSON 배열 하나뿐이어야 한다. 설명/주석/코드펜스 없이 배열만.',
    '2) 각 원소는 아래 도구 스키마 중 하나에 정확히 맞는 객체여야 한다.',
    '3) "사용 금지"로 표시된 verb는 절대 쓰지 마라(외부정보가 필요해 만들 수 없음).',
    '4) 요청을 수행할 수 없으면 빈 배열 []을 출력하라.',
    '5) ID·좌표(clipId, wordId, mediaId, sourceStart/End, 무음 좌표)는 절대 추측하지 마라.',
    '   모르면 그 필드를 생략하라. applyColorgrade·applyZoom은 clipId를 생략하면 전체 영상에 적용된다.',
    '',
    '사용 가능한 도구(verb별 입력 JSON-Schema):',
    tools,
    '',
    '현재 상태 요약:',
    JSON.stringify(summary),
    '',
    `사용자 요청: ${nl}`,
    '',
    'EditCommand JSON 배열:',
  ].join('\n');
}

/**
 * provider 출력에서 EditCommand 배열을 추출·검증한다(순수). 코드펜스/잡설이 섞여도
 * 동작. 통과분만 plan, 실패는 사람이 읽을 메시지로 errors에 모은다.
 */
export function parsePlan(text: string): { plan: EditCommand[]; errors: string[] } {
  const errors: string[] = [];
  const arr = extractFirstJsonArray(text);
  if (arr === null) {
    return { plan: [], errors: ['no JSON array found in provider output'] };
  }

  const plan: EditCommand[] = [];
  for (let i = 0; i < arr.length; i++) {
    const parsed = safeParseEditCommand(arr[i]);
    if (parsed.success) {
      plan.push(parsed.data);
    } else {
      errors.push(`command[${i}] invalid: ${parsed.error.issues.map((x) => x.message).join('; ')}`);
    }
  }
  return { plan, errors };
}

/**
 * 텍스트에서 EditCommand 후보 JSON 배열을 찾아 파싱된 unknown[]로 돌려준다(순수).
 * '첫 번째 [' 하나만 보지 않는다 — LLM 산문에는 마크다운 인용 `[1]`·링크
 * `[label](url)`·목록 같은 '진짜 배열이 아닌 대괄호'가 흔히 앞선다. 모든 '[' 위치에서
 * 짝이 맞는 ']'까지를 잘라(문자열 리터럴 안 대괄호는 무시) JSON.parse를 시도하고,
 *   1) 원소가 모두 객체인 배열(= 진짜 명령 배열)을 즉시 채택(잡음 건너뜀),
 *   2) 없으면 파싱에 성공한 첫 배열(빈 배열 [] 포함)을 폴백으로 채택.
 * 아무 배열도 못 찾으면 null.
 */
function extractFirstJsonArray(text: string): unknown[] | null {
  let fallback: unknown[] | null = null;

  for (let s = text.indexOf('['); s !== -1; s = text.indexOf('[', s + 1)) {
    const raw = balancedArraySlice(text, s);
    if (raw === null) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // 이 '['는 진짜 JSON 배열이 아니다(예: "[가이드](url)").
    }
    if (!Array.isArray(parsed)) continue;

    if (
      parsed.length > 0 &&
      parsed.every((e) => typeof e === 'object' && e !== null && !Array.isArray(e))
    ) {
      return parsed; // 우선순위 1: 명령 배열.
    }
    if (fallback === null) fallback = parsed; // 우선순위 2: 폴백 보존.
  }
  return fallback;
}

/** `text[start]`의 '['부터 짝이 맞는 ']'까지를 돌려준다(문자열 리터럴 안 대괄호 무시). 닫히지 않으면 null. */
function balancedArraySlice(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export async function planAndPreview(
  nl: string,
  state: EditorState,
  provider: PlanProvider,
  manifest: Array<{ name: string; inputSchema: unknown }>,
): Promise<{ plan: EditCommand[]; report: DryRunReport; errors: string[] }> {
  const summary = summarizeState(state);
  const prompt = buildPlanPrompt(nl, summary, manifest);
  const text = await provider(prompt);
  const { plan, errors } = parsePlan(text);
  const { report } = dryRunCommands(state, plan);
  return { plan, report, errors };
}
