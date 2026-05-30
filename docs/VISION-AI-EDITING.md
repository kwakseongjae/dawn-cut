# VISION: 자연어로 AI가 전문 편집가처럼 dawn-cut을 조작한다

> **한 줄 비전**
> "영상이 내 노트북을 떠나지 않는다. 계정·워터마크·구독 없이, 자연어로 말하면 AI가 컷·자막·줌·색보정을 직접 편집한다 — 그리고 제안한 편집(타임라인/EDL)을 눈으로 확인하고 렌더한다."
>
> The only open-source video editor where the AI edits *for* you — and your footage never leaves your machine.

이 문서는 "AI가 자연어로 dawn-cut을 조작한다"는 비전의 **구체적 아키텍처**를 정의한다. 추상적 선언이 아니라, 현재 코드베이스(`packages/core`, `EDL`)에서 출발해 어떤 계층을 어떤 순서로 쌓아야 하는지의 설계도다.

핵심 설계 철학은 선행 사례 전체가 수렴하는 한 문장으로 요약된다:

> **LLM은 검증 가능한 "편집 결정 문서(EditCommand)"를 생성하고, 결정적 코어가 그것을 렌더한다.**
> (LLM emits a structured edit-decision document; a deterministic engine renders it.)

이는 MCP, OTIO, LAVE, Descript이 모두 채택한 형태다 — "LLM이 픽셀을 생성한다"가 아니라 "LLM이 구조화된 편집 명령을 생성하고, 결정적 엔진이 그것을 실행한다"는 **언어 계층과 실행 계층의 분리**다.

---

## 0. 왜 dawn-cut인가 — 출발점의 강점

대부분의 NLE는 AI 제어를 "나중에 붙이는 기능"으로 다루지만, dawn-cut의 코어(`packages/core/src`)는 **이미 tool-call 백엔드의 비기능 요건을 70% 충족**하고 있다.

| 요건 (AI tool 제어에 필요) | dawn-cut 현황 | 근거 파일 |
|---|---|---|
| **순수성/격리** (헤드리스 실행, 부작용 없음) | `packages/core`가 `fs`/`child_process`/`electron` import 금지 (dependency-cruiser 강제). ffmpeg는 sidecar subprocess로만 호출 | `core/src/index.ts:1-2` |
| **결정성** (재현 가능) | 모든 시간이 정수 µs · `[start,end)` 반정밀 구간. command가 `structuredClone`으로 입력 불변 | `core/src/types.ts`, `commands.ts:5-8` |
| **검증성** (AI 출력 자동 검증) | 전 모델에 `validate*()` 불변식: `validateTimeline`(TL-INV), `validateSync`(SYNC-INV), `validateEdl`(EDL-INV) | `timeline.ts`, `sync.ts:56`, `edl.ts:19` |
| **되돌리기** (dry-run/undo 기반) | command가 `CommandResult{before,after,removedProgramUs}` 반환. `undo()`가 `before` 복원 | `commands.ts:109-144` |
| **결정적 중간표현(IR)** | `timelineToEdl()`이 timeline을 contiguous·ascending 세그먼트로 환원 → edit/export 분리 | `edl.ts:8-17` |
| **텍스트↔타임라인 좌표계** | `wordToProgram`/`programToWord`/`liveWords` 양방향 매핑 + 라운드트립 불변식 | `sync.ts:9-54` |

**즉, 엔진의 크랭크샤프트(결정적 코어)는 정밀하게 깎여 있다.** 아직 달려 있지 않은 것은 **운전대(command bus)**와 **변속기(멀티트랙 모델)**다.

### 메워야 할 격차 (현재 ≈ 0%)

1. **EditCommand 디스패처 부재** — `types.ts:105`의 `EditCommand` 유니언은 `deleteWordRange`·`removeSilences` **2종만** 선언돼 있고, 이를 받아 적용하는 `applyCommand` 디스패처가 코드베이스 어디에도 없다. "직렬화된 명령 → 결정적 적용"이라는 tool-call의 핵심 계약이 비어 있다.
2. **편집 동작이 UI에 흩어짐** — 오버레이 add/update/keyframe, 자막 스타일·per-cue, glossary, filler 제거, TTS가 `packages/ui/src/store.ts`의 명령형 Zustand 액션과 60K줄 `index.tsx`에 있어 **헤드리스 호출 단위가 없다**.
3. **command 어휘 빈약** — core의 실제 변환 command는 `cutSourceRange`/`deleteWordRange`/`removeSilences` **3종뿐**. 자막·줌·색보정·사운드·전환 동사 부재.
4. **단일 트랙·단일 소스 하드코딩** — `rebuildGapless`가 항상 단일 video track을 0부터 gapless 재구성. `timelineToEdl(timeline, mediaPath)`가 `mediaPath` **단수**. 멀티트랙/B-roll/PIP 표현 불가.
5. **줌/색보정/전환은 UI 스텁** — 렌더 파이프라인 전무.

