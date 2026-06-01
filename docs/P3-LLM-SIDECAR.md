# P3 — 로컬 LLM 플래너 사이드카 (`@dawn-cut/sidecar-llm`) 설계

> dawn-cut의 '자연어 → 편집 명령(EditCommand)' 플래너에 **자유형 자연어** 경로를 더하는,
> 100% 로컬·오프라인 Node 전용 사이드카. llama.cpp(`llama-cli`)를 subprocess로 one-shot
> 호출하고, 출력은 core의 GBNF(`plannerGrammar()`)로 디코딩 단계에서 구조 제약한다.
>
> 이 문서의 모든 실행 사실(바이너리·모델·인자·지연·ChatML 필요성)은 실제 `llama-cli` + Qwen2.5-1.5B로
> 검증한 결과다. 추측 없음.

---

## 1. 아키텍처 흐름

dawn-cut에는 이미 '제안 → 미리보기 → 승인 → command bus + 감사로그' 파이프라인이 있다
(P1 키스톤: 사람 GUI든 AI 에이전트든 **동일한** `applyCommand` command bus를 구동한다).
P3는 이 파이프라인의 맨 앞단, 즉 '자연어 → EditCommand[]를 만드는 **플래너**'에
LLM 경로 하나를 추가한다. 나머지(미리보기/승인/적용/감사)는 그대로 재사용한다.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ renderer (packages/ui)                                                         │
│   useEditor store: planAndPreview(input)                                       │
│     ├─ isLlmAvailable() 질의 → 사용 가능?                                       │
│     │     예 → IPC 'llm:plan'  ─────────────────┐                              │
│     │     아니오 → ruleBasedPlan(nl, state) (in-renderer, 동기·결정적)          │
│     └─ 어느 경로든 결과는 EditCommand[]                                          │
└───────────────────────────────────────────────┼──────────────────────────────┘
                       IPC (preload 화이트리스트) │ llm:available / llm:plan
┌───────────────────────────────────────────────┼──────────────────────────────┐
│ main process (apps/desktop)                     ▼                              │
│   ipcMain.handle('llm:available') → isLlmAvailable(): LlmStatus                 │
│   ipcMain.handle('llm:plan', {nl, summary?}) →                                 │
│        @dawn-cut/sidecar-llm.llmPlanProvider(prompt)                           │
└───────────────────────────────────────────────┼──────────────────────────────┘
                                                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ @dawn-cut/sidecar-llm  (sidecar/llm/src/index.ts, Node-only)                   │
│   prompt(core buildPlanPrompt 산출물)                                           │
│     → ★ ChatML 래핑 → 임시 promptfile                                            │
│     → plannerGrammar() GBNF → 임시 grammarfile                                  │
│     → execFile('llama-cli', [-m … -f … --grammar-file … -no-cnv …])            │
│     → stdout(raw) → cleanLlmOutput() → { text, ms }                             │
└───────────────────────────────────────────────┼──────────────────────────────┘
                                                  ▼  raw text (제약된 JSON 배열)
┌──────────────────────────────────────────────────────────────────────────────┐
│ @dawn-cut/core  (순수 TS, electron/fs/child_process import 금지)                │
│   parsePlan(text)        → { plan: EditCommand[], errors[] } (Zod 2차 검증)     │
│   dryRunCommands(state, plan) → DryRunReport (상태 불변, 원자적 롤백)            │
└───────────────────────────────────────────────┼──────────────────────────────┘
                                                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ renderer store                                                                 │
│   set({ pendingPlan: {input, commands}, planReport })  ← 승인 대기(상태 불변)   │
│   미리보기 카드: "프로그램 -1.2s, cue 3→2" 같은 diff를 사람이 본다              │
│      ├─ approvePlan() ← 유일한 상태변경 지점                                     │
│      │     for cmd: applyCommand(st, cmd) → appendAudit(log, cmd, removedUs)    │
│      │     (command bus + append-only 해시체인 감사로그)                         │
│      └─ rejectPlan() ← 버림(상태 불변)                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

핵심 불변식(P1에서 이어짐, P3가 깨지 않음):
- **상태 변경 지점은 단 하나** — `approvePlan()`. 플래너(룰이든 LLM이든)는 *제안*만 한다.
- 사이드카는 'prompt → raw text'만 책임진다. JSON 추출/의미검증/미리보기/적용/감사는
  전부 core·store가 한다. 사이드카는 모델 결과를 신뢰하지 않는 **얇은 어댑터**다.
