# dawn-cut 제품 전략 (STRATEGY)

> 한 줄 포지셔닝
> **"영상이 내 노트북을 떠나지 않습니다. 계정·워터마크·구독 없이, 자연어로 말하면 AI가 컷·자막·줌·색보정을 직접 편집합니다 — 그리고 제안한 편집(타임라인/EDL)을 눈으로 확인하고 렌더합니다."**
>
> _The only open-source video editor where the AI edits for you — and your footage never leaves your machine._

---

## 1. 현 상황 진단 (Situation Diagnosis)

dawn-cut은 **"결정적 편집 코어"라는 비전의 토대(약 70%)는 이미 갖췄지만, "AI가 자연어로 조작하는 tool 표면"은 사실상 0%**다.

### 1.1 강점 — 엔진의 크랭크샤프트는 정밀하게 깎여 있다

| 자산 | 위치 | 의미 |
| --- | --- | --- |
| node/electron-free 순수 TS 코어 | `packages/core` (dependency-cruiser로 강제) | tool-call 백엔드를 헤드리스로 실행 가능 |
| 정수 µs · 반정밀 `[start,end)` 구간 | 전 모델 공통 | 부동소수 드리프트 없는 결정성 |
| 모든 모델 `validate*()` 불변식 | T-INV / SYNC-INV / EDL-INV | AI가 만든 편집을 자동 검증 가능 |
| 순수함수 command + `CommandResult{before,after,removedProgramUs}` | `commands.ts` | structuredClone 기반, undo·dry-run 가능 |
| transcript↔program 양방향 라운드트립 | `sync.ts` | 텍스트 편집 ↔ 타임라인 일관성 보증 |
| 결정적 IR로 edit/export 분리 | `edl.ts` | "재현 가능한 편집" 표준 IR 확보 |

이 조합은 tool-call 백엔드에 필요한 **비기능 요건(결정성·검증·되돌리기·헤드리스 실행)을 이례적으로 잘 충족**한다.

### 1.2 비전까지의 격차 — 운전대도 변속기도 아직 안 달렸다

코드 실측으로 확인된 격차:

1. **command bus 부재 (키스톤).** `packages/core/src/types.ts`의 `EditCommand` 유니언은 `deleteWordRange` / `removeSilences` **2종만** 선언돼 있고, 이를 받아 라우팅하는 `applyCommand` 디스패처가 코드베이스에 존재하지 않는다. "직렬화 명령 → 결정적 적용"이라는 tool-call 핵심 계약이 비어 있다.
2. **편집 어휘가 UI에 흩어짐.** 실제 편집 동사의 대부분(오버레이 add/update/keyframe, 자막 스타일·per-cue, glossary, filler 제거, TTS)이 `packages/ui/src/store.ts`의 명령형 Zustand 액션(`addOverlaySrc` / `setSubtitleStyle` / `applyGlossaryNow` / `removeFillers` …)과 대형 `index.tsx`에 흩어져 있어 **헤드리스 호출 단위가 없다.**
3. **core 변환 command는 3종뿐.** `commands.ts`의 실제 변환은 `cutSourceRange` / `deleteWordRange` / `removeSilences`가 전부 — 자막·줌·색보정·사운드·전환 동사 부재.
4. **단일 트랙 하드코딩.** 타임라인이 단일 비디오 트랙·단일 소스·gapless ripple로 고정(`commands.ts`의 `rebuildGapless`, `edl.ts`의 `timelineToEdl(timeline, mediaPath)` — mediaPath 단수)되어 멀티트랙/B-roll/PIP/오버랩을 표현 불가.
5. **줌/색보정/전환은 스텁.** `index.tsx`의 `'preview'` 배지 스텁일 뿐 렌더 파이프라인 전무.

**한 줄 요약:** 결정적 코어(크랭크샤프트)는 정밀하게 깎여 있으나, command bus(운전대)도 멀티트랙 모델(변속기)도 아직 달려 있지 않다.

---

## 2. 경쟁 지형 (Competitive Landscape)

핵심 통찰: dawn-cut의 방어가능한 차별점은 **단일 기능이 아니라 조합**이다. 모든 경쟁자는 두 축 중 한쪽만 가진다.

