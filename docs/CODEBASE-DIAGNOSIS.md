# dawn-cut 코드베이스 진단

> 작성: 시니어 아키텍트 진단 / 기준: 궁극 비전(자연어 → AI가 tool·MCP로 전문 편집가처럼 조작) + 1차 목표(오픈소스 CapCut)
> 모든 근거는 `packages/core`, `packages/ui`, `sidecar/ffmpeg` 실제 파일에 대한 직접 확인에 기반한다.

---

## 0. 한 줄 결론

dawn-cut의 편집 코어(`packages/core/src`)는 순수 TS·결정적·불변식 검증이 잘 된 **'데이터 모델 + 변환 함수'** 레이어로, AI/MCP tool 제어의 토대로서 이례적으로 좋은 출발점이다. 그러나 비전 기준으로 보면 코어는 아직 **'도구 API'가 아니라 '함수 모음'**이다. 엔진의 크랭크샤프트(결정적 코어)는 정밀하게 깎여 있으나, **운전대(command bus)도 변속기(멀티트랙 모델)도 아직 달려 있지 않다.**

핵심 격차 세 가지:
1. `types.ts:105`의 `EditCommand` 유니언은 **정의만 되어 있고 디스패처(`applyCommand`)가 코드베이스 어디에도 없다** (grep으로 확인: `EditCommand` 참조는 `types.ts`의 선언 2줄이 전부).
2. 실제 편집 동작 대부분(오버레이, 자막 스타일·per-cue, TTS, 무음, 사전/필러)이 `core`가 아니라 `store.ts`와 `index.tsx`(1,839줄 UI)에 **명령형으로 흩어져** tool로 노출할 단위가 없다.
3. 타임라인 모델이 **단일 비디오 트랙·단일 소스·gapless ripple**로 하드코딩되어 멀티트랙/멀티소스/오버랩/B-roll을 표현할 수 없다.

---

## 1. 강점 (파일 근거)

### 1.1 순수 TS 코어 격리 (node/electron 금지) — 헤드리스 tool 백엔드의 전제

`packages/core/src/index.ts:1-2`가 **"MUST NOT import electron / fs / child_process — enforced by dependency-cruiser"**를 명시하고, `.dependency-cruiser.cjs`의 `core-no-electron` / `core-no-node-builtins` 규칙(`fs|child_process|path|os|net|http|https|worker_threads` 금지, `00-SEED CONSTRAINT #1`)이 이를 강제한다. ffmpeg는 `sidecar/ffmpeg/src/index.ts`에서 subprocess로만 호출(LGPL 보존).

- **함의:** 코어 로직을 그대로 헤드리스로 실행·테스트할 수 있고, AI tool 실행기가 코어 함수를 호출해도 부작용이 없다. tool-call 백엔드로 안전하게 재사용 가능한 형태.

### 1.2 결정적 데이터 계약 (정수 µs + half-open 구간 + 불변식)

`types.ts:1-4`가 모든 시간을 **정수 µs·`[start, end)` 반정밀 구간**으로 못박는다. 그리고 모든 모델에 `validate*()` 불변식 체커가 일관되게 존재한다(직접 확인):

| 파일 | 검증 함수 | 불변식 |
|---|---|---|
| `transcript.ts:31` | `validateTranscript` | T-INV-1~4 (order↔words 전단사/sourceStart 단조/구간 양수/빈텍스트) |
| `timeline.ts:56` | `validateTimeline` | TL-INV-1~4 (overlap/gapless/positivity/duration cache) |
| `sync.ts:57` | `validateSync` | SYNC-INV-1~3 (roundtrip/subsequence/length) |
| `edl.ts:20` | `validateEdl` | EDL-INV-1~2 (Σlength/duration 일치, contiguity) |
| `overlay.ts:146` | `validateOverlays` | 오버레이 시간/좌표 범위 |
| `subtitles.ts:83` | `validateCues` | 큐 시간 정합성 |
| `project.ts:61` | `validateProject` | transcript+timeline+sync 전부 검증(`deserializeProject`가 로드 시 호출) |

- **함의:** AI가 만든 편집 결과를 "유효한가"로 자동 검증할 수 있는 것은 tool 자율편집의 안전망으로 결정적이다.

### 1.3 순수함수 command 패턴 + before/after 스냅샷