- core는 `electron`/`fs`/`child_process`를 import하지 않는다(dependency-cruiser 강제).
  subprocess·임시파일·env 같은 Node IO는 전부 사이드카 경계 안에 격리된다.

---

## 2. LLM 없으면 룰 플래너로 graceful fallback

### 설계
`store.planAndPreview()`는 두 갈래를 갖는다.
1. **LLM 경로** — `isLlmAvailable().available === true`이면 IPC `llm:plan`으로
   사이드카에 위임 → `llmPlanProvider` → `core.parsePlan`.
2. **룰 경로(폴백)** — 사용 불가(바이너리/모델 없음·실행 실패·timeout·비정상 종료)거나
   LLM 결과가 빈 배열이면 `core.ruleBasedPlan(nl, state)`로 처리. 이건 모델 없이
   **지금 당장 동작하는** 결정적 한국어 룰 매처다(현재 store가 기본으로 쓰는 경로).

두 경로 모두 출력이 `EditCommand[]`이고, 이후 단계(`dryRunCommands` → 미리보기 →
`approvePlan`)가 동일하므로 UI/감사 흐름은 분기와 무관하게 한 가지다.

### 왜 폴백이 필수인가
- **항상 동작(no hard dependency)** — 모델은 ~1.0GB, 빌드는 무겁다. `setup-llm.sh`는
  *옵션*이다. 셋업을 안 했거나 저사양 기기여도 "말버릇 빼줘", "시네마틱하게" 같은
  핵심 의도는 룰 플래너로 즉시 처리된다. 기능이 '없어지지' 않고 '덜 똑똑해질' 뿐이다.
- **오프라인·프라이버시** — dawn-cut의 정체성은 100% 로컬이다. 룰 경로는 네트워크·외부
  추론 0이고, LLM 경로도 로컬 subprocess라 어느 쪽이든 미디어/대본이 기기를 떠나지 않는다.
  폴백이 있으면 "LLM을 쓰기 싫다"는 사용자도 똑같은 NL UX를 누린다.
- **안전 경계 일치** — `ruleBasedPlan`과 `plannerGrammar`는 **같은 verb 화이트리스트**
  (removeFillers/applyGlossary/setSubtitleStyle/replaceSubtitleStyle/applyColorgrade)를
  공유한다(`core.PLANNER_VERBS`). 두 경로 어느 쪽도 좌표·ID가 필요한 위험 verb를 만들 수
  없으므로, 폴백이 일어나도 안전 모델이 흔들리지 않는다.
- **결정성 백스톱** — 1.5B가 무의미/모호 입력에 흔들릴 때, 룰 경로는 "확신 없으면 빈 배열"
  원칙으로 환각을 만들지 않는다(§5 참조).

---

## 3. 모델 — Qwen2.5-1.5B-Instruct Q4_K_M

| 항목 | 값 |
|---|---|
| 모델 | Qwen2.5-1.5B-Instruct, GGUF Q4_K_M 양자화 |
| 크기 | 약 1.0GB (`qwen2.5-1.5b-instruct-q4_k_m.gguf`) |
| 라이선스 | Apache-2.0 (재배포·상업 이용 자유 → 오픈소스 dawn-cut에 적합) |
| 가속 | Apple Silicon Metal offload(`-ngl 99`), Accelerate |

**선정 이유**
- **한국어 + GBNF에 충분** — Qwen2.5는 다국어(한국어 포함) instruct 튜닝이 양호하고,
  GBNF 제약 디코딩과 결합하면 "시네마틱하게 → applyColorgrade(cinematic)",
  "말버릇 빼줘 → removeFillers", 복합요청 → applyColorgrade+replaceSubtitleStyle 같은
  핵심 의도 매핑이 안정적으로 나온다(검증 완료).
- **가볍다** — 1.5B/Q4_K_M는 노트북에서 콜드 ~9s, 메모리 부담이 작아 '로컬 우선'에 맞는다.
- **Apache-2.0** — 모델 가중치 재배포에 라이선스 마찰이 없다.

**업그레이드 경로 (Qwen2.5-3B)**
더 정확한 의도 분해가 필요하면 동일 패밀리 3B로 교체한다. 코드 변경 없이 env만 오버라이드:
`DAWN_LLM_MODEL_URL`/`DAWN_LLM_MODEL_PATH`를 3B GGUF로 지정하면 `setup-llm.sh`가 받고
사이드카가 그대로 로드한다. 인자·문법·ChatML 래핑은 동일(같은 Qwen ChatML 포맷).

---

## 4. 검증된 실행 사실 (실제 `llama-cli` + Qwen2.5-1.5B 실행으로 확인)

