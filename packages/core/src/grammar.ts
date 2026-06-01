// GBNF 문법 — llama.cpp의 grammar-constrained decoding으로 로컬 LLM(llama-cli/llama-server,
// node-llama-cpp)의 출력 토큰을 '유효한 EditCommand JSON 배열'로 강제 제약한다.
//
// 왜 필요한가: 플래너(자연어→편집 명령)가 LLM이면, 자유 텍스트 출력은 깨진 JSON/존재하지
// 않는 verb/누락 필드를 흔하게 만든다. GBNF로 디코딩 단계에서 grammar를 강제하면
// "구문상 파싱 불가능한 출력"을 원천 차단할 수 있다 → safeParseEditCommand의 의미적
// 게이트(Zod)와 2중 방어. (GBNF는 구조만 보장하므로 padUs>=0 같은 의미 제약은 여전히 Zod 담당.)
//
// ★ 줄 형식 주의(실측): llama.cpp GBNF 파서는 '최상위 규칙 본문의 줄바꿈을 규칙 종료'로
//   본다(여러 줄 시퀀스는 괄호 안에서만 허용, 대안 `|`도 줄 앞에 두면 안 됨). 따라서 모든
//   규칙은 한 줄로 적는다. 이 형식을 어기면 'error parsing grammar: expecting name'으로
//   문법이 통째로 로드 실패한다(docs/P3-LLM-SIDECAR.md).
//
// 두 가지 문법을 노출한다:
//  - commandGrammar() : edit-command.ts의 9개 verb 전체(= MCP tool 표면과 1:1). 충실한 surface.
//  - plannerGrammar() : 로컬 LLM '플래너' 전용 안전 부분집합. 좌표·ID(clipId/wordId/소스/무음)를
//    NL만으로 합성할 수 없으므로 그런 필드를 요구하는 verb를 빼고, applyColorgrade에서도
//    clipId를 제거(생략 시 전체 적용)해 환각을 구조적으로 차단한다. rule-planner.ts의
//    '정보부족 verb 제외' 원칙과 동일한 안전 경계를 디코딩 단계에서 강제한다.
//
// 순수·결정적: 입력이 없고 항상 동일한 GBNF 문자열을 반환한다(node import 없음).

/**
 * EditCommand 9개 verb의 JSON 객체 배열을 표현하는 llama.cpp GBNF 문법 문자열을 반환한다.
 *
 * 9개 verb(deleteWordRange/removeSilences/removeFillers/cutSourceRange/applyGlossary/
 * setSubtitleStyle/replaceSubtitleStyle/applyColorgrade/applyZoom)와 1:1로 대응한다.
 * verb를 추가하면 cmd 대안과 규칙을 추가해야 한다.
 *
 * 주의: GBNF는 '구조'만 보장한다. 필드 의미(비음수/열린구간/사전값 등)는 Zod(safeParse)가
 * 최종 검증한다. 이 문법은 파서 친화적 출력을 유도하는 1차 제약이다.
 *
 * @returns llama.cpp `--grammar-file` / node-llama-cpp `GbnfGrammar`에 그대로 넣는 GBNF 문자열.
 */
export function commandGrammar(): string {
  return FULL_GBNF;
}

/**
 * 로컬 LLM 플래너 전용 GBNF(안전 부분집합)를 반환한다.
 *
 * 포함 verb(NL만으로 안전 합성 가능): removeFillers, applyGlossary, setSubtitleStyle,
 * replaceSubtitleStyle, applyColorgrade(preset, clipId 없음).
 * 제외 verb(외부 좌표·ID 필요 → 환각 위험): deleteWordRange(wordId)·removeSilences(무음 좌표)·
 * cutSourceRange(소스 좌표)·applyZoom(정밀 시간창). 이들은 store가 감지 결과로 별도 합성한다.
 *
 * 핵심: 모델에게 주는 상태 요약에는 clipId가 없다 → clipId를 문법에서 제거해 '있지도 않은
 * 클립을 지목'(조용한 no-op)하는 환각을 구조적으로 봉쇄한다. 전체 영상에 적용된다.
 *
 * @returns 플래너 안전 부분집합 GBNF 문자열.
 */