- **축 A — 프라이버시/로컬** (데이터가 기기를 안 떠남)
- **축 B — 자연어 에이전트 편집** (AI에게 편집을 위임)

클라우드 SaaS는 **B를 주고 A를 못 주고**, 로컬 OSS(OpenCut)는 **A를 주고 B를 못 준다.** 양립하는 제품이 사실상 부재 — 이것이 dawn-cut의 진짜 윈도우다.

### 2.1 경쟁 매트릭스

| 제품 | 라이선스/모델 | 로컬(축A) | NL 에이전트(축B) | 단어 단위 텍스트편집 | 결정적 EDL/IR | 한국어 STT | 비용/제약 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **dawn-cut** | OSS(MIT), 로컬 | ✅ 100% 로컬 | 🔜 (코어 보유, 표면 미완) | ✅ (whisper 단어 타임스탬프) | ✅ (`edl.ts`) | ✅ 어절 재조립 완료 | 무료·무워터마크·무계정 |
| **CapCut** | 상용 SaaS | ❌ 클라우드 | 부분(생성형) | ❌ | ❌ | △ | 무료티어 워터마크·**ToS 데이터 라이선스 리스크** |
| **Vrew** | 상용 구독 | ❌ 클라우드 | 부분 | △ (문장 단위) | ❌ | ✅ **강함(정면 경쟁)** | 무료 월 30분 export·Pro $8.99~Premium $24.99/월 |
| **OpenCut** | OSS(MIT), 브라우저 로컬 | ✅ 100% 로컬 | ❌ | ❌ | ❌ | ❌ | 무료·무워터마크 / **45K+ stars (인접 위협)** |
| **Descript** | 상용 SaaS | ❌ 클라우드(AWS GPU) | 부분 | ✅ **선구자** | ❌ | △ | 2025-09 미디어분+AI크레딧 개편·롤오버 폐지·커뮤니티 반발 |
| **Opus Clip / Submagic / Gling / AutoCut** | 상용 SaaS | 대부분 ❌ (Gling만 로컬 광고) | 부분(단일작업) | ❌ | ❌ | △ (Submagic 한국어 미확인) | 크레딧·업로드·쇼츠 특화 |
| **Kapwing** | 상용 SaaS | ❌ | 부분 | ❌ | ❌ | △ | 무료 250MB·1분 export 워터마크·**3일 후 프로젝트 삭제** |
| **video-MCP 서버들** (mcp-video 등) | OSS 도구 | ✅ (로컬 FFmpeg) | △ (얕은 래퍼) | ❌ | ❌ (없음) | ❌ | **콘텐츠 비인지 FFmpeg 래퍼** |

### 2.2 경쟁자별 해석 (리서치 근거)

- **CapCut** — 약점은 기능이 아니라 **신뢰·소유권·워터마크.** 2025-06-12 발효 ToS 개정으로 사용자 콘텐츠(생체정보 = 얼굴 인식·음성 패턴 포함)에 **영구·전세계·무료·취소불가 라이선스를 자사에 부여.** BIPA 프라이버시 소송 진행(2025-03-06 법원 진행 결정), 미국 PAFACA 분할-또는-금지 명령(2025-01-19), 인도 영구 금지(2020~). 중국 2017 국가정보법이 "데이터가 국가 접근으로부터 보호될 수 없는" 근거로 인용됨. → **데이터 주권 공백을 dawn-cut의 100% 로컬이 구조로 메운다.**
  - 출처: mediapost.com / 2b-advice.com / natlawreview.com
- **Vrew** — 한국어 STT/자막에서 **가장 강한 정면 경쟁자.** 방어선은 "클라우드+구독+효과 빈약". 무료 월 30분 export, Pro $8.99~Premium $24.99/월, 핵심 STT·합성음성은 클라우드 서비스. 명시적 단점 = **'효과 리소스 부족'.** dawn-cut은 동급 품질(whisper large-v3-turbo, WER ~13.4% vs V3 13.2%, 2.3~8배 빠름)을 100% 로컬·무제한 export로 제공 → Vrew의 구독+분당과금+업로드 모델 전체 우회. **단, 한국어 자막 UX 완성도가 높아 '품질 동급'을 증명해야 함.**
  - 출처: vrew.ai/payment / vrew.ai/terms / whispernotes.app / openwhispr.com