`commands.ts`의 `cutSourceRange`(L47)/`deleteWordRange`(L82)/`removeSilences`(L116)가 `structuredClone`(L6 `clone()`)으로 입력을 변형하지 않고, no-op도 clone 반환(`noop()` L137), `CommandResult{before, after, removedProgramUs}`(`types.ts:109`)로 되돌릴 수 있는 결과를 낸다. `undo()`(L142)가 `before`를 복원한다. `commands.property.test.ts` 속성 테스트까지 존재(코어 20개 테스트 파일 중 하나).

- **함의:** 이 패턴은 tool-call의 **'명령 적용 → 결과 반환 → undo 가능'** 계약과 사실상 동형이다. command vocabulary만 넓히면 tool API의 실행 모델이 거의 완성된다.

### 1.4 EDL 결정적 중간표현으로 edit/export 분리

`edl.ts:8` `timelineToEdl()`이 timeline을 **contiguous·ascending programStart** 세그먼트 리스트로 환원하고, sidecar(`sidecar/ffmpeg/src/index.ts:116` `renderEdl`)가 이 EDL만 받아 `filter_complex`(trim+concat)로 렌더한다. `preview.ts`가 같은 EDL로 program→source 시킹을 계산한다.

- **함의:** 단일 결정적 IR이 있어 '편집 의도'와 '렌더 백엔드'가 분리됨. 미래에 GPU 컴포지터로 백엔드를 갈아끼우거나, AI가 EDL을 직접 검사·검증하기 좋다.

### 1.5 전사-타임라인 SyncMap (텍스트 기반 편집의 좌표계)

`sync.ts`의 `wordToProgram`(L9)/`programToWord`(L26)/`liveWords`(L46)가 source↔program 좌표를 양방향 매핑하고 SYNC-INV-1 라운드트립(L60-66)으로 보증한다. `subtitles.ts`·`chapters.ts`·`fillers.ts`가 모두 이 위에 얹혀 있다.

- **함의:** AI가 "이 문장 빼줘"를 wordId 범위로 환원하기에 이상적인 좌표계가 이미 있다.

### 1.6 공유 드로잉 프리미티브로 프리뷰/익스포트 픽셀 일치 시도

`draw.ts:9`의 `DrawCtx` 인터페이스가 **DOM canvas와 `@napi-rs/canvas` 양쪽에서 같은 코드**로 픽셀을 생성하도록 추상화한다(`drawSubtitle` L83 / `drawEmoji` L144 / `drawBadge` L153). 자막/스티커는 PNG로 래스터되어 `overlay.ts:23` `buildOverlayFilter`로 ffmpeg에 동일 좌표 규약(`xPx=round(x*W)`, L20-21 주석 + L42-43 구현)으로 들어간다.

- **함의:** 자막 한정으로는 프리뷰=익스포트 일치가 구조적으로 추구되고 있고, 헤드리스 픽셀 검증의 길이 열려 있다.

---

## 2. 약점 (파일 근거 + 비전 차단 지점)

### 2.1 EditCommand 디스패처 부재 — tool-call 계약의 핵심 공백 (★최우선)

`types.ts:105-107`에 `EditCommand` 유니언이 선언돼 있으나 **`deleteWordRange | removeSilences` 2종뿐**이고, 이를 받아 timeline에 적용하는 `applyCommand`/`dispatch`가 코드베이스 전체에 없다(grep 확인: `EditCommand` 참조 = `types.ts` 선언 2줄, `applyCommand`/`dispatch` 결과 0). `store.ts`는 `commands.ts` 함수를 직접 호출한다(`store.ts:388` `deleteWordRange(...)`, `store.ts:409` `removeSilences(...)`).

- **비전 차단:** AI 에이전트가 호출할 '결정적 tool API'의 가장 기본 단위(명령을 데이터로 표현 → 적용)가 없다. 이게 없으면 tool 호출을 **기록·재생·undo·검증·MCP 노출**할 표준 경로가 없다.

### 2.2 편집 동작이 `store.ts`/`index.tsx`에 흩어져 core 밖에 있음

오버레이 추가/이동/키프레임/회전/블렌드(`store.ts:302` `addOverlaySrc`, `:311` `addOverlayWith`, `:281` `updateOverlay`, `:332` `removeOverlay`, `:312` `clearOverlaysByKind`), 자막 스타일(`store.ts:277` `setSubtitleStyle`), TTS(`store.ts:322` `generateVoiceover`), 사전(`store.ts:585` `applyGlossaryNow`), 필러 제거(`store.ts:596` `removeFillers`), per-cue 자막 래스터(`index.tsx:940` `rasterizeSubtitle`, `:1085` 버닝)가 전부 React/Zustand에 구현돼 있다. core의 `overlay.ts`는 ffmpeg **필터 빌더일 뿐** '오버레이 추가 command'가 아니다.