export function plannerGrammar(): string {
  return PLAN_GBNF;
}

// ── 공용 JSON 터미널(두 문법이 공유, 각 문법 문자열에 그대로 포함) ──
// string: 표준 JSON 문자열. char는 (a) escape 시퀀스 (b) 따옴표·역슬래시·제어문자를
//   제외한 모든 코드포인트([^"\\\x00-\x1F]) — 후자가 U+AC00.. 한글 음절을 포함해
//   한국어 문자열 값을 자연스럽게 허용한다(llama.cpp는 \x 헥스 escape를 char class에서 지원).
// number: 음수/소수/지수 포함 JSON 숫자(정수 µs와 1.0~ 배율 모두 표현).
// 모든 규칙은 '한 줄'이어야 한다(위 줄-형식 주의 참고).
// 두 문법 공통 터미널. integer는 정수 좌표(µs) verb에서만 쓰여 별도(INTEGER_RULE) — 플래너
// 부분집합엔 정수 좌표 필드가 없어 포함하면 '고아 규칙'이 된다.
const BASE_TERMINALS = String.raw`stringArray ::= "[" ws ( string ( ws "," ws string )* )? ws "]"
string ::= "\"" char* "\""
char ::= [^"\\\x00-\x1F] | "\\" escape
escape ::= ["\\/bfnrt] | "u" hex hex hex hex
hex ::= [0-9a-fA-F]
number ::= "-"? int frac? exp?
int ::= "0" | [1-9] [0-9]*
frac ::= "." [0-9]+
exp ::= ("e" | "E") ("+" | "-")? [0-9]+
ws ::= [ \t\n\r]*`;
const INTEGER_RULE = String.raw`integer ::= "-"? int`;

// 자막 스타일: 모든 필드 선택적 → 임의 순서 키-값 객체(의미 검증은 Zod). 한 줄 규칙.
const SUBTITLE_RULES = String.raw`subtitleStyle ::= "{" ws ( styleMember ( ws "," ws styleMember )* )? ws "}"
styleMember ::= styleKey ws ":" ws styleValue
styleKey ::= "\"color\"" | "\"bg\"" | "\"stroke\"" | "\"strokeWidth\"" | "\"fontFamily\"" | "\"fontWeight\"" | "\"fontScale\"" | "\"emphasisColor\"" | "\"animation\""
styleValue ::= string | number`;

const GLOSSARY_RULES = String.raw`applyGlossary ::= "{" ws "\"type\"" ws ":" ws "\"applyGlossary\"" ws "," ws "\"pairs\"" ws ":" ws pairArray ws "}"
pairArray ::= "[" ws ( pair ( ws "," ws pair )* )? ws "]"
pair ::= "{" ws "\"from\"" ws ":" ws string ws "," ws "\"to\"" ws ":" ws string ws "}"`;

const COLOR_PRESET_RULE = String.raw`colorPreset ::= "\"warm\"" | "\"cool\"" | "\"punch\"" | "\"cinematic\"" | "\"flat\""`;