- **OpenCut** — **가장 위험한 인접 경쟁자.** '오픈소스 CapCut' 포지션을 이미 선점(45,000+ stars, MIT, 100% 브라우저 로컬, 무워터마크, Vercel/fal.ai 후원·90+ 기여자, "50K creators abandon CapCut" 내러티브). 그러나 **결정적 공백: STT 단어 타임스탬프·텍스트기반편집·결정적 EDL·에이전트 제어가 없다.** OpenCut = '손으로 편집하는 OSS 타임라인', dawn-cut = 'AI가 편집을 위임받는 OSS 코어'. 차별축은 UI 완성도가 아니라 **'기계가 의미론적으로 조작 가능한 결정적 편집 코어'.**
  - 출처: opencut.dev / design-drifter.com / github.com/KinanCodeaz/opencut
- **Descript** — dawn-cut의 핵심 자산(텍스트기반 편집)을 가진 유일한 메이저. 그러나 2025-09-23 발효 **가격 개편(미디어-분 + AI 크레딧 + 롤오버 폐지)으로 커뮤니티 반발 극심**, 클라우드 종속, 교차발화(cross-talk) 전사 약점, **'사용자 편집에서 학습 못 함'**(같은 오류 반복), AI 크레딧 소비 불투명. dawn-cut = **'오프라인 Descript'** — 동일 패러다임을 로컬·무과금·무크레딧으로.
  - 출처: eesel.ai / cotovan.com / trebble.fm
- **AI 자동편집 SaaS** — 전부 클라우드·크레딧·업로드, 단일 작업(쇼츠/무음컷/캡션) 특화. Opus Clip 1크레딧=1분·Pro $29/mo·100GB 클라우드, Submagic 쇼츠 전용·처리 정체가 G2 불만 #1·한국어 미확인. **흥미롭게도 Gling만 '데스크탑 로컬 처리(업로드 없음)'를 차별점으로 광고** → 시장도 '로컬 처리'가 셀링포인트임을 인정. dawn-cut은 이 단일기능들을 **로컬·무크레딧·tool 한 세트로 통합** 가능.
  - 출처: opus.pro/pricing / submagic.co / trustpilot.com
- **video-editing MCP 서버** — KyaniteLabs mcp-video(119 tools), VFX MCP 등 모두 **'FFmpeg 명령 래퍼'일 뿐.** 콘텐츠 의미론 미이해, 결정적 EDL 중간표현 없음, transcript→edit→regenerate 루프 없음. mcp-video는 명시적으로 "primarily an FFmpeg wrapper, NOT content-aware; no transcript-to-edit pathway; EDL/deterministic representation Not mentioned." → **'로컬 OSS + 의미론적 텍스트편집코어 + 결정적 EDL + tool 노출'을 동시에 가진 제품이 시장에 부재.**
  - 출처: github.com/KyaniteLabs/mcp-video / loopdesk.ai (2026 트렌드)

---

## 3. 방어가능한 장점과 니치

### 3.1 방어가능한 장점

