// 룰기반 한국어 플래너 — '모델 없이 지금 동작하는' 자연어→EditCommand[] 변환기.
//
// 비전(자연어→AI가 command bus로 dawn-cut 조작)의 첫 디딤돌. LLM이 없거나 100%
// 로컬·오프라인 환경에서도, 흔한 한국어 편집 의도를 결정적 룰 매칭으로 EditCommand
// 배열로 만든다. 결과는 곧장 dryRunCommands/applyCommand에 흘릴 수 있다.
//
// 설계 원칙(중요):
//  - 순수·결정적. 같은 입력 → 같은 출력. 부수효과·IO·난수 없음.
//  - 환각 금지. 확신 없으면 빈 배열. '아마 이거겠지' 식 추측 명령을 만들지 않는다.
//  - 정보부족 verb는 의도적으로 제외. removeSilences(감지된 무음 좌표 필요)·
//    cutSourceRange(소스 좌표 필요)·deleteWordRange(단어 id 필요)는 NL만으로
//    안전히 합성 불가 → 만들지 않음. 무음 제거는 store가 detectSilences 후 별도 합성.
//  - 한국어 표현 다양성(존댓말/반말/어순/조사) 일부 흡수.
import type { EditCommand, EditorState } from './edit-command.js';

/** applyColorgrade.preset 으로 그대로 흘릴 색보정 프리셋 키. */
type ColorPreset = 'warm' | 'cool' | 'punch' | 'cinematic' | 'flat';

/**
 * 색보정 프리셋 매핑 규칙. 각 프리셋마다 한국어 표현 후보를 정규식으로 모은다.
 * 순서가 곧 우선순위 — 위에서부터 처음 매칭되는 프리셋 1개만 채택한다.
 * (예: '시네마틱하게 따뜻하게'처럼 충돌해도 결정적으로 cinematic이 이긴다.)
 */
const COLOR_RULES: ReadonlyArray<readonly [ColorPreset, RegExp]> = [
  // 시네마틱/영화 같은/필름 룩
  ['cinematic', /시네마틱|시네마|영화\s*(같|처럼|풍|느낌)|필름\s*(룩|느낌)|영화같/],
  // 따뜻하게/웜톤/포근한
  ['warm', /따뜻|따듯|웜\s*톤|warm|포근|노란\s*톤|황금/],
  // 차갑게/쿨톤/시원한/푸른
  ['cool', /차갑|차가|시원|쿨\s*톤|cool|푸른\s*톤|파란\s*톤|블루\s*톤/],
  // 선명하게/쨍하게/대비/채도 강조(쇼츠 느낌)
  ['punch', /선명|쨍|또렷|대비\s*(강|올|높)|채도\s*(강|올|높)|생생|punch|쇼츠\s*(톤|느낌)/],
  // 플랫/평탄/로그/무보정에 가깝게
  ['flat', /플랫|평탄|로그\s*(톤|느낌)|flat|밋밋|무보정|보정\s*(빼|없)/],
];

/** '색/톤/느낌/보정/그레이딩' 류 대상어가 문장에 있는지(색보정 의도 신호). */
const COLOR_TARGET = /색|톤|느낌|보정|그레이딩|색감|색상|화면|영상/;

/**
 * 색보정 '명령형' 동사. 예전엔 `해|로|으로|줘` 같은 초고빈도 토막을 포함해
 * 거의 모든 한국어 문장을 통과시켜 환각을 유발했다(예: "기분이 차가워서 우울해요"의
 * '해'). 이제는 편집 지시로 보기에 충분한 동사형만 받는다(맨끝 단독 '줘'는 명령으로 인정).
 */
const APPLY_VERB =
  /(해줘|해 줘|해주세요|해주|해라|바꿔|적용|만들어|되게|보정해|그레이딩해|입혀|걸어|넣어|줘$)/;

/**
 * 색 키워드 자체가 '…하게/…게' 변형 명령형으로 쓰인 형태(시네마틱하게/따뜻하게/차갑게…).
 * 이 형태는 그 자체로 '바꿔달라'는 변형 지시 신호라 추가 대상어 없이도 채택한다.
 */
const TRANSFORM_ADV =
  /(시네마틱하게|시네마틱 하게|따뜻하게|따듯하게|포근하게|차갑게|차게|시원하게|선명하게|쨍하게|또렷하게|생생하게|플랫하게|밋밋하게)/;