- **비전 차단:** tool로 노출할 동작의 다수가 UI 상태 변이로만 존재해 헤드리스로 호출 불가. AI가 "여기에 강조 자막/스티커/줌 넣어"를 실행하려면 이 로직들이 core의 직렬화 가능한 command로 올라와야 하는데, 현재는 UI를 거치지 않으면 실행할 수 없다.

### 2.3 command vocabulary가 컷 3종뿐 — 편집 어휘 빈약

core의 실제 변환 command는 `cutSourceRange`/`deleteWordRange`/`removeSilences`(`commands.ts`) **3종뿐**. 자막 추가/스타일링, 오버레이 배치·애니메이션, 줌(펀치인), 색보정/LUT, 사운드(BGM/덕킹/노멀라이즈), 전환(크로스페이드)에 해당하는 core command가 없다.

- **비전 차단:** '전문 편집가처럼 조작'하려면 컷 외에 시각/사운드 어휘가 필요한데, AI가 호출할 동사 자체가 컷밖에 없다. ROI top3(키워드강조자막 / 펀치인줌 / 색보정프리셋) 중 **줌·색보정은 core 어휘에 아예 존재하지 않는다.**

### 2.4 타임라인 모델이 단일 트랙·단일 소스·gapless ripple로 하드코딩

`timeline.ts:33` `createInitialTimeline`은 비디오 트랙 1개에 클립 1개, `commands.ts:11` `rebuildGapless`는 항상 단일 video track을 0부터 gapless로 재구성한다(TL-INV-2가 `timeline.ts:77`에서 **video track에만** 적용). `Track.kind`는 `'video' | 'audio'`뿐(`types.ts:42`). `edl.ts:8` `timelineToEdl(timeline, mediaPath: 단수)`·sidecar `renderEdl`이 `input = edl.segments[0].mediaPath`(`sidecar/ffmpeg/src/index.ts:122`)로 **단일 입력만** trim/concat. `Clip`(`types.ts:32`)에 effects/volume/transform 필드가 없다.

- **비전 차단:** 범용 CapCut의 필수인 멀티트랙(B-roll 컷어웨이/PIP/음악 트랙), 멀티소스, 클립 겹침/슬립/오버랩 전환, 클립별 줌·색보정·볼륨을 표현할 **데이터 모델 자체가 없다.** AI가 만들 수 있는 편집의 상한이 '단일 영상의 시간 잘라내기 + PNG 오버레이'로 제한된다.

### 2.5 줌/색보정/전환/효과가 UI 스텁 (렌더 파이프라인 없음)

`index.tsx:503` `EffectPanel`은 Auto-zoom/Cursor highlight/Blur/Shake/Glitch(`:497-501`)를 **'preview' 배지의 정적 리스트**로만 표시하고, `:520-521`이 "Rendering pipeline lands with the GPU compositor — listed as preview"라고 명시한다. `:217` 주석도 "'effect'(효과)는 전부 미연동 preview stub이라 레일에서 숨김"이라 정직하게 적혀 있다. core·sidecar에 zoom/colorgrade/lut/transition 구현이 전무하다(grep 확인). 사운드도 sidecar의 TTS `amix` 하나뿐(`sidecar/ffmpeg/src/index.ts:181`)이고 BGM/덕킹/노멀라이즈는 없다.

- **비전 차단:** 캡컷 '있어보임'의 두 축(타이밍 동기 시각변화=펀치인줌, 원클릭 LUT/색보정)이 미구현. AI에게 노출할 tool도 없고 렌더할 백엔드도 없어, 자연어 요청이 와도 실행할 동작이 존재하지 않는다.

### 2.6 프리뷰=익스포트 일치가 구조적으로 비보장 (자막 외)

프리뷰는 HTML5 `<video>` seek(`preview.ts`) + DOM canvas 합성, 익스포트는 ffmpeg `filter_complex`(trim/concat/overlay, `overlay.ts`)로 **완전히 다른 두 렌더 경로**. 자막/스티커는 같은 `draw.ts` 프리미티브로 좌표 규약을 맞추려 하지만, 오버레이 애니메이션 이징·블렌드·회전은 ffmpeg expr(`overlay.ts:57-111`)로 별도 구현되어 프리뷰 CSS와 어긋날 여지가 있다. 줌/색보정 추가 시 이 격차가 커진다.