1. **vs CapCut — 데이터 주권을 기능이 아니라 구조로.** 영상이 기기를 한 바이트도 떠나지 않음. 무계정·무텔레메트리·무워터마크·무구독. CapCut ToS의 생체정보 라이선스 공백을 정면으로 메운다.
2. **vs Vrew — 동급 한국어 자막을 로컬·무제한·무료로.** whisper large-v3-turbo(WER ~13.4%, 클라우드와 거의 동일)를 로컬에서 어절 재조립까지 완료. Vrew의 명시적 약점인 '효과 빈약'을 **자막 스타일 프리셋 다양성으로 역공.**
3. **vs Descript — '오프라인 Descript'.** '문장을 지우면 영상이 사라지는' 텍스트 기반 편집을 로컬·무과금·무크레딧으로. Descript의 미터링 불투명성/멀티파일 페널티는 1인 롱폼 채널주에게 직접 페인.
4. **vs OpenCut — UI가 아니라 '기계가 조작 가능한 결정적 코어'로 차별화.** dawn-cut의 해자는 UI 완성도가 아니라 **STT 단어 타임스탬프 + 텍스트기반편집 + 결정적 EDL + 에이전트 제어.**
5. **공통 해자(조합).** 축 A(프라이버시/로컬)와 축 B(자연어 에이전트)를 **동시에** 가진 제품이 시장에 사실상 부재. dawn-cut만 양립.
6. **검증가능한 신뢰성 (2026 트렌드 적중).** 결정적 EDL + property test + 데이터계약(정수 µs, T-INV/SYNC-INV)으로 **'AI가 만든 편집을 재현·자동검증'.** 2026 에이전트 편집 리서치는 'zero-input 블랙박스'가 아니라 **'검토 가능한 중간표현(EDL/타임라인)을 노출하는 도구'가 채택을 이긴다**고 명시 — dawn-cut은 이미 그 IR을 보유.

### 3.2 진짜 방어가능한 포지션

> **'오프라인 Descript의 두뇌 + OpenCut의 개방성 + 에이전트 제어'의 교집합**
> = **'내 데이터를 한 바이트도 안 보내고 AI에게 편집을 맡길 수 있는 유일한 OSS 에디터'**

단일 기능으로 싸우면 진다 — Vrew는 한국어 자막, OpenCut은 타임라인 UI, Descript은 텍스트편집을 각각 더 잘한다. 해자는 이 셋을 **100% 로컬에서 동시에 묶고**, 그 위에 **결정적 편집 코어(`commands.ts` + EDL)를 자연어 AI에 tool로 노출하는 '조합'**이다.

---

## 4. 1차 타겟과 확장

### 4.1 1차 비치헤드 (Beachhead)

> **프라이버시·비용 민감 + 기술친화 + AI에게 편집을 위임하고 싶은 한국어 정보형 롱폼 1인 채널주**

이 교집합은 **Vrew(클라우드·구독)와 CapCut(데이터·워터마크) 사이에서 능동적으로 탈출구를 찾는 실수요 세그먼트.** Kapwing 무료티어 페인 + OpenCut stars 폭발 + 'abandon CapCut' 내러티브가 'OSS·무워터마크·로컬'이 이념이 아니라 **실수요 신호**임을 입증한다.

### 4.2 진입 채널

- **한국 우선:** GeekNews Show + 한국 유튜브 워크스루로 '와우' 데모 도달.
- Awesome-self-hosted / OSS-alternatives 리스트 등재.

### 4.3 확장 경로

비치헤드(한국어 롱폼 1인 채널주) → 일반 프라이버시 민감 크리에이터 → 영문권 '오프라인 Descript' 수요 → 외부 에이전트(Claude Desktop/Cursor)가 dawn-cut을 구동하는 **'편집 두뇌 레이어'** 상호운용 포지션.

---

## 5. 비전 아키텍처 (목표 구조)

> **LLM은 검증된 EditCommand 문서를 생성하고, 결정적 코어가 그것을 렌더한다** (MCP/LAVE/OTIO 선례 모두 이 분리 형태).

**5계층:**

1. **코어 command 어휘 표준화 (키스톤).** `types.ts`의 `EditCommand` 유니언을 **모든 편집 동사를 담는 닫힌 discriminated union**으로 확장하고, core에 단일 디스패처 `applyCommand(state: EditorState, cmd: EditCommand): CommandResult`를 신설. `EditorState = { timeline, transcript, overlays, subtitleStyle, glossary }`로 정의해 흩어진 상태를 core로 끌어올린다. 모든 동사를 순수 reducer로 구현:
   - `CUT`{ deleteWordRange, removeSilences, cutSourceRange, removeFillers, trimToRange }
   - `SUBTITLE`{ setSubtitleStyle, applyPreset, editCue, splitCue }
   - `OVERLAY`{ addOverlay, updateOverlay, removeOverlay, clearOverlaysByKind, addKeyframe }
   - `EMPHASIS`{ highlightKeyword, punchInZoom }
   - `COLOR`{ applyColorPreset/LUT }
   - `AUDIO`{ normalize, duck, addBgm }
   - `TEXT`{ applyGlossary }
   - `GENERATIVE`(부작용 격리·content-addressed 캐시){ generateVoiceover, addBroll }
   - 기존 `commands.ts` 3종은 이미 `CommandResult{before,after}`를 반환하므로 **시그니처만 맞추면 reducer로 흡수 — 재작성 불필요.**