---

## 1. ① 편집 Command 어휘 표준화 (키스톤)

### 1.1 원칙 — 닫힌 discriminated union + 단일 디스패처

`types.ts:105`의 `EditCommand`를 **모든 편집 동사를 담는 닫힌 discriminated union**으로 확장하고, core에 단일 진입점을 신설한다:

```ts
// packages/core/src/state.ts (신설)
export interface EditorState {
  timeline: TimelineModel;        // 이미 존재
  transcript: TranscriptModel;    // 이미 존재
  overlays: OverlayClip[];        // store.ts → core로 이전
  subtitleStyle: SubtitleStyle;   // store.ts → core로 이전
  glossary: GlossaryPair[];       // store.ts → core로 이전
}

// packages/core/src/apply.ts (신설 — 모든 tool 호출이 수렴하는 단일 경로)
export function applyCommand(state: EditorState, cmd: EditCommand): CommandResult {
  // 1. Zod safeParse (경계 가드)
  // 2. type별 순수 reducer 라우팅
  // 3. validate*() post-condition 게이트
  // 4. CommandResult{before, after, removedProgramUs} 반환
}
```

`EditorState`로 정의해 `store.ts`/`index.tsx`에 흩어진 상태를 core로 끌어올린다. **사람 GUI와 AI 에이전트가 정확히 같은 command bus를 구동**하게 만드는 것이 핵심이다.

> **기존 자산 재사용:** `commands.ts`의 3종은 이미 `{before, after}` 형태의 `CommandResult`를 돌려주므로 reducer로 **그대로 흡수**한다 — 재작성 불필요. 시그니처만 `applyCommand`가 라우팅하도록 맞춘다.

### 1.2 동사 그룹 (편집 어휘 전체)

```
CUT         { deleteWordRange, removeSilences, cutSourceRange, removeFillers, trimToRange }
SUBTITLE    { setSubtitleStyle, applyPreset, editCue, splitCue }
OVERLAY     { addOverlay, updateOverlay, removeOverlay, clearOverlaysByKind, addKeyframe }
EMPHASIS    { highlightKeyword, punchInZoom }
COLOR       { applyColorPreset, applyLUT }
AUDIO       { normalize, duck, addBgm }
TEXT        { applyGlossary }
GENERATIVE* { generateVoiceover, addBroll }   ← 부작용 격리·content-addressed 캐시
```

`*` GENERATIVE는 **비결정적·부작용** 클래스로 격리한다 (§1.5 참조).

### 1.3 JSON 스키마 tool 목록 예시

각 동사는 직렬화 가능한 JSON 명령으로 표현된다. 아래가 LLM이 생성하고 MCP `tools/list`가 노출하는 실제 형태다 (Zod에서 `z.toJSONSchema()`로 파생):

```jsonc
// CUT — 단어 범위 삭제 (텍스트 기반 편집의 핵심)
{
  "type": "deleteWordRange",
  "fromWordId": "w_0142",
  "toWordId": "w_0157"
}

// CUT — 무음 자동 제거 (멱등 아님 — 적용마다 program 단축)
{
  "type": "removeSilences",
  "minSilenceUs": 700000,   // 0.7s 이상 무음만
  "padUs": 80000            // 양쪽 0.08s 보존
}

// CUT — 필러 제거 ("음", "어", "그", "uh", "like")
{
  "type": "removeFillers",
  "fillers": ["음", "어", "그"],
  "lang": "ko"
}

// EMPHASIS — 키워드 강조 자막 (ROI top1, 어절/per-cue 이미 보유)
{
  "type": "highlightKeyword",
  "keywords": ["dawn-cut", "로컬", "프라이버시"],
  "style": { "color": "#FFE600", "scale": 1.15, "bold": true }
}

// EMPHASIS — 펀치인 줌 (타이밍 동기 시각 강조)
{
  "type": "punchInZoom",
  "startUs": 12400000,
  "endUs": 15800000,
  "scale": 1.25,
  "anchor": { "x": 0.5, "y": 0.4 },
  "easing": "easeInOut"
}

// SUBTITLE — 자막 스타일 전체 적용
{
  "type": "setSubtitleStyle",
  "fontFamily": "Pretendard",
  "fontSizePx": 48,
  "fill": "#FFFFFF",
  "stroke": "#000000",
  "position": "bottom-center"
}

// SUBTITLE — 단일 cue 편집 (per-cue)
{
  "type": "editCue",
  "cueId": "c_021",
  "text": "여기를 강조합니다",
  "startUs": 8100000,
  "endUs": 9400000
}

// OVERLAY — 이미지/스티커/GIF/영상 오버레이 추가
{
  "type": "addOverlay",
  "kind": "image",
  "src": "asset://logo.png",
  "startUs": 0,
  "endUs": 3000000,
  "transform": { "x": 0.85, "y": 0.1, "scale": 0.2, "rotation": 0 },
  "blend": "normal"
}

// OVERLAY — 키프레임 추가 (애니메이션)
{
  "type": "addKeyframe",
  "overlayId": "ov_07",
  "u": 0.5,
  "x": 0.5, "y": 0.5, "scale": 1.3,
  "easing": "easeOut"
}

// COLOR — 원클릭 색보정 프리셋
{
  "type": "applyColorPreset",
  "preset": "cinematic-teal-orange",
  "intensity": 0.8,
  "scope": { "fromUs": 0, "toUs": null }   // null = 전체
}

// AUDIO — 노멀라이즈 / 덕킹 / BGM
{
  "type": "duck",
  "trackId": "music",
  "underTrackId": "voice",
  "reductionDb": -12,
  "attackMs": 120,
  "releaseMs": 400
}

// TEXT — 사전 치환 (glossary)
{
  "type": "applyGlossary",
  "pairs": [{ "from": "돈컷", "to": "dawn-cut" }]
}

// GENERATIVE — TTS 보이스오버 (비결정적·자산 생성·캐시됨)
{
  "type": "generateVoiceover",
  "text": "안녕하세요, dawn-cut입니다",
  "voice": "ko-female-1",
  "placeAtUs": 0
}
```