### 4.1 바이너리·모델·인자
- 바이너리: `vendor/llama.cpp/build/bin/llama-cli` (env `DAWN_LLAMA_BIN`로 오버라이드)
- 모델: `vendor/llama.cpp/models/qwen2.5-1.5b-instruct-q4_k_m.gguf`
  (env `DAWN_LLM_MODEL_PATH`로 오버라이드)
- 동작이 검증된 정확한 인자(전부 llama.cpp `b4589`에 존재):

```
llama-cli \
  -m <model> -f <promptfile> --grammar-file <grammarfile> \
  -n <maxTokens|256> -c 4096 --temp <temperature|0.2> \
  -ngl 99 -no-cnv --no-display-prompt --simple-io
```

| 플래그 | 의미 |
|---|---|
| `-m` | 모델 경로 |
| `-f` | 프롬프트 **파일**(ChatML 래핑된 텍스트). stdin 대신 파일로 안전 전달 |
| `--grammar-file` | GBNF 파일(`plannerGrammar()` 기본). 디코딩 토큰을 구조 제약 |
| `-n 256` | 최대 생성 토큰(플랜 배열은 짧다) |
| `-c 4096` | 컨텍스트 길이(프롬프트의 도구 스키마 + 상태 요약 수용) |
| `--temp 0.2` | 낮은 온도 → 결정성 높임(플랜은 창작이 아니다) |
| `-ngl 99` | 전 레이어 Metal offload(Apple Silicon 가속) |
| `-no-cnv` | 대화(chat) 모드 끔 — one-shot 추론 |
| `--no-display-prompt` | 프롬프트 에코 끔(stdout을 깨끗한 완성 텍스트로) |
| `--simple-io` | subprocess 친화 IO |

`llama-cli`는 **완성 텍스트를 stdout**, 타이밍/배너를 **stderr**로 분리한다 → 사이드카는
stdout만 캡처한다. `execFile`(`promisify`) + `maxBuffer ≥ 16MB`(기존 stt/ffmpeg 사이드카
관례 미러).

### 4.2 ★ ChatML 래핑은 필수
Qwen2.5는 **instruct(챗) 모델**이다. core의 raw 프롬프트를 그대로 넣으면 모델이
대화 컨텍스트를 인식하지 못해 거의 항상 **빈 배열 `[]`** 만 낸다(검증 완료).
사이드카는 promptfile에 다음 형태로 감싸 쓴다:

```
<|im_start|>user
<core가 buildPlanPrompt로 만든 prompt 전문>
<|im_end|>
<|im_start|>assistant
```

이 래핑이 있어야 "시네마틱하게"→applyColorgrade, "말버릇 빼줘"→removeFillers,
복합요청→applyColorgrade+replaceSubtitleStyle 가 제대로 나온다. (3B로 올려도 동일 포맷.)

### 4.3 plannerGrammar로 환각 구조적 봉쇄
사이드카 기본 grammar는 `commandGrammar()`(전체 9 verb)가 **아니라**
`plannerGrammar()`(안전 5 verb 부분집합)다. 이중 방어:
- **금지 verb 차단** — deleteWordRange/removeSilences/cutSourceRange/applyZoom는 문법에
  아예 없다 → 모델이 토큰으로도 생성할 수 없다(좌표·ID가 NL에 없어 환각 위험).
- **clipId 환각 차단** — 모델에게 주는 상태 요약에는 clipId가 없다. 그래서 문법에서
  applyColorgrade의 clipId를 제거 → '있지도 않은 클립 지목 후 조용한 no-op'을 봉쇄.
  clipId 생략 시 전체 영상에 적용된다.
- GBNF는 **구조만** 보장한다. 의미(비음수·열린구간·사전값 등)는 core `parsePlan`의
  Zod(`safeParseEditCommand`)가 최종 검증한다 → 디코딩 제약 + 의미 검증 2중 게이트.

> 주의(grammar.ts 실측): llama.cpp GBNF 파서는 최상위 규칙 본문의 줄바꿈을 규칙 종료로
> 본다. 모든 규칙은 한 줄로 적어야 하며, 어기면 `error parsing grammar: expecting name`으로
> 문법 로드가 통째로 실패한다. core의 `plannerGrammar()`가 이미 이 형식을 지킨다.

### 4.4 출력 형태와 지연
- 출력(검증): 깔끔한 JSON 배열 뒤에 보통 ` [end of text]`가 붙는다. 예:
  `[{"type":"applyColorgrade","preset":"cinematic","intensity":0.7}] [end of text]`