2. **Zod를 command별 단일 진실원천으로.** 동사마다 Zod 스키마 1개 → (a) core reducer의 TS 타입, (b) command 경계의 `safeParse` 런타임 가드(granular ZodError를 에이전트에 피드백해 자가수정), (c) `z.toJSONSchema()`로 tool/MCP 매니페스트 파생. → **core/GUI/agent/MCP 간 스키마 드리프트 0.** Zod는 순수 TS라 dependency-cruiser 통과.
3. **UI 리팩터.** `store.ts`는 core reducer를 dispatch만 하는 얇은 디스패처로. **사람 GUI와 AI 에이전트가 정확히 같은 command bus를 구동.**
4. **에이전트 루프 = plan-and-execute + re-plan gate + dry-run 승인 (LAVE 검증 UX).** 플래너 LLM에 tool 매니페스트 + **압축 상태요약**(전체 전사 아님 — 단어수·무음수·길이·챕터목록만)을 주고 검증된 EditCommand 순서 리스트를 받음. 각 command Zod 검증→실패 시 re-plan, clone EditorState에 dry-run하여 diff(removedProgramUs, 변경 cue 수, before/after 길이, 컷될 단어)를 사용자에게 표시, 이상치 시 re-plan gate로 일시정지·에스컬레이션. 승인 시 commit + **append-only 해시체인 audit log.** **로컬 LLM 우선**(llama.cpp sidecar를 whisper.cpp 패턴 재사용, GBNF/JSON-schema 제약 디코딩으로 malformed plan 원천 차단). `PlanProvider` 인터페이스로 클라우드 모델 opt-in drop-in.
5. **MCP 노출.** command 레지스트리를 (a) 번들 로컬 에이전트용 in-process tool registry와 (b) 외부 에이전트용 선택적 MCP 서버로 동시 노출. `tools/list` = `z.toJSONSchema()` + annotation(read-only/destructive/idempotent/generative), `tools/call` = Zod 검증 후 reducer 디스패치, read-only resources로 상태요약 노출. **selector tool**(`findWords(query)` / `findSilences(minMs)`)로 자연어 참조를 wordId 범위/구간으로 해소 → LLM이 µs 산술 대신 핸들로 작업.

**EDL 일반화:** `timelineToEdl(timeline, mediaPath)`·단일 비디오트랙을 **멀티트랙·멀티소스 + Clip에 `effects[]`(zoom/colorgrade/volume/transform)·transition을 담는 'effect-aware IR'**로 확장, OTIO export 어댑터 추가. 렌더 백엔드는 이 IR만 소비 → **프리뷰=익스포트 일치를 단일 IR 공유로 구조화.**

---

## 6. 로드맵 (Phase별 — 1차 목표: 오픈소스 CapCut + NL 편집)

### Phase 0 — 마케팅 토대 + 와우 데모 제품화 _(1~2주, 엔지니어링과 병행)_

**Goal:** 지금 상태(PoC)로 즉시 런칭 가능하게 만들고, ROI top3 중 즉시 가능한 것을 원클릭 프리셋으로 제품화해 공유 가능한 자산을 만든다.

- README를 랜딩페이지로 재작성: 데모 GIF(원본 → 자연어 한 문장 → 타이트한 자막 컷), 3불릿 배지행(no cloud / no watermark / no subscription, MIT), 60초 퀵스타트, star-history 배지.
- 히어로 데모 클립(<30s, 한국어 내레이션 포함): 키워드강조자막 + 무음컷 + (가능하면) 펀치인줌을 한 문장으로.
- 키워드강조자막을 원클릭 프리셋으로 제품화(이미 어절/per-cue 보유 — ROI top3 중 가장 즉시 가능). Awesome-self-hosted/OSS-alternatives 등재.
- 포지셔닝 카피 확정: **CapCut-ToS 해독제를 리드 메시지로.** 'open-source CapCut'은 OpenCut 소유이므로 **'local-first AI editor that edits by text and prompt'를 소유.**