### 1.4 tool annotation (MCP 힌트)

각 동사에 **읽기전용 / 파괴적 / 멱등 / 비결정적** 힌트를 단다 (MCP 도구 위생 패턴):

| 동사 | read-only | destructive | idempotent | non-deterministic |
|---|:--:|:--:|:--:|:--:|
| `deleteWordRange` | | ✓ | ✓ (같은 범위 재삭제=동일) | |
| `removeSilences` | | ✓ | ✗ (적용마다 단축) | |
| `setSubtitleStyle` | | | ✓ ("X를 값 Y로 설정") | |
| `addOverlay` | | | ✗ ("항목 추가") | |
| `punchInZoom` | | | ✓ | |
| `generateVoiceover` | | | ✗ | ✓ |
| `findWords` (selector) | ✓ | | ✓ | |

> 멱등성은 MCP가 강제하지 않으므로 클라이언트(에이전트 루프) 책임이다. 비결정적 동사는 명시적으로 표시해 dry-run/캐시로 격리한다.

### 1.5 GENERATIVE 격리 (Runway/Firefly 교훈)

생성형 도구(TTS, 미래의 B-roll/이미지 생성)는 **별도의 비결정적·부작용·자산 생성 tool 클래스**로 격리한다:

- 생성 도구는 **파일(PNG/WAV)을 산출**하고, 그 파일을 **참조하는 결정적 `addOverlay` command**를 반환한다.
- 캐시는 `hash(prompt + params) → output path`로 content-addressed → **replay 시 결정성 복원**.
- 편집 IR(EDL)에는 결정적 참조만 남고, 확률적 생성이 replayable 코어를 오염시키지 않는다.

> Firefly의 'Prompt to Edit'("왼쪽 사람 제거")는 생성형 재렌더(비결정적)다. 편집 의도("필러 제거", "키워드 강조", "펀치인 줌")는 결정적 파라미터 연산으로 표현 가능하므로, 이 둘을 **구조적으로 분리**한다.

---

## 2. ② 코어 Tool API 레이어 (순수 TS · 결정적 · dry-run/검증)

### 2.1 Zod를 command별 단일 진실원천(SSOT)으로

각 동사마다 **Zod 스키마 1개**를 작성하고, 거기서 세 가지를 파생한다:

```ts
// packages/core/src/schema/highlightKeyword.ts
import { z } from 'zod';

export const HighlightKeyword = z.object({
  type: z.literal('highlightKeyword'),
  keywords: z.array(z.string().min(1)).min(1),
  style: z.object({
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    scale: z.number().min(0.5).max(3).default(1.15),
    bold: z.boolean().default(true),
  }),
});

// (a) core reducer가 쓰는 TS 타입
export type HighlightKeyword = z.infer<typeof HighlightKeyword>;

// (b) command 경계의 런타임 가드 (granular ZodError를 에이전트에 피드백)
export function parseCommand(raw: unknown) {
  return EditCommandSchema.safeParse(raw); // discriminated union safeParse
}

// (c) tool/MCP 매니페스트 (z.toJSONSchema로 파생 — 드리프트 0)
export const HighlightKeywordJsonSchema = z.toJSONSchema(HighlightKeyword);
```

이 한 소스에서 **core 타입 + 검증 가드 + JSON 스키마**가 모두 나오므로 core/GUI/agent/MCP 간 **스키마 드리프트가 0**이다. Zod는 순수 TS라 `dependency-cruiser`를 통과한다.