- **비전 차단:** AI가 '편집가처럼' 결과를 책임지려면 프리뷰에서 본 것이 곧 결과여야 한다(WYSIWYG). 두 렌더러가 분기하면 AI가 검증한 프리뷰와 실제 출력이 달라져 자율편집 신뢰가 깨진다. 단일 결정적 렌더러(또는 effect-aware EDL IR을 양쪽이 공유)가 필요하다.

---

## 3. tool화 준비도 (Tool Control Readiness)

> **중간 준비도 — 토대 우수, API 표면 부재.**

결정적 코어·µs 계약·불변식·순수함수 command·before/after·EDL IR이라는 **'tool API에 필요한 비기능 요건'은 이미 ~70% 갖춰져 있다.** 동급 단계 에디터 중 출발점이 매우 좋다. 그러나 **'AI가 호출할 결정적 tool 표면' 자체는 사실상 0%다.**

| tool-call에 필요한 요건 | 현재 상태 | 근거 |
|---|---|---|
| 결정성 (deterministic) | ✅ | 정수 µs, `structuredClone` 순수함수 |
| 자동 검증 (post-condition) | ✅ | `validate*()` 7종 |
| 되돌리기 (undo) | ✅ | `CommandResult.before` + `undo()` |
| 헤드리스 실행 | ✅ | core가 fs/electron-free (dependency-cruiser 강제) |
| 결정적 IR (검토 가능) | ✅ | EDL |
| **직렬화 가능한 명령 객체** | ⚠️ 부분 | `EditCommand` 선언만, 2종 |
| **단일 디스패처 (`applyCommand`)** | ❌ 없음 | grep 결과 0 |
| **편집 어휘 (동사 카탈로그)** | ❌ 빈약 | 컷 3종뿐 |
| **JSON 스키마 / MCP 매니페스트** | ❌ 없음 | Zod 미도입 |
| **멀티트랙/효과 표현력** | ❌ 없음 | 단일 트랙·단일 소스 |

일반화해야 할 4가지:

1. **`EditCommand`를 닫힌 discriminated union으로 확장 + 단일 디스패처 신설.** `applyCommand(state, cmd): CommandResult`를 core에 신설해 모든 tool 호출이 이 한 경로로 수렴하게 한다.
2. **`store.ts`/`index.tsx`의 동작을 core command로 끌어올린다.** UI는 command를 dispatch만 하는 얇은 프레젠테이션, core가 진실의 원천.
3. **`TimelineModel`을 멀티트랙·멀티소스 + `Clip.effects[]`(zoom/colorgrade/volume/transform)·transition으로 일반화**하고, EDL을 'effect-aware IR'로 확장(렌더 백엔드가 이 IR만 소비).
4. **command를 Zod 스키마로 못박아** (a) TS 타입 (b) `safeParse` 런타임 가드 (c) `z.toJSONSchema()` MCP 매니페스트를 한 소스에서 파생. 적용 후 `validate*()`로 자동 검증하는 '실행 → 검증 → undo' 루프를 표준화.

이 4가지가 끝나면 **MCP 서버는 command 카탈로그를 tool로 매핑하는 얇은 어댑터**가 된다(코어 재작성 불필요).

---

## 4. 첫 리팩터 대상 (명시)

> **키스톤 = `packages/core/src`에 `EditorState` 타입 + `applyCommand` 단일 디스패처 신설.**

### 4.1 무엇을 (대상 파일)

- **신설:** `packages/core/src/state.ts` — `EditorState = { timeline, transcript, overlays, subtitleStyle, glossary }` (현재 `store.ts`에 흩어진 상태를 core로 끌어올림)
- **신설:** `packages/core/src/apply.ts` — `applyCommand(state: EditorState, cmd: EditCommand): CommandResult`
- **확장:** `packages/core/src/types.ts:105` — `EditCommand` 유니언을 닫힌 discriminated union으로
- **흡수:** `packages/core/src/commands.ts`의 3종을 디스패처가 라우팅하도록(이미 `{before, after}` 형태라 시그니처만 맞추면 됨 — **재작성 불필요**)
- **신설:** command별 Zod 스키마(`packages/core/src/schema.ts`)

### 4.2 왜 이것부터인가 (우선순위 근거)