### Phase 1 — 코어 command bus + Zod + 불변식 게이트 _(AI 없음, 순수 엔지니어링) · 키스톤_

**Goal:** store/ui에 흩어진 편집 동작을 core의 직렬화 가능한 EditCommand로 끌어올리고, 단일 디스패처 + Zod 스키마 + 적용후 검증 게이트를 완성. **비전 전체의 키스톤이며 AI 없이도 UI 스토어가 깨끗해지는 즉시 이득.**

- `EditorState{timeline,transcript,overlays,subtitleStyle,glossary}` 정의 + `applyCommand(state,cmd):CommandResult` 단일 디스패처 신설(`types.ts` 유니언 확장).
- 기존 cut 3종 흡수 + 신규 reducer: SUBTITLE / OVERLAY / EMPHASIS(highlightKeyword) / TEXT(glossary) / CUT(removeFillers, trimToRange) — `store.ts`의 `addOverlay*` / `setSubtitleStyle` / `applyGlossaryNow` / `removeFillers`를 core로 이전.
- 각 command Zod 스키마 1개 → TS타입 + safeParse 가드 + `z.toJSONSchema()` 파생.
- `store.ts`를 dispatch-only 얇은 디스패처로 리팩터(사람 GUI = 첫 command bus 소비자).
- 적용후 `validateEdl()` + property 불변식을 자동 post-condition 게이트로 표준화(위반 시 reject/rollback).

### Phase 2 — dry-run/diff/commit 파이프라인 + audit log + ROI top3 완결

**Goal:** AI 없이도 '편집 미리보기/되돌리기' UX를 강화하고, 줌/색보정 렌더 파이프라인을 깔아 와우 top3를 모두 실재 기능으로.

- dry-run(clone state 적용·비커밋) + diff 표면(removedProgramUs, 변경 cue, before/after 길이) — `CommandResult.before`가 이미 기반.
- append-only 해시체인 command audit log(결정적 replay/undo/세션 export 겸용, `history.ts` 위에).
- 펀치인줌·색보정/LUT 실제 렌더 파이프라인 구현(EDL을 effect-aware로 확장하는 1단계): Clip에 `effects[]` 필드, ffmpeg 필터 매핑.
- 프리뷰=익스포트 일치를 effect-aware EDL 단일 IR 공유로 구조화(줌/색보정 격차 방지).

### Phase 3 — 로컬 LLM 플래너 + 에이전트 루프 _(자연어 편집 MVP · 핵심 차별화)_

**Goal:** 자연어 요청을 받아 검증된 EditCommand plan을 생성·dry-run·승인·커밋하는 루프를 100% 로컬로 완성. **클라우드 SaaS가 못 주는 '프라이버시+에이전트' 조합의 단독 점유 지점.**

- llama.cpp sidecar(whisper.cpp IPC 플러밍 재사용) + Qwen급 instruct 모델, GBNF/JSON-schema 제약 디코딩으로 malformed plan 원천 차단.
- plan-and-execute + re-plan gate(이상치 시 일시정지/에스컬레이션) + LAVE식 dry-run 승인 UX.
- selector tool(`findWords(query)` / `findSilences(minMs)`)로 자연어→wordId범위/구간 해소 — LLM을 µs 산술에서 분리.
- `PlanProvider` 인터페이스(로컬 기본, 클라우드 opt-in drop-in) + 압축 상태요약(전체 전사 미주입).

### Phase 4 — MCP 서버 + OTIO + 멀티트랙 일반화 _(범용 오픈소스 CapCut 완성)_

**Goal:** 외부 에이전트가 dawn-cut을 구동하게 하고, 범용 NLE에 필요한 멀티트랙/멀티소스 모델과 산업표준 상호운용을 갖춘다.