### 2.2 결정적 적용 + post-condition 게이트

`applyCommand`는 **적용 직후** 기존 불변식 체커를 자동 post-condition으로 호출한다:

```ts
export function applyCommand(state: EditorState, cmd: EditCommand): CommandResult {
  const parsed = parseCommand(cmd);
  if (!parsed.success) throw new CommandError(parsed.error); // → 에이전트 re-plan 트리거

  const before = structuredClone(state);
  const after = REDUCERS[cmd.type](before, parsed.data);  // 순수 reducer

  // post-condition 게이트: 불변식 위반 시 reject/rollback
  const errs = [
    ...validateTimeline(after.timeline),
    ...validateSync(after.timeline, after.transcript),
    ...validateEdl(timelineToEdl(after.timeline, /*…*/), after.timeline),
    ...validateOverlays(after.overlays),
    ...validateCues(/*…*/),
  ];
  if (errs.length) return rollback(before, errs); // 깨진 편집은 commit 안 함

  return { before, after, removedProgramUs: durDelta(before, after) };
}
```

**이것이 dawn-cut의 해자다.** AI가 만든 편집을 "유효한가"로 자동 검증하고, 위반 시 거부/롤백한다 — Descript/Runway가 못 주는 검증 가능한 신뢰성.

### 2.3 dry-run / diff / commit 파이프라인

에이전트는 **상태를 직접 변형하지 않는다.** Plan(검증된 EditCommand의 순서 리스트)을 emit하고:

1. **dry-run** — clone된 `EditorState`에 적용, 비커밋
2. **diff 표면** — `removedProgramUs`, 변경 cue 수, before/after 길이, 컷될 단어 목록을 사용자에게 노출
3. **승인** → command bus로 commit · **거부** → clone 폐기

`CommandResult.before` 스냅샷이 곧 dry-run/undo 기반이다. **모든 AI 편집이 검토 가능하고 되돌릴 수 있다** (LAVE가 검증한 승인 게이트 UX).

### 2.4 EDL을 effect-aware IR로 일반화 + OTIO

현재 `timelineToEdl(timeline, mediaPath)`(단일 소스·단일 트랙)를 다음으로 확장한다:

- **멀티트랙·멀티소스** + `Clip`에 `effects[]`(zoom/colorgrade/volume/transform)·`transition` 필드
- **렌더 백엔드는 이 IR만 소비** → 프리뷰=익스포트 일치를 **단일 IR 공유로 구조화**
- **OTIO export 어댑터** 추가 → Premiere/Resolve/FCP 상호운용 + 산업표준 IR화

> OTIO(OpenTimelineIO, ASWF)는 "현대적 EDL"의 산업 표준 — 멀티트랙·전환·효과·마커·per-clip 메타를 담는 application-agnostic 데이터 모델이며, CMX3600/FCPXML/AAF 어댑터 보유. dawn-cut의 현재 EDL은 OTIO가 일반화하는 것의 **얇은 단일 트랙 특수 케이스**다. OTIO가 dawn-cut이 이미 선택한 설계(렌더와 분리된 결정적 IR)를 검증해준다.

---

## 3. ③ MCP 서버 (데스크탑 앱이 노출)

command 레지스트리를 **두 표면으로 동시 노출**하는 얇은 어댑터를 만든다:

- **(a) in-process tool registry** — 번들 로컬 에이전트용
- **(b) MCP 서버** — 외부 에이전트용 (Claude Desktop / Cursor / 커스텀)

### 3.1 MCP 매핑

| MCP 프리미티브 | dawn-cut 구현 |
|---|---|
| `tools/list` | `z.toJSONSchema()` 매니페스트 + annotation(read-only/destructive/idempotent/generative) |
| `tools/call` | Zod `safeParse` 검증 → 실패 시 granular ZodError 반환 → 성공 시 `applyCommand` 디스패치 |
| `resources` (read-only) | 상태 요약 노출: transcript / chapters / silences / 현재 EDL — 외부 에이전트가 plan하도록 |

> MCP는 JSON-RPC 2.0 프로토콜이다. 각 tool이 JSON Schema로 파라미터·타입·제약을 선언하고, 모델이 스키마에 맞는 JSON을 보내면 서버가 검증·실행한다. `tools/list`가 서버를 self-documenting하게 만든다 — dawn-cut의 `z.toJSONSchema()` 매니페스트가 정확히 이 역할을 한다.

### 3.2 Selector tool (자연어 → 핸들)

LLM이 µs 산술을 직접 하지 않도록, 자연어 참조를 구체 핸들로 해소하는 **read-only selector tool**을 추가한다:

```jsonc
// "인트로 부분" → wordId 범위
{ "type": "findWords", "query": "인트로", "limit": 50 }
// → { "ranges": [{ "fromWordId": "w_0001", "toWordId": "w_0042" }] }

// "0.5초 이상 무음" → 구간 리스트
{ "type": "findSilences", "minMs": 500 }
// → { "intervals": [{ "start": 12400000, "end": 13100000 }, …] }
```

이로써 LLM은 µs 좌표가 아니라 **핸들(wordId 범위/구간)로 작업**한다 — LAVE의 retrieval(임베딩 검색) + reasoning 하이브리드 패턴.

### 3.3 컨텍스트 압축 (code-execution 패턴)

전체 전사(수천 단어)를 모델 컨텍스트에 넣지 않는다. **코드 내에서 필터**해 요약만 반환한다:

> Anthropic의 'code execution with MCP' 패턴: tool을 코드 API로 제시하고, 에이전트가 코드로 큰 데이터(전사 단어, 무음 구간)를 **샌드박스 내에서 필터**한 뒤 요약만 모델에 반환한다. 한 워크플로에서 150,000 → 2,000 토큰(98.7% 절감). dawn-cut 전사는 수천 단어일 수 있어, 절대 전부 컨텍스트에 들어가선 안 된다.

상태 요약 = `{ wordCount, silenceCount, durationUs, chapters[] }` — 전체 전사 아님.

---

## 4. ④ 에이전트 루프 (자연어 → plan → tool 호출 → 프리뷰 → 검증 → 수정)

### 4.1 형태 — plan-and-execute + re-plan gate + dry-run 승인

```
사용자 자연어 요청
   │  "인트로 무음 잘라내고, dawn-cut 단어 강조하고, 마지막에 줌인 줘"
   ▼
┌─────────────────────────────────────────────────────────────┐
│ ① PLAN  (Planner LLM)                                        │
│   입력: tool 매니페스트 + 압축 상태요약(전사 아님)            │
│   출력: JSON plan = [검증된 EditCommand, …]                  │
└─────────────────────────────────────────────────────────────┘
   ▼
┌─────────────────────────────────────────────────────────────┐
│ ② VALIDATE  (Zod safeParse, command별)                       │
│   실패 → granular ZodError를 LLM에 피드백 → RE-PLAN ◀────┐   │
└──────────────────────────────────────────────────────────┼──┘
   ▼ 통과                                                   │
┌─────────────────────────────────────────────────────────┼──┐
│ ③ DRY-RUN  (clone된 EditorState에 batch 적용)            │  │
│   diff 산출: removedProgramUs / 변경 cue / before-after  │  │
│   길이 / 컷될 단어 목록                                  │  │
└──────────────────────────────────────────────────────────┼──┘
   ▼                                                        │
┌─────────────────────────────────────────────────────────┼──┐
│ ④ RE-PLAN GATE  (이상치 탐지)                            │  │
│   removeSilences가 program 80% 삭제? trim이 타임라인     │──┘
│   비움? → 일시정지 · 재계획 · 사람에게 에스컬레이션      │
└─────────────────────────────────────────────────────────┘
   ▼ 정상
┌─────────────────────────────────────────────────────────────┐
│ ⑤ 사용자 승인  (LAVE식 — 프리뷰/타임라인/EDL 보여주고)       │
│   승인 → COMMIT (command bus) → audit log 기록               │
│   거부 → clone 폐기                                          │
└─────────────────────────────────────────────────────────────┘
```

> **plan-and-execute는 single-shot을 이긴다**(실제 작업 pass rate 3-5배). 단 치명적 약점은 "tool 출력을 보기 전에 전체 plan에 commit"하는 것. 해결책이 **re-plan gate** — K 스텝마다 또는 이상치 시 플래너에 재질의. 신뢰성을 위해 **reversibility**와 짝짓는다(IBM STRATUS: 모든 액션은 undo 가능, 실패 시 체크포인트 복원). dawn-cut의 `CommandResult.before`가 정확히 이 undo operator다.

### 4.2 append-only 해시체인 audit log

승인된 모든 command를 append-only 해시체인 로그에 기록한다 (`history.ts` 위에). 한 로그가 네 가지를 겸한다:

- **결정적 replay** (세션 재현)
- **undo/redo** (이미 `history.ts` 보유)
- **세션 export** (공유·재현성)
- **감사** (어떤 AI가 무엇을 했는지)

> MCP 보안 위생: 모든 tool 호출을 정확한 파라미터와 함께 append-only 해시체인으로 기록하는 것이 세션 재구성/replay의 backbone이다.

### 4.3 환각·과대주장 방어

LAVE조차 trim 정밀도 1초 한계, "문법적으론 맞으나 사실 틀린" 환각을 보고한다. 따라서:

- **절대 "완전 자율"로 마케팅하지 않는다.** 프레이밍은 항상 "AI가 **제안**, 당신이 EDL/타임라인을 **보고 승인**, 그 다음 **렌더**" — 블랙박스 아님.
- selector tool로 µs 산술을 LLM에서 분리해 정밀도 한계 우회.
- post-condition 불변식 게이트로 형식적으로 깨진 편집은 commit 전에 reject.

---

## 5. ⑤ 로컬 vs 클라우드 LLM — plan 생성 트레이드오프

dawn-cut의 비전(100% 로컬)은 **로컬 LLM 우선**을 강제한다. 그러나 `PlanProvider` 인터페이스로 클라우드를 opt-in drop-in으로 둔다.

### 5.1 비교표

| 축 | 로컬 (llama.cpp + Qwen급) | 클라우드 (GPT/Claude API) |
|---|---|---|
| **프라이버시** | ✅ 영상·전사가 기기를 안 떠남 (비전 핵심) | ❌ 전사/요약이 외부 전송 |
| **비용** | ✅ 무과금·무구독·무크레딧 | ❌ API 과금 |
| **오프라인** | ✅ 완전 오프라인 | ❌ 인터넷 필수 |
| **형식 결정성** | ✅✅ **GBNF/JSON-schema 제약 디코딩** — malformed plan 생성 *불가능* | ⚠️ soft JSON-mode (더 약함) |
| **의미 정확도(복잡 plan)** | ⚠️ Qwen급은 단일 tool 선택은 GPT-4급, 멀티스텝은 모델/VRAM 의존 | ✅ 더 강함 |
| **컨텍스트 한계** | ⚠️ VRAM 초과 시 tool-call 정확도 급락 | ✅ 큰 컨텍스트 |
| **셋업** | ⚠️ 모델 다운로드·sidecar | ✅ API 키만 |

### 5.2 권장: 로컬 우선 + GBNF 제약

```
whisper.cpp (이미 sidecar 패턴) ─── 동일 process-management/IPC 플러밍 재사용 ───▶ llama.cpp sidecar
                                                                                       │
                                  z.toJSONSchema() ──▶ GBNF grammar ──────────────────┤
                                                                                       ▼
                                                              제약 디코딩: 토큰 단위로 스키마 강제
                                                              → malformed plan / 미지의 동사 생성 불가
```

> **로컬 LLM이 이 용도엔 오히려 우월하다** — GBNF 문법 제약 디코딩이 토큰 레벨에서 작동해 "유효하지 않은 JSON 생성이 불가능"하고, JSON Schema를 GBNF로 자동 변환할 수 있다(Ollama v0.5+). 2025 현장 비교: llama.cpp가 "멀티스텝 함수 호출, 구조화 출력, 추론 트레이스를 조기 중단·환각 없이 처리"했고, Qwen급 로컬 모델이 단일 호출 tool 선택에서 "GPT-4 정확도에 필적". 단 "VRAM 초과 컨텍스트에서 tool-call 정확도 급락" — 그래서 §3.3 압축 요약과 §3.2 selector tool로 컨텍스트를 작게 유지하는 것이 필수다.

**전략:** 형식 오류는 GBNF로 **원천 차단**, 의미 정확도는 **re-plan gate**로 보완. `PlanProvider` 인터페이스로 파워유저는 클라우드 모델을 opt-in.

```ts
interface PlanProvider {
  plan(userRequest: string, manifest: ToolManifest, stateSummary: StateSummary): Promise<Plan>;
}
// 기본: LocalLlamaProvider (오프라인) · opt-in: CloudProvider (drop-in)
```

---

## 6. 단계적 구현 경로

각 단계는 **독립적 가치를 출하**한다. 에이전트는 capstone이지 prerequisite이 아니다.

### Phase 0 — 마케팅 토대 + 와우 데모 (1~2주, 엔지니어링과 병행)
지금 상태(PoC)로 즉시 런칭 가능하게. 키워드강조자막을 원클릭 프리셋으로 제품화(ROI top1, 이미 어절/per-cue 보유). README를 랜딩페이지로(데모 GIF + no-cloud/no-watermark/no-subscription 배지). CapCut-ToS 해독제를 리드 메시지로.

### Phase 1 — 코어 command bus + Zod + 불변식 게이트 (AI 없음) ★ 키스톤
- `EditorState{timeline,transcript,overlays,subtitleStyle,glossary}` 정의 + `applyCommand(state,cmd):CommandResult` 단일 디스패처 신설 (`types.ts:105` 유니언 확장)
- 기존 cut 3종 흡수 + `store.ts`에 실재하는 액션(`addOverlay*`/`setSubtitleStyle`/`applyGlossaryNow`/`removeFillers` → OVERLAY/SUBTITLE/TEXT/CUT)을 core reducer로 이전. EMPHASIS(`highlightKeyword`)는 store.ts에 없으므로 신규 reducer로 추가
- 각 command Zod 스키마 1개 → TS타입 + safeParse 가드 + `z.toJSONSchema()` 파생
- `store.ts`를 dispatch-only 얇은 디스패처로 리팩터 (사람 GUI = 첫 command bus 소비자)
- `validateEdl()` + property 불변식을 자동 post-condition 게이트로 표준화