- `cleanLlmOutput(raw)`(순수·단위테스트 대상)가 trim + 종료 마커(`[end of text]`, `</s>`)
  제거만 한다. JSON 배열 추출은 core `parsePlan`(산문 잡음 대괄호도 건너뜀)이 담당하므로
  코드펜스 제거는 불필요 — 보수적으로 둔다.
- **지연**: 콜드 ~9s (모델 로드 ~7.7s + 평가 ~1.6s). 그래서 사이드카 timeout 기본은
  넉넉히 **120000ms**. timeout 초과 시 kill + 명확한 Error, 비정상 종료도 Error
  → 호출측(store)이 룰 경로로 폴백.

**업그레이드 경로: `llama-server` 상주**
MVP는 매 호출 모델을 다시 로드하는 one-shot CLI다(콜드 ~9s의 주범은 로드 ~7.7s).
`llama-server`를 백그라운드 상주시키면 로드가 1회로 끝나 후속 호출이 평가시간(~1.6s)
수준으로 떨어진다. 사이드카 공개 API(`isLlmAvailable`/`llmComplete`/`llmPlanProvider`)는
그대로 두고 내부 전송만 CLI→HTTP로 바꾸는 경로로 문서화한다.

---

## 5. 알려진 한계 — 그래서 '제안 → 사용자 승인' 카드가 핵심 안전장치

1.5B는 작다. **무의미·잡담 입력에도 가끔 명령을 과잉 생성한다**(예: "오늘 점심 뭐 먹지"에
applyColorgrade를 뱉는 식). GBNF는 *구조*만 막을 뿐 *의도 없음*을 판별하지 못하고,
Zod도 *형식상 유효한* 명령은 통과시킨다.

이 한계를 시스템이 흡수하는 방식이 **'제안 → 미리보기 카드 → 사람 승인'** 이다.
- 플래너 출력은 절대 자동 적용되지 않는다. `store`는 `pendingPlan` + `planReport`(dryRun
  diff)만 세팅하고 **상태는 그대로** 둔다.
- 사용자는 카드에서 "무엇이 어떻게 바뀌는지"(프로그램 길이 변화·cue 개수 변화)를 보고
  `approvePlan()`(적용) 또는 `rejectPlan()`(버림)을 고른다.
- 잘못된/엉뚱한 제안은 사람이 거른다. 즉 모델 품질의 마지막 방어선은 **사람**이고,
  1.5B의 과잉생성은 '잘못 적용'이 아니라 '승인 거절'로 끝난다.

추가 완충: 빈 배열/모호 입력은 룰 경로 폴백(§2)이 "이해하지 못한 명령입니다"로 안내한다.

---

## 6. 환경 / 셋업 / 로컬성

### 환경변수 (기존 `DAWN_WHISPER_BIN`/`DAWN_WHISPER_MODEL_PATH` 명명 미러)
| 변수 | 기본값 |
|---|---|
| `DAWN_LLAMA_BIN` | `vendor/llama.cpp/build/bin/llama-cli` |
| `DAWN_LLM_MODEL_PATH` | `vendor/llama.cpp/models/qwen2.5-1.5b-instruct-q4_k_m.gguf` |
| `DAWN_LLM_MODEL_URL` | (setup만) 모델 다운로드 URL — 3B 등으로 오버라이드 |
| `DAWN_LLAMA_REPO` / `DAWN_LLAMA_REF` | (setup만) 빌드 리포/핀(`b4589`) |

`isLlmAvailable()`는 동기 `existsSync`로 bin(파일 존재) + model(존재 + 크기 > 100MB)을
확인하고, 없으면 `available:false` + 한국어 `reason`('llama-cli 없음: …' / '모델 없음: …')을
**throw 없이** 돌려준다 → store가 안전히 룰 경로로 분기.

### `scripts/setup-llm.sh` (옵션·멱등)
1. llama.cpp 클론(핀 `b4589`) + cmake 빌드(Metal/Accelerate 자동) → `llama-cli`
2. Qwen2.5-1.5B-Instruct Q4_K_M GGUF 다운로드(~1.0GB) → models/
   (이미 있으면 둘 다 건너뜀). 끝에 검증용 one-shot 명령을 안내한다.

이 스크립트는 '자유형 NL → LLM 플랜'을 켜고 싶을 때만 실행한다. 안 돌려도 dawn-cut은
룰 플래너로 동작한다(§2).