- **위험 최저·즉시 가능:** 기존 `commands.ts` 3종이 이미 순수함수 + `CommandResult{before, after}`라 디스패처가 라우팅만 하면 된다. 모델 변경 없음.
- **AI 없이도 즉시 이득:** `store.ts`가 dispatch-only 얇은 디스패처가 되어 UI 스토어가 깨끗해진다(사람 GUI가 첫 command bus 소비자).
- **모든 후속의 템플릿:** 첫 command로 `store.ts`에 **실재하는** 액션(`removeFillers` 또는 `applyGlossaryNow`)을 core reducer로 끌어올리고, 그 Zod 스키마 1개로 (TS타입 / safeParse 가드 / JSONSchema 파생) 패턴을 확립한다. 적용 직후 `validateEdl()` + 불변식을 post-condition으로 호출해 **'dispatch → 검증 → undo' 루프를 1개 동사로 끝까지 관통**시킨다. 이 한 수직 슬라이스가 향후 모든 동사·tool·MCP가 복제할 템플릿이 된다. (`highlightKeyword`(키워드강조자막)는 `store.ts`에 아직 없는 ROI top1 동사로, 이미 보유한 어절 타임스탬프/per-cue 자막 인프라 **위에** 신규 reducer로 처음부터 구현한다 — 이전(lift)이 아니라 신규 구현.)

### 4.3 우선순위 순서

| 순위 | 작업 | 위험 | 즉시 이득 | 비전 기여 |
|---|---|---|---|---|
| 1 | `applyCommand` 디스패처 + `EditorState` + 기존 3종 흡수 | 낮음 | UI 스토어 정리 | ★★★ (키스톤) |
| 2 | `store.ts`/`index.tsx` 동작을 core reducer로 이전 (overlay/subtitle/glossary/filler) | 중간 | 헤드리스 호출 가능 | ★★★ |
| 3 | command별 Zod 스키마 → TS/가드/JSONSchema 단일 파생 | 낮음 | 스키마 드리프트 0 | ★★ (MCP 토대) |
| 4 | 펀치인줌·색보정 렌더 파이프라인 + effect-aware EDL 1단계 | 중간 | ROI top3 완결 | ★★ |
| 5 | **(마지막)** `TimelineModel` 멀티트랙·멀티소스 일반화 (`rebuildGapless` 단일트랙 가정 해제) | **높음** | 범용 NLE | ★★★ |

> ⚠️ **순서 주의:** 5번(멀티트랙 일반화)은 `rebuildGapless`의 단일트랙·gapless 가정과 TL-INV 불변식 재설계를 동반하는 큰 변경이다. 비용이 크고 잘못 서두르면 **결정성 해자를 깰 수 있다.** 1~4(기존 자산만으로 즉시 가능, 저위험)를 먼저 완결하고 모델 변경은 마지막에 둔다.

---

## 5. 비전 정렬 요약

```
[자연어] → LLM 플래너 → 검증된 EditCommand 문서(plan)
                              │
                              ▼
              applyCommand(state, cmd)  ◀── (4.1 키스톤, 현재 부재)
                              │
              ┌───────────────┴───────────────┐
         post-condition                    dry-run / diff
         validate*()  ✅                  CommandResult.before ✅
                              │
                              ▼
                  effect-aware EDL (IR)  ◀── (현재 단일소스, §2.4/§2.6)
                              │
              ┌───────────────┴───────────────┐
          프리뷰(DOM)                      익스포트(ffmpeg)
          → 단일 IR 공유로 WYSIWYG 보장 (§2.6 해소 목표)
```

- **✅ 이미 있는 것:** 결정적 코어, µs 계약, 7종 불변식, 순수 command + undo, EDL IR, SyncMap, 공유 draw 프리미티브.
- **❌ 비전까지 채울 것:** `applyCommand` 디스패처(키스톤) → 동작의 core 이전 → 편집 어휘 확장 → Zod/MCP 매니페스트 → effect-aware/멀티트랙 IR.
- **첫 수(next concrete step):** `packages/core/src`에 `applyCommand` + `EditorState`를 신설하고 기존 3종을 흡수, `store.ts`에 실재하는 액션(`removeFillers`/`applyGlossaryNow`) 1개를 첫 EditCommand로 core 이전해 'dispatch → 검증 → undo' 수직 슬라이스를 1개 관통. **AI는 이 단계에서 일절 건드리지 않는다.**

---

*근거 파일: `packages/core/src/{types,commands,timeline,edl,sync,index,overlay,draw,subtitles}.ts`, `packages/ui/src/{store.ts,index.tsx}`, `sidecar/ffmpeg/src/index.ts`, `.dependency-cruiser.cjs`. 모든 줄 번호는 진단 시점 main 브랜치 기준.*