→ **AI 없이도 UI 스토어가 깨끗해지는 즉시 이득.** 비전 전체의 키스톤.

### Phase 2 — dry-run/diff/commit + audit log + ROI top3 완결
- dry-run(clone 적용·비커밋) + diff 표면 (`CommandResult.before`가 이미 기반)
- append-only 해시체인 command audit log (`history.ts` 위에)
- 펀치인줌·색보정/LUT의 **실제 렌더 파이프라인** 구현 (EDL을 effect-aware로 확장 1단계: `Clip.effects[]` + ffmpeg 필터 매핑)
- 프리뷰=익스포트 일치를 effect-aware EDL 단일 IR 공유로 구조화

### Phase 3 — 로컬 LLM 플래너 + 에이전트 루프 (자연어 편집 MVP) ★ 핵심 차별화
- llama.cpp sidecar(whisper.cpp IPC 재사용) + Qwen급 instruct + GBNF 제약 디코딩
- plan-and-execute + re-plan gate + LAVE식 dry-run 승인 UX
- selector tool(`findWords`/`findSilences`)로 자연어→핸들 해소
- `PlanProvider` 인터페이스(로컬 기본, 클라우드 opt-in) + 압축 상태요약

→ **클라우드 SaaS가 못 주는 '프라이버시 + 에이전트' 조합의 단독 점유 지점.**

### Phase 4 — MCP 서버 + OTIO + 멀티트랙 일반화 (범용 OSS 에디터 완성)
- command 레지스트리를 MCP 서버로 래핑 (`tools/list`=매니페스트+annotation, `tools/call`=Zod검증→reducer, read-only resources=상태요약)
- `TimelineModel`을 멀티트랙·멀티소스(B-roll/PIP/음악) + Clip별 effects/volume/transform로 일반화 — `rebuildGapless` 단일트랙 가정 해제
- EDL을 OTIO 시맨틱으로 확장 + OTIO export 어댑터(Premiere/Resolve/FCP)
- AUDIO 동사(normalize/duck/addBgm) + 전환(크로스페이드) reducer로 어휘 완성

> **순서의 이유:** Phase 1~3는 기존 자산만으로 즉시 가능·저위험. Phase 4의 멀티트랙 일반화는 `rebuildGapless`의 단일트랙·gapless 가정을 해제하는 큰 변경이라 불변식 재설계가 필요 — 잘못 서두르면 결정성 해자를 깬다. 그래서 **마지막에** 둔다.

---

## 7. 첫 스텝 (지금 당장)

> **Phase 1의 키스톤 한 수직 슬라이스를 1개 동사로 끝까지 관통시킨다. AI는 일절 건드리지 않는다.**

`packages/core/src`에:

1. **`applyCommand(state: EditorState, cmd: EditCommand): CommandResult` 단일 디스패처 + `EditorState` 타입 신설** (`types.ts:105` 유니언 확장)
2. **기존 `cutSourceRange`/`deleteWordRange`/`removeSilences` 3종을 이 디스패처가 라우팅하도록 흡수** — 이미 순수함수 + `CommandResult{before,after}` 형태라 **시그니처만 맞추면 됨** (재작성 불필요)
3. **첫 EditCommand로 `store.ts`에 실재하는 액션(`removeFillers` 또는 `applyGlossaryNow`)을 core reducer로 끌어올림** — 이미 순수 로직이라 이전(lift)만 하면 됨. (ROI top1인 `highlightKeyword`(키워드강조자막)는 `store.ts`에 아직 없으므로 '이전'이 아니라, 이미 보유한 어절 타임스탬프/per-cue 자막 인프라 위에 신규 reducer로 처음부터 구현하는 동사다 — 후속 스텝.)
4. **그 command의 Zod 스키마 1개 작성** → (a) TS타입 (b) safeParse 가드 (c) `z.toJSONSchema()` 파생이 **한 소스에서 나오는 패턴 확립**
5. **적용 직후 `validateEdl()` + 불변식을 post-condition으로 호출** → `dispatch → 검증 → undo` 루프 골격을 1개 동사로 끝까지 관통

이 **한 수직 슬라이스가 향후 모든 동사·tool·MCP가 복제할 템플릿**이 된다.

```
첫 스텝의 산출물
─────────────────────────────────────────────
core/src/state.ts        ← EditorState
core/src/apply.ts        ← applyCommand 디스패처 (3종 흡수 + 첫 이전 동사 removeFillers)
core/src/schema/*.ts     ← Zod SSOT (removeFillers 1개부터)
store.ts                 ← dispatch-only로 리팩터 (removeFillers 경로)
```