### 100% 로컬
모델 로드·추론·임시 prompt/grammar 파일 쓰기·정리 모두 기기 안에서 일어난다. 외부 추론
API·텔레메트리 0. 미디어·대본·편집 의도가 기기를 떠나지 않는다 → 프라이버시·오프라인 보장.

---

## 7. 비전 연결 — P3는 P4(MCP)의 디딤돌

dawn-cut의 비전은 '자연어로 AI가 command bus를 통해 dawn-cut을 조작'하는 것이다.

- **P3가 증명하는 것**: 자유형 자연어가 `PlanProvider` 인터페이스 하나로 안전하게
  EditCommand[]가 되고, GBNF+Zod 이중 게이트와 dryRun+승인 카드가 그 흐름을 **안전하게**
  만든다는 것. 즉 '외부 지능 → 제약된 도구 호출 → 사람 승인 → 감사로그'의 전 구간을
  로컬 LLM으로 한 번 닫아 본다.
- **P4로의 확장**: P3에서 '플래너 ↔ command bus' 사이가 이미 `PlanProvider` /
  `commandManifest()`(MCP tool 표면과 1:1) / `commandGrammar()`(전체 9 verb)로 정돈돼
  있으므로, P4는 사이드카 자리에 **MCP 서버**를 끼우기만 하면 된다. 외부 AI(Claude 등)가
  dawn-cut의 EditCommand를 MCP **tool**로 호출하고, 같은 dryRun→승인→감사 파이프라인을
  공유한다. plannerGrammar(안전 부분집합)는 자율 에이전트용, commandGrammar(전체 표면)는
  좌표·ID를 가진 컨텍스트용으로 자연스럽게 갈린다.
- 요컨대 P3는 "LLM을 dawn-cut에 안전하게 꽂는 어댑터 패턴"을 로컬에서 먼저 확정하고,
  P4는 그 어댑터의 전송 계층만 MCP로 바꾼다.

---

## 부록 A — 사이드카 공개 API 요약 (`sidecar/llm/src/index.ts`)

| 심볼 | 시그니처 / 역할 |
|---|---|
| `LlmStatus` | `{ available; binPath; modelPath; reason? }` |
| `isLlmAvailable()` | 동기 존재 확인. 없으면 `available:false` + 한국어 reason. throw 금지 |
| `LlmCompleteOpts` | `{ maxTokens?; timeoutMs?; grammar?; temperature? }` |
| `llmComplete(prompt, opts?)` | ChatML 래핑 + GBNF로 `llama-cli` 호출 → `{ text, ms }`. ms는 `performance.now()` 차이. 임시파일 정리 |
| `cleanLlmOutput(raw)` | 순수. trim + `[end of text]`/`</s>` 종료 마커 제거 |
| `llmPlanProvider` | `core.PlanProvider`. `(prompt) => llmComplete(prompt).then(r => r.text)`. 기본 grammar = `plannerGrammar()` |

테스트 계층: 콜로케이트 단위(`sidecar/llm/src/index.test.ts`, subprocess 금지·순수만 —
`isLlmAvailable`/`cleanLlmOutput`) + 통합(`tests/integration/llm-sidecar.test.ts`,
가짜 `llama-cli` 스크립트로 빠르게 — `llmComplete` 파싱 + core `planAndPreview` end-to-end).

---

## 목차 요약
1. 아키텍처 흐름 — renderer store → IPC(llm:available/llm:plan) → main → 사이드카 →
   llama-cli + ChatML + plannerGrammar(GBNF) → raw text → core parsePlan → dryRunCommands →
   미리보기 카드 → 승인 → command bus + 감사로그
2. LLM 없으면 룰 플래너로 graceful fallback(항상 동작·오프라인·프라이버시·안전 경계 일치)
3. 모델 — Qwen2.5-1.5B-Instruct Q4_K_M(~1.0GB, Apache-2.0)과 3B 업그레이드 경로
4. 검증된 실행 사실 — 정확한 llama-cli 인자, ChatML 래핑 필수, plannerGrammar 환각 봉쇄,
   콜드 ~9s 지연 + llama-server 상주 업그레이드
5. 알려진 한계 — 1.5B 과잉생성 → '제안→승인' 카드로 사람이 거름(핵심 안전장치)
6. 환경변수(DAWN_LLAMA_BIN/DAWN_LLM_MODEL_PATH) + scripts/setup-llm.sh + 100% 로컬
7. 비전 연결 — P3가 P4(MCP 서버로 외부 AI가 dawn-cut을 tool로 조작)의 디딤돌인 이유
부록 A — 사이드카 공개 API 요약