/**
 * 서술/과거 내레이션 어미(…였어/…네요/…어요/…싶… 등). 명령 동사가 함께 없으면
 * 색 키워드가 있어도 '편집 지시'가 아니라 '감상/진술'로 보고 보류한다.
 */
const DESCRIPTIVE_TAIL =
  /(였어|었어|었다|였다|네요|이네|이에요|예요|어요|아요|더라|구나|군요|좋아|좋다|싶|자연스|올렸|봤|꿨|그렸)/;

/**
 * 색이 아니라 '온도/날씨/기분/음식' 등 비-영상 대상에 걸린 따뜻/시원/차갑 류를 거른다.
 * (예: "음식 따뜻하게 데워줘", "시원한 맥주 마시고 싶다" → 색보정 아님.) 강한 veto.
 */
const NON_VIDEO_OBJECT = /(데워|식혀|마시|음료|음식|날씨|기분|마음|사람|커피|맥주|국물|물 )/;

/**
 * 말버릇/필러 제거 의도. '말버릇/필러/추임새'를 '제거/빼/잘라/없애/지워' 한다.
 * 어순·조사 변형을 흡수하기 위해 대상어와 동사를 분리 매칭한다.
 */
const FILLER_TARGET = /말버릇|추임새|필러|간투사|군더더기\s*말|음\s*어/;
const REMOVE_VERB = /(제거|빼|빽|잘라|없애|지워|삭제|날려|덜어|컷)/;

/**
 * 키워드 강조 자막 의도. '핵심/중요/키워드/요점/포인트' 류 대상어 + '강조/하이라이트/표시',
 * 또는 '강조 자막'. 대상어를 요구해 "채도 강조"(=punch 색보정)와 충돌하지 않게 한다.
 */
const HIGHLIGHT_RULE =
  /(핵심|중요한?|키워드|요점|포인트)\s*(말|단어|문구|부분|구절)?\s*(을|를|만)?\s*(강조|하이라이트|표시)|강조\s*자막/;

/**
 * 자연어(한국어) 편집 지시 1개를 EditCommand 배열로 변환한다(결정적·순수).
 *
 * 지원 의도:
 *  - 말버릇/필러 제거       → `{ type: 'removeFillers' }`
 *  - 색보정 프리셋 적용     → `{ type: 'applyColorgrade', preset }`
 *    (시네마틱/따뜻/차갑/선명/플랫 → cinematic/warm/cool/punch/flat)
 *
 * 한 문장이 여러 의도를 담으면(예: "말버릇 빼고 시네마틱하게") 해당 명령을
 * 모두 합성한다(필러 제거 → 색보정 순). 매칭이 하나도 없으면 빈 배열.
 *
 * 의도적으로 만들지 않는 것(정보부족·환각 위험):
 *  - 무음/공백 제거: 감지된 silence 좌표가 필요 → store가 detectSilences 후
 *    removeSilences를 별도 합성. 여기선 NL만으로 만들 수 없어 제외.
 *  - cutSourceRange / deleteWordRange: 소스 좌표·단어 id가 NL에 없어 제외.
 *  - 자막 스타일 프리셋: patch 구조가 복잡(폰트/스트로크/색…)해 단순 룰로
 *    안전히 못 만듦 → 미지원(제외).
 *
 * @param nl    한국어 자연어 지시(존댓말/반말/어순 변형 일부 허용).
 * @param state 현재 편집 상태(현재 룰은 상태에 의존하지 않지만, 향후 대상 클립
 *              선택 등 확장을 위해 시그니처에 포함 — 미사용이어도 인터페이스 안정).
 * @returns 합성된 EditCommand[]. 모르면 `[]`(환각 금지).
 */