---

## 8. Prior Art (인용)

| 사례 | dawn-cut에 주는 교훈 | 출처 |
|---|---|---|
| **MCP** (Model Context Protocol) | JSON-RPC 2.0. tool이 JSON Schema로 파라미터·제약 선언, 모델이 스키마 맞는 JSON emit, 서버가 검증·실행. `tools/list`로 self-documenting. → dawn-cut의 `z.toJSONSchema()` 매니페스트 = 이 형태. tool annotation(read-only/destructive/idempotent), append-only 해시체인 audit log. | modelcontextprotocol.info, anthropic.com/engineering/code-execution-with-mcp |
| **OTIO** (OpenTimelineIO, ASWF) | "현대적 EDL" — 멀티트랙·전환·효과·마커를 담는 application-agnostic IR + CMX3600/FCPXML/AAF 어댑터. 미디어가 아니라 컷 순서·길이·외부 참조를 기술. → dawn-cut EDL은 이것의 단일트랙 특수 케이스. 일반화·export 타깃. | github.com/AcademySoftwareFoundation/OpenTimelineIO |
| **LAVE** (CHI 2024) | 가장 가까운 학술 선례. 2-state plan-and-execute: 플래닝(사용자 검토·승인) → 실행(function-calling, 스텝별 승인). 어휘 ~5동사. retrieval + reasoning 하이브리드. trim 정밀도 1초 한계·환각 보고. → dry-run 승인 게이트 UX + selector tool 근거. | arxiv.org/html/2402.10294v1 |
| **Descript** | 텍스트 기반 편집의 상업 벤치마크 — 전사 편집이 타임라인을 결정적 재유도. 단 하이브리드 클라우드-로컬(heavy AI = AWS GPU). → dawn-cut과 직접 대조: text→timeline 매핑은 검증된 코어, 열린 질문은 "LLM plan을 어디서 생성하나"뿐. dawn-cut은 100% 로컬로 답한다. | Descript 리뷰 다수 |
| **Runway/Firefly** | 생성형 패러다임. 'Prompt to Edit'이 편집 지시로 수렴하나 비결정적 재렌더. → 생성은 결정적 편집 코어 **밖**에 격리. 편집 의도는 결정적 파라미터 연산으로 표현. | adobe.com/products/firefly |
| **llama.cpp / GBNF** | GBNF 문법 제약 디코딩으로 "유효하지 않은 JSON 생성 불가능". JSON Schema → GBNF 자동 변환(Ollama v0.5+). Qwen급이 단일 tool 선택에서 GPT-4급. VRAM 초과 시 정확도 급락. → 로컬 우선 + 컨텍스트 압축 근거. | ggml-org/llama.cpp, visokio.com/2025/09 |
| **plan-and-execute + STRATUS** | plan-and-execute가 single-shot 대비 pass rate 3-5배. 약점=출력 보기 전 commit → re-plan gate. STRATUS: 모든 액션 undo 가능, 실패 시 체크포인트 복원. → re-plan gate + `CommandResult.before` undo operator 근거. | langchain.com/blog/planning-agents, research.ibm.com |
| **Zod** | 스키마 1개에서 TS 타입 + safeParse(granular ZodError) + `z.toJSONSchema()` 파생. → core/GUI/agent/MCP 스키마 드리프트 0의 SSOT. 순수 TS라 dependency-cruiser 통과. | zod.dev, zod.dev/json-schema |

---

## 부록: 핵심 파일 맵 (비전 구현 진입점)

| 파일 | 역할 | Phase 1에서 할 일 |
|---|---|---|
| `packages/core/src/types.ts:105` | `EditCommand` 유니언 (현재 2종) | 모든 동사 담는 닫힌 union으로 확장 |
| `packages/core/src/commands.ts` | cut 3종 순수함수 | reducer로 흡수 (재작성 불필요) |
| `packages/core/src/index.ts` | core 공개 표면 | `apply.ts`/`state.ts`/`schema/` 추가 export |
| `packages/core/src/edl.ts:8` | `timelineToEdl(timeline, mediaPath)` 단수 | (Phase 2/4) effect-aware·멀티소스로 확장 |
| `packages/core/src/sync.ts:9` | wordToProgram/liveWords | selector tool(`findWords`)의 토대 |
| `packages/core/src/timeline.ts` | `rebuildGapless` 단일트랙 | (Phase 4) 멀티트랙 일반화 |
| `packages/ui/src/store.ts` | 명령형 Zustand 액션 (overlay/subtitle/glossary/filler) | core reducer로 이전 → dispatch-only 리팩터 |
| `sidecar/ffmpeg/src/index.ts` | EDL → ffmpeg filter_complex 렌더 | (Phase 2) effect 필터 매핑 추가 |