- command 레지스트리를 MCP 서버로 래핑(`tools/list`=z.toJSONSchema()+annotation, `tools/call`=Zod검증→reducer, read-only resources=상태요약).
- `TimelineModel`을 멀티트랙·멀티소스(B-roll 컷어웨이/PIP/음악 트랙) + Clip별 effects/volume/transform로 일반화 — `rebuildGapless` 단일트랙 가정 해제.
- EDL을 OTIO 시맨틱(멀티트랙·마커·per-clip 메타)으로 확장 + OTIO export 어댑터(Premiere/Resolve/FCP 상호운용).
- AUDIO 동사(normalize/duck/addBgm) + 전환(크로스페이드) reducer로 편집 어휘 완성.

### 다음 구체 액션 (Phase 1 키스톤 수직슬라이스)

`packages/core/src`에 `applyCommand(state: EditorState, cmd: EditCommand): CommandResult` 단일 디스패처와 `EditorState` 타입을 신설하고, 기존 `commands.ts`의 `cutSourceRange` / `deleteWordRange` / `removeSilences` 3종을 라우팅하도록 흡수(이미 순수함수 + `CommandResult{before,after}`라 시그니처만 맞추면 됨). 동시에 **첫 EditCommand로 `store.ts`에 실재하는 액션(`removeFillers` 또는 `applyGlossaryNow`)을 core reducer로 끌어올리고**, 그 command의 Zod 스키마 1개로 (a) TS타입 (b) safeParse 가드 (c) `z.toJSONSchema()` 파생이 한 소스에서 나오는 패턴을 확립. 적용 직후 `validateEdl()`+불변식을 post-condition으로 호출해 **'dispatch→검증→undo' 루프 골격을 1개 동사로 끝까지 관통.** 이 수직슬라이스가 향후 모든 동사·tool·MCP가 복제할 템플릿이 된다. (ROI top1인 `highlightKeyword`(키워드강조자막)는 `store.ts`에 아직 없으므로 '이전'이 아니라, 이미 보유한 어절 타임스탬프/per-cue 자막 인프라 위에 **신규 reducer로 처음부터 구현**한다.) **AI는 일절 건드리지 않는다.**

---

## 7. 측정 지표 (Metrics)

### 7.1 North Star

> **승인된 자연어 편집 커밋 수** (NL request → dry-run → 사용자 승인 → commit 완료 건수). 축 A·B를 동시에 검증하는 단일 지표.

### 7.2 Phase별 게이트 지표

| Phase | 핵심 지표 | 합격선(예시) |
| --- | --- | --- |
| 0 | GitHub stars, 데모 클립 조회·공유, OSS 리스트 등재 수 | 첫 wow 데모 공개 후 stars 가속 |
| 1 | core로 이전된 동사 수 / store에서 제거된 명령형 액션 수, 모든 command Zod-검증 커버리지, post-condition 게이트 통과율 | 100% command Zod 검증 · 불변식 위반 0 |
| 2 | dry-run diff 정확도(예측 removedProgramUs vs 실제), **프리뷰=익스포트 픽셀/타이밍 일치율** | WYSIWYG 회귀 0 |
| 3 | NL→유효 plan 성공률, re-plan gate 발동/회피율, **plan 적용 결정성(동일 입력 재현율)**, 로컬 LLM tool-call 정확도 | 결정적 재현 100% · plan 1-shot 유효율 목표치 |
| 4 | MCP `tools/call` 성공률, 멀티트랙 EDL 불변식 통과, OTIO 라운드트립 손실 | OTIO export 후 재import 정보손실 0 |

### 7.3 품질·신뢰 지표 (상시)

- **결정성:** 동일 EditCommand 시퀀스 → 동일 EDL/렌더 (property test).
- **검증성:** 적용후 `validateEdl()` + T-INV/SYNC-INV/EDL-INV 위반 0.
- **한국어 STT 품질:** WER (Vrew 동급 ~13.4% 목표), 어절 경계 정확도.
- **프라이버시 보증:** 네트워크 송신 바이트 = 0 (로컬 모드 기본).
- **에이전트 안전:** 이상치(removeSilences 80% 삭제, trim이 타임라인을 비움 등) re-plan gate 포착률.

---

## 8. 리스크와 헤지

