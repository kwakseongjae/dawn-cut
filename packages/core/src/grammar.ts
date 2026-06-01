// GBNF 문법 — llama.cpp의 grammar-constrained decoding으로 로컬 LLM(예: llama.cpp 서버,
// node-llama-cpp)의 출력 토큰을 '유효한 EditCommand JSON 배열'로 강제 제약한다.
//
// 왜 필요한가: 플래너(자연어→편집 명령)가 LLM이면, 자유 텍스트 출력은 깨진 JSON/존재하지
// 않는 verb/누락 필드를 흔하게 만든다. GBNF로 디코딩 단계에서 grammar를 강제하면
// "구문상 파싱 불가능한 출력"을 원천 차단할 수 있다 → safeParseEditCommand의 의미적
// 게이트(Zod)와 2중 방어. (GBNF는 구조만 보장하므로 padUs>=0 같은 의미 제약은 여전히 Zod 담당.)
//
// 이 문법은 edit-command.ts의 9개 verb(deleteWordRange/removeSilences/removeFillers/
// cutSourceRange/applyGlossary/setSubtitleStyle/replaceSubtitleStyle/applyColorgrade/
// applyZoom)와 1:1로 대응한다. verb를 추가하면 여기 cmd 대안도 추가해야 한다.
//
// 순수·결정적: 입력이 없고 항상 동일한 GBNF 문자열을 반환한다(node import 없음).

/**
 * EditCommand 9개 verb의 JSON 객체 배열을 표현하는 llama.cpp GBNF 문법 문자열을 반환한다.
 *
 * 표현 범위:
 *  - `root ::= "[" (cmd ("," cmd)*)? "]"` — 0개 이상의 명령으로 이루어진 JSON 배열.
 *  - `cmd ::= 9개 verb 객체의 alternation` — 각 verb는 `"type"` 리터럴과 주요 필드를 제약.
 *  - 숫자/문자열 터미널 포함. `string`은 유니코드 코드포인트를 허용해 한국어 문자열 값을 표현한다.
 *
 * 주의: GBNF는 '구조'만 보장한다. 필드의 의미(비음수/열린구간/사전값 등)는 Zod(safeParse)에서
 * 최종 검증한다. 즉 이 문법은 파서 친화적 출력을 유도하는 1차 제약이다.
 *
 * @returns llama.cpp `--grammar` / node-llama-cpp `GbnfGrammar`에 그대로 넣을 수 있는 GBNF 문자열.
 */
export function commandGrammar(): string {
  return GBNF;
}