export function ruleBasedPlan(nl: string, _state: EditorState): EditCommand[] {
  // 공백 정규화(연속 공백 1개로) — 정규식 매칭 안정화. 대소문자 무시는 정규식 i 플래그 대신
  // 소문자 사본으로 처리해 한글은 그대로 두고 라틴(warm/cool/flat/punch)만 흡수.
  const text = nl.normalize('NFC').replace(/\s+/g, ' ').trim();
  const hay = `${text} ${text.toLowerCase()}`; // 한글 원문 + 라틴 소문자 사본 동시 검사.

  const commands: EditCommand[] = [];

  // 1) 말버릇/필러 제거 — 대상어 + 제거동사가 함께 있어야 한다(둘 중 하나만이면 보류).
  if (FILLER_TARGET.test(hay) && REMOVE_VERB.test(hay)) {
    commands.push({ type: 'removeFillers' });
  }

  // 1.5) 키워드 강조 자막 — '핵심/키워드 …강조'. 색 지정은 단순화로 생략(기본 강조색).
  if (HIGHLIGHT_RULE.test(hay)) {
    commands.push({ type: 'highlightKeyword' });
  }

  // 2) 색보정 프리셋 — 색 키워드 + '편집 지시 게이트'(matchColorPreset) 통과 시에만.
  //    색 키워드 단독(시네마틱/따뜻 등)으로는 발화하지 않는다(환각 방지).
  const preset = matchColorPreset(hay);
  if (preset) commands.push({ type: 'applyColorgrade', preset });

  return commands;
}

/**
 * 색보정 프리셋 1개를 결정적으로 고른다(없으면 null). COLOR_RULES 순서가 우선순위.
 *
 * 핵심: 색 키워드만으로는 절대 발화하지 않는다(환각 금지). 키워드가 매칭되어도 아래
 * '편집 지시 게이트'를 통과해야만 채택한다.
 *  1) 비-영상 대상(온도/음식/날씨/기분…)이 있으면 즉시 보류(veto). "음식 따뜻하게 데워줘" ✕.
 *  2) 서술/과거 어미(…였어/…네요/…싶…)인데 명령동사가 없으면 보류. "보정 빼고 올렸어요" ✕.
 *  3) 색 키워드가 변형 명령형('…하게': 시네마틱하게/따뜻하게…)이면 채택. "시네마틱하게" ✓.
 *  4) 또는 색 대상어(색/톤/보정/화면/영상…) + 명령동사(해줘/바꿔/만들어…)가 함께면 채택.
 *     "톤 바꿔줘"/"색 보정해줘" ✓.
 * '시네마틱/시네마'도 더는 무조건 통과하지 않는다('시네마 가서 영화 봤어요' ✕).
 */
function matchColorPreset(hay: string): ColorPreset | null {
  // (1) 비-영상 대상이면 색보정 의도가 아니다 — 강한 veto.
  if (NON_VIDEO_OBJECT.test(hay)) return null;

  const hasDirective = APPLY_VERB.test(hay);
  // (2) 서술/감상 진술인데 명령동사가 없으면 편집 지시로 보지 않는다.
  if (DESCRIPTIVE_TAIL.test(hay) && !hasDirective) return null;

  // (3)/(4) 편집 지시 신호: 변형 명령형 부사 OR (색 대상어 + 명령동사).
  const isEditIntent = TRANSFORM_ADV.test(hay) || (COLOR_TARGET.test(hay) && hasDirective);
  if (!isEditIntent) return null;

  for (const [preset, re] of COLOR_RULES) {
    if (re.test(hay)) return preset; // 우선순위 = COLOR_RULES 순서.
  }
  return null;
}

/**
 * planner.ts의 PlanProvider 어댑터 팩토리.
 *
 * planner는 보통 `(prompt: string) => Promise<string>`(LLM 호출) 형태의 provider를
 * 기대한다. 룰 플래너는 원 NL을 prompt에서 역추출하기 어려우므로, NL을 클로저로
 * 미리 받아 고정한 provider를 만들어 반환한다. 반환 함수는 prompt 인자를 무시하고
 * 항상 `JSON.stringify(ruleBasedPlan(nl, state))`를 돌려준다(결정적).
 *
 * store에서 룰 경로를 쓸 땐 이 어댑터보다 `ruleBasedPlan`을 직접 호출하는 편이 명확하다.
 *
 * @param nl    고정할 한국어 지시.
 * @param state 플랜 합성에 쓸 편집 상태.
 * @returns prompt를 무시하고 룰 플랜 JSON 문자열을 resolve하는 provider 함수.
 */
export function rulePlanProvider(
  nl: string,
  state: EditorState,
): (prompt: string) => Promise<string> {
  const json = JSON.stringify(ruleBasedPlan(nl, state));
  return (_prompt: string) => Promise.resolve(json);
}

/**
 * `rulePlanProvider`의 별칭(시그니처 동일). CLAUDE.md에서 언급한 `ruleProvider` 이름으로도
 * 노출해 두어 호출부가 어느 쪽 이름을 쓰든 동작하도록 한다.
 */
export const ruleProvider = rulePlanProvider;