| 리스크 | 내용 | 헤지 |
| --- | --- | --- |
| **과대주장** | '자연어로 전문 편집가처럼'은 2026 default 기대치지만 LAVE조차 trim 정밀도 1초·환각 한계 보고. '완전 자율' 마케팅은 신뢰 붕괴. | 항상 **'AI가 제안 → 당신이 EDL/타임라인 확인·승인 → 렌더'**로 프레이밍(블랙박스 아님). |
| **OpenCut 잠식** | OpenCut(45K stars, Vercel/fal.ai 후원, 90+ 기여자)이 STT/에이전트 레이어를 붙이면 포지션 잠식. | UI로 싸우지 말고 **'결정적 EDL + property test + 데이터계약'의 검증가능 신뢰성**을 추가 해자로. 극단적으로 dawn-cut core/EDL/MCP를 OpenCut 같은 프론트가 호출하는 **'편집 두뇌 레이어' 상호운용** 헤지. |
| **한국어 STT 품질** | 핵심 세그먼트가 Vrew의 한국어 자막 UX 완성도에 밀리면 비치헤드 상실. | 어절 처리/자막 프리셋 다양성 지속 투자, **동급 데모 공개 검증.** |
| **실현 비용** | 멀티트랙 일반화(Phase 4)는 `rebuildGapless`의 단일트랙·gapless 가정 해제 — 비용 크고 불변식 재설계 필요. | **Phase 1~3(기존 자산만으로 즉시 가능, 저위험) 먼저 완결**, 모델 변경은 마지막. |
| **로컬 LLM 한계** | VRAM 초과 컨텍스트에서 tool-call 정확도 급락. 전체 전사 주입 시 즉시 한계. | **압축 상태요약 + selector tool**로 컨텍스트 작게 유지, GBNF로 형식 오류 원천 차단, 의미 정확도는 re-plan gate로 보완. |
| **지속가능성(BMG)** | '무료 OSS' 수익모델 부재. | OpenCut식 커뮤니티/후원 또는 **로컬-퍼스트 프로기능 유료화** 조기 검토(코어는 영원히 무료·로컬). |
| **프리뷰=익스포트 분기** | 프리뷰(HTML5 seek+DOM canvas)와 익스포트(ffmpeg filter_complex)가 별도 경로. 줌/색보정 추가 시 WYSIWYG 붕괴 → AI 자율편집 신뢰 붕괴. | **effect-aware EDL 단일 IR을 양쪽이 공유**하도록 Phase 2에서 구조화. |

---

## 9. 리서치 출처 (References)

- **CapCut ToS / 데이터 주권:** mediapost.com (`/article/403907/bytedances-capcut-must-face-privacy-suit.html`), 2b-advice.com (`/2025/07/04/capcut-trouble-over-new-terms-of-service`), natlawreview.com (`/article/behind-filters-capcut-and-tiktok`)
- **Vrew 가격/한국어:** vrew.ai/en/payment/pricepolicy, vrew.ai/en/terms-of-service, filmora.wondershare.kr
- **whisper large-v3-turbo / 로컬 STT:** whispernotes.app/blog/introducing-whisper-large-v3-turbo, openwhispr.com/blog/local-vs-cloud-transcription
- **OpenCut:** opencut.dev, design-drifter.com (`/2025/09/23/opencut-...`), github.com/KinanCodeaz/opencut, themenonlab.blog
- **Descript 가격 개편:** eesel.ai/blog/descript-pricing, cotovan.com/post/descript-pricing-media-minutes-ai-credits-topups, trebble.fm/post/descript-pricing-september-2025
- **AI 자동편집 SaaS:** opus.pro/pricing, submagic.co/vs/submagic-vs-gling, submagic.co/apps/gling, trustpilot.com/review/submagic.co
- **2026 NL 편집 트렌드 / video-MCP:** loopdesk.ai/blog/ai-video-editing-trends-2026, github.com/KyaniteLabs/mcp-video, arxiv.org/html/2603.09072v1
- **Kapwing 무료티어:** fluxnote.io/guides/kapwing-pricing-2026, kapwing.com/help/is-kapwing-free