// ── 공용 JSON 터미널 ──
// ws: JSON 공백(선택적). 모델이 들여쓰기/개행을 내도 허용.
// string: 표준 JSON 문자열. char는 (a) escape 시퀀스 (b) 따옴표·역슬래시·제어문자를
//   제외한 모든 코드포인트([^"\\\x00-\x1F]) — 후자가 U+AC00 등 한글 음절을 포함해
//   한국어 문자열 값을 자연스럽게 허용한다.
// number: 음수/소수/지수 포함 JSON 숫자(정수 µs와 1.0~ 배율 모두 표현).
// boolean: 자막 스타일 등 향후 확장 여지(현재 verb는 미사용이나 JSON 보편 터미널로 둠).
const GBNF = String.raw`root ::= "[" ws (cmd (ws "," ws cmd)*)? ws "]"

cmd ::=
    deleteWordRange
  | removeSilences
  | removeFillers
  | cutSourceRange
  | applyGlossary
  | setSubtitleStyle
  | replaceSubtitleStyle
  | applyColorgrade
  | applyZoom

deleteWordRange ::= "{" ws
  "\"type\"" ws ":" ws "\"deleteWordRange\"" ws "," ws
  "\"fromWordId\"" ws ":" ws string ws "," ws
  "\"toWordId\"" ws ":" ws string ws
  "}"

removeSilences ::= "{" ws
  "\"type\"" ws ":" ws "\"removeSilences\"" ws "," ws
  "\"silences\"" ws ":" ws silenceArray ( ws "," ws "\"padUs\"" ws ":" ws integer )? ws
  "}"

silenceArray ::= "[" ws ( silence ( ws "," ws silence )* )? ws "]"
silence ::= "{" ws
  "\"start\"" ws ":" ws integer ws "," ws
  "\"end\"" ws ":" ws integer ws
  "}"

removeFillers ::= "{" ws
  "\"type\"" ws ":" ws "\"removeFillers\"" ( ws "," ws "\"lexicon\"" ws ":" ws stringArray )? ws
  "}"

cutSourceRange ::= "{" ws
  "\"type\"" ws ":" ws "\"cutSourceRange\"" ws "," ws
  "\"mediaId\"" ws ":" ws string ws "," ws
  "\"sourceStart\"" ws ":" ws integer ws "," ws
  "\"sourceEnd\"" ws ":" ws integer ws
  "}"

applyGlossary ::= "{" ws
  "\"type\"" ws ":" ws "\"applyGlossary\"" ws "," ws
  "\"pairs\"" ws ":" ws pairArray ws
  "}"

pairArray ::= "[" ws ( pair ( ws "," ws pair )* )? ws "]"
pair ::= "{" ws
  "\"from\"" ws ":" ws string ws "," ws
  "\"to\"" ws ":" ws string ws
  "}"

setSubtitleStyle ::= "{" ws
  "\"type\"" ws ":" ws "\"setSubtitleStyle\"" ws "," ws
  "\"patch\"" ws ":" ws subtitleStyle ws
  "}"

replaceSubtitleStyle ::= "{" ws
  "\"type\"" ws ":" ws "\"replaceSubtitleStyle\"" ws "," ws
  "\"style\"" ws ":" ws subtitleStyle ws
  "}"

# 자막 스타일은 모든 필드가 선택적이라 임의 순서의 키-값 객체로 둔다(의미 검증은 Zod).
subtitleStyle ::= "{" ws ( styleMember ( ws "," ws styleMember )* )? ws "}"
styleMember ::= styleKey ws ":" ws styleValue
styleKey ::=
    "\"color\""
  | "\"bg\""
  | "\"stroke\""
  | "\"strokeWidth\""
  | "\"fontFamily\""
  | "\"fontWeight\""
  | "\"fontScale\""
  | "\"emphasisColor\""
styleValue ::= string | number

applyColorgrade ::= "{" ws
  "\"type\"" ws ":" ws "\"applyColorgrade\"" ws "," ws
  ( "\"clipId\"" ws ":" ws string ws "," ws )?
  "\"preset\"" ws ":" ws colorPreset ( ws "," ws "\"intensity\"" ws ":" ws number )? ws
  "}"

colorPreset ::=
    "\"warm\""
  | "\"cool\""
  | "\"punch\""
  | "\"cinematic\""
  | "\"flat\""

applyZoom ::= "{" ws
  "\"type\"" ws ":" ws "\"applyZoom\"" ws "," ws
  ( "\"clipId\"" ws ":" ws string ws "," ws )?
  "\"from\"" ws ":" ws number ws "," ws
  "\"to\"" ws ":" ws number ws "," ws
  "\"startUs\"" ws ":" ws integer ws "," ws
  "\"endUs\"" ws ":" ws integer ws
  "}"

stringArray ::= "[" ws ( string ( ws "," ws string )* )? ws "]"

# string: 표준 JSON 문자열. 一 등은 escape, 그리고 따옴표/역슬래시/제어문자를 뺀
# 모든 코드포인트를 그대로 허용 → U+AC00.. 한글 음절 등 한국어 값 표현 가능.
string ::= "\"" char* "\""
char ::= [^"\\\x00-\x1F] | "\\" escape
escape ::= ["\\/bfnrt] | "u" hex hex hex hex
hex ::= [0-9a-fA-F]

# number: JSON 숫자(부호/소수/지수 허용). integer: 부호 있는 정수(µs 좌표).
number ::= "-"? int frac? exp?
integer ::= "-"? int
int ::= "0" | [1-9] [0-9]*
frac ::= "." [0-9]+
exp ::= ("e" | "E") ("+" | "-")? [0-9]+

ws ::= [ \t\n\r]*
`;

/**
 * `commandGrammar()`의 결과를 모듈 로드 시점에 한 번 계산해 둔 상수.
 * 플래너 파이프라인에서 매 호출 함수 실행 없이 바로 참조하도록 export.
 */
export const PLANNER_GRAMMAR: string = commandGrammar();