// ── 전체 문법(9 verb) ──
const FULL_GBNF = `${String.raw`root ::= "[" ws ( cmd ( ws "," ws cmd )* )? ws "]"
cmd ::= deleteWordRange | removeSilences | removeFillers | cutSourceRange | applyGlossary | setSubtitleStyle | replaceSubtitleStyle | applyColorgrade | applyZoom
deleteWordRange ::= "{" ws "\"type\"" ws ":" ws "\"deleteWordRange\"" ws "," ws "\"fromWordId\"" ws ":" ws string ws "," ws "\"toWordId\"" ws ":" ws string ws "}"
removeSilences ::= "{" ws "\"type\"" ws ":" ws "\"removeSilences\"" ws "," ws "\"silences\"" ws ":" ws silenceArray ( ws "," ws "\"padUs\"" ws ":" ws integer )? ws "}"
silenceArray ::= "[" ws ( silence ( ws "," ws silence )* )? ws "]"
silence ::= "{" ws "\"start\"" ws ":" ws integer ws "," ws "\"end\"" ws ":" ws integer ws "}"
removeFillers ::= "{" ws "\"type\"" ws ":" ws "\"removeFillers\"" ( ws "," ws "\"lexicon\"" ws ":" ws stringArray )? ws "}"
cutSourceRange ::= "{" ws "\"type\"" ws ":" ws "\"cutSourceRange\"" ws "," ws "\"mediaId\"" ws ":" ws string ws "," ws "\"sourceStart\"" ws ":" ws integer ws "," ws "\"sourceEnd\"" ws ":" ws integer ws "}"
setSubtitleStyle ::= "{" ws "\"type\"" ws ":" ws "\"setSubtitleStyle\"" ws "," ws "\"patch\"" ws ":" ws subtitleStyle ws "}"
replaceSubtitleStyle ::= "{" ws "\"type\"" ws ":" ws "\"replaceSubtitleStyle\"" ws "," ws "\"style\"" ws ":" ws subtitleStyle ws "}"
applyColorgrade ::= "{" ws "\"type\"" ws ":" ws "\"applyColorgrade\"" ws "," ws ( "\"clipId\"" ws ":" ws string ws "," ws )? "\"preset\"" ws ":" ws colorPreset ( ws "," ws "\"intensity\"" ws ":" ws number )? ws "}"
applyZoom ::= "{" ws "\"type\"" ws ":" ws "\"applyZoom\"" ws "," ws ( "\"clipId\"" ws ":" ws string ws "," ws )? "\"from\"" ws ":" ws number ws "," ws "\"to\"" ws ":" ws number ws "," ws "\"startUs\"" ws ":" ws integer ws "," ws "\"endUs\"" ws ":" ws integer ws "}"`}
${GLOSSARY_RULES}
${SUBTITLE_RULES}
${COLOR_PRESET_RULE}
${INTEGER_RULE}
${BASE_TERMINALS}
`;

// ── 플래너 안전 부분집합(5 verb, clipId/좌표/외부ID 없음) ──
const PLAN_GBNF = `${String.raw`root ::= "[" ws ( cmd ( ws "," ws cmd )* )? ws "]"
cmd ::= removeFillers | applyGlossary | setSubtitleStyle | replaceSubtitleStyle | applyColorgrade
removeFillers ::= "{" ws "\"type\"" ws ":" ws "\"removeFillers\"" ( ws "," ws "\"lexicon\"" ws ":" ws stringArray )? ws "}"
setSubtitleStyle ::= "{" ws "\"type\"" ws ":" ws "\"setSubtitleStyle\"" ws "," ws "\"patch\"" ws ":" ws subtitleStyle ws "}"
replaceSubtitleStyle ::= "{" ws "\"type\"" ws ":" ws "\"replaceSubtitleStyle\"" ws "," ws "\"style\"" ws ":" ws subtitleStyle ws "}"
applyColorgrade ::= "{" ws "\"type\"" ws ":" ws "\"applyColorgrade\"" ws "," ws "\"preset\"" ws ":" ws colorPreset ( ws "," ws "\"intensity\"" ws ":" ws number )? ws "}"`}
${GLOSSARY_RULES}
${SUBTITLE_RULES}
${COLOR_PRESET_RULE}
${BASE_TERMINALS}
`;

/**
 * `commandGrammar()`(전체 9 verb)의 결과를 모듈 로드 시점에 한 번 계산해 둔 상수.
 * 기존 호출부 호환을 위해 유지(전체 문법). 플래너용 부분집합은 `PLANNER_PLAN_GRAMMAR`.
 */
export const PLANNER_GRAMMAR: string = commandGrammar();

/**
 * `plannerGrammar()`(안전 부분집합)의 결과를 모듈 로드 시점에 한 번 계산해 둔 상수.
 * 사이드카(@dawn-cut/sidecar-llm)가 매 호출 함수 실행 없이 바로 참조한다.
 */
export const PLANNER_PLAN_GRAMMAR: string = plannerGrammar();
