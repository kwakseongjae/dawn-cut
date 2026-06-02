# dawn-cut 최종 검수 가이드 (REVIEW)

> 이 문서 하나로 **무엇을 어떻게 검수하고, 무엇을 결정할지** 알 수 있게 정리했다.
> 모든 판정은 repo 코드·테스트·산출물을 직접 읽고 교차검증한 결과다(근거: `파일:라인` / 커밋 / `output/` 경로).
> 검증 기준 커밋: HEAD = `fc23f41` (`feat(ui): productize wow features ...`). 작업트리 클린.

---

## 1. 한눈에 현황

- **완성·동작(코어 + 라이브앱):** 명령 버스 단일 변경점(GUI·LLM·MCP 공유) + Zod 단일 진실원천 + dry-run 원자성 + append-only 감사로그. 자동 자막(STT→짧은 cue→**단어별 reveal/karaoke 애니**)이 앱 `doBurn`에 실제 배선됨. 색보정 6프리셋(**vivid 1탭이 실제로 가장 강함, saturation 1.60**). 스타일 팩 6종 = `EditCommand[]` plan(코드 아님)으로 GUI 1선택·LLM·MCP가 공유. 로컬 llama.cpp 플래너(상주 서버) + rule-planner 폴백. MCP 헤드리스 서버(7 tool).
- **검증 상태:** `pnpm test:unit` = **339 passed (32 files)**, `pnpm test:int` = 27, e2e 7 spec. lint 0 error(경고 13), boundary 0 violation. (CLAUDE.md의 "341"은 실측 339와 2건 드리프트 — 사소.)
- **미구현(정직):** 적응형 auto-enhance(signalstats), 9:16 자동 리프레이밍, 전환(xfade), 비트싱크, B-roll 자동, 얼굴추적. MCP는 `.dawn` 파일 헤드리스 전용(라이브 Electron 브리지·render/export tool 없음).
- **최대 리스크(출시 블로커):** **라이브 앱 스타일 팩이 "진짜 1클릭"이 아니다** — 팩 선택 시 색/말버릇/자막스타일은 적용되지만 **자막 번인(`doBurn`)을 호출하지 않아 간판 기능인 reveal/karaoke 자막이 화면에 안 나타난다.** 데모는 완벽, 실앱은 반쪽. (근거 §3-UX, §5)

---

## 2. ★ 직접 보기 가이드 (사용자가 봐야 할 것)

### (a) 산출물 eyeball — `output/` 무엇을 보면 무엇을 확인하나

| 보기 | 파일 | 여기서 확인할 것 |
|---|---|---|
| **자동 자막 reveal(간판)** | `output/packs/cook-viral-punch.mp4` / `.gif`, `output/gallery/cook-after.mp4`, `output/gallery/cook-anim-compact.gif` | raw 음성 → STT → 짧은 cue → **단어별 누적 등장**("일본에서는"→"…국민음식으로"→"통삼겹살") + 키워드 강조. dawn-cut의 유일·최강 차별점. |
| **1클릭 스타일 팩** | `output/packs/cook-viral-punch.mp4`, `output/packs/cook-mukbang-sizzle.mp4`, `*-compact.gif` | 한 팩이 색(vivid/warm)+자막스타일+애니+말버릇을 묶어 적용한 결과. (단, 이건 **데모 파이프라인** 산출물 — 라이브앱 1클릭 갭은 §5 참조) |
| **색보정 6장르 before/after** | `output/gallery/{scenic,city,beauty,food,pet,cook}-before-after.gif` / `.mp4` | 6장르 색 적용. **주의:** 6장 중 자막은 cook 1장뿐, 나머지 5장은 색보정만(scenic=cinematic, city=punch, beauty/pet=warm, food=vivid). food(저조도 먹방)는 vivid라도 체감 리프트가 modest — 밝은 소스에서 vivid 임팩트가 큼. |
| **자연어 편집(LLM/룰)** | `output/llm/llm-before-after.mp4` + `output/llm/plan.md`, `output/nl/cinematic-before-after.mp4` + `output/nl/plan.txt` | 자연어 입력 → 플래너가 뽑은 EditCommand plan → 적용 결과. plan.md/txt에 무엇을 어떻게 계획했는지 트레이스. |
| **외부 AI(MCP) 트레이스** | `output/mcp/session-log.md`, `output/mcp/edited.dawn`, `output/mcp/edited.mp4` | 외부 AI가 open→manifest→dry_run→apply→save tool로 같은 command bus를 구동한 전체 로그. **헤드리스(.dawn 파일)** 동작 확인. |
| **자동 자막(한국어 풀체인)** | `output/korean/subtitled.mp4`, `subtitled-preview.gif`, `subtitles.srt`, `transcript.txt`, `chapters.txt` | 한국어 STT→자막 번인+SRT/챕터 산출. CJK 자막 품질 육안 확인. |
| **쇼케이스 종합** | `output/showcase/` (talk/food before-after, `frame-*.png`, `nl-real.md`) | 실제 유튜브 숏 → 자동자막+색+LLM 편집 통합 데모 + 추출 프레임. |

> 참고: `output/sources/`(yt-dlp 받은 실제 유튜브)·`vendor/`(whisper/llama/모델)는 **테스트 전용, gitignore(미배포)**. 산출물 재생성에는 로컬 에셋/모델 보유가 필요.

### (b) 직접 실행

```bash
# 1) 전체 검증 (lint→boundary→build→unit→e2e→int). exit 0 = green.
pnpm verify
# 개별: pnpm test:unit (339) / pnpm test:int (27) / pnpm test:e2e (7, whisper 바이너리 있을 때만 전부 실행)

# 2) 산출물 재생성 (output/ 갱신). 외부 에셋/모델 없으면 해당 demo는 skip됨.
pnpm demo:run                 # vitest demo (gallery/llm/nl/mcp/showcase/style-packs ...)
pnpm demo:ui                  # playwright demo (UI 스펙)

# 3) 라이브 앱 실행 (Electron)
pnpm --filter @dawn-cut/desktop dev      # = electron-vite dev
# 빌드/패키징: pnpm --filter @dawn-cut/desktop build  /  dist:mac
```

**앱에서 손으로 확인할 흐름:** 클립 import → (자막 쓰려면) 자막 입히기/STT → **스타일 팩 1클릭(상단 🎨 select)** → 색/말버릇 적용 확인 → **자막 입히기 버튼으로 reveal/karaoke 번인** → export.
> ★여기서 확인할 것: 스타일 팩만 선택했을 때 **자막 애니가 자동으로 화면에 뜨지 않는다**(§5 결정 항목). 팩 선택 후 자막 번인을 별도로 눌러야 reveal가 보인다.

### (c) 읽을 문서

| 문서 | 여기서 확인할 것 |
|---|---|
| `docs/SHOWCASE-REPORT.md` | 와우 평가·격차·프로덕션 추천(의사결정 핵심). **단 본문 §2/§3/§5는 cinematic을 "코드 1.2로 약함"이라 서술하나 코드는 이미 1.30/0.70로 고쳐짐 — 상단 배너만 정정됨, 본문 스테일**(§3-정직성). |
| `docs/P3-LLM-SIDECAR.md` | 로컬 LLM 플래너 설계(상주 서버, few-shot, GBNF, rule 폴백). |
| `docs/P4-MCP.md` | MCP 7 tool 설계 + **헤드리스 .dawn 한정·라이브브리지/render는 후속**임을 명시(정직). |
| `docs/ARCHITECTURE.md` | 명령 버스·불변식·Zod 단일진실원천 전체 설계. |
| `README.md` | **주의: NL/MCP 레이어를 "0% built·roadmap"이라 서술(스테일·과소평가)** — 이미 구현·테스트 통과됨(§3-정직성). |

---

## 3. 차원별 감사 요약

### [Architecture] — 견고. 설계 의도대로 구현됨.
- **단일 변경점이 실제 단일.** `applyCommand`(`edit-command.ts`)가 유일 디스패처. GUI(`store.ts`)·MCP(`session.ts`)·이펙트까지 우회로 없이 verb로 흐름. boundary 0 violation(97 모듈).
- **불변식 게이트:** parse(Zod)→reduce→`validateState`→위반 시 throw. 오염 상태 반환 불가. **dryRun 원자성:** 하나라도 throw 시 부분 적용 노출 안 함.
- **Zod 3-way 파생(타입/런타임가드/MCP JSONSchema)** — MCP 매니페스트가 코드와 드리프트 불가.
- **core 순수성 경계** 강제(electron·fs·child_process 금지, type-only까지 검출) — 통과.
- **발견 결함:** **R1(중) 감사 해시체인이 undo/redo와 desync** — `store.undo/redo`가 timeline은 되돌리나 `auditLog`는 안 건드림 → 감사로그가 "현재 상태로 이어지는 시퀀스"를 더는 나타내지 않음(무결성 검사는 여전히 true). **재생(replay) 소스로 과신 금지.** R2(중) 해시가 `JSON.stringify` 키순서 의존(cross-process 검증 불안정). R5(낮) approvePlan/applyStylePack/session.apply 3곳 원자성 처리 미묘 차이.

### [Test-coverage] — verify green(339/27/7), 단 구조적 공백 3.
- doBurn 애니 코드·captionFrames 단위테스트(`subtitles.test.ts:109`)·STYLE_PACKS 단위테스트(`templates.test.ts` 14)·effects 6프리셋 단위테스트 모두 실재.
- **공백 (a) store(Zustand) 유닛테스트 0건** — ~30개 액션이 e2e로 transitive 커버만. **(b) 자막 애니(reveal/karaoke) 통합/e2e 회귀 안전망 부재** — e2e `subtitle-burn.spec.ts`는 'none' 정적 경로만 픽셀 검증. **(c) 실제 LLM 추론은 verify 밖**(planner.test=mock, int=가짜 llama-server, 진짜 1.5B는 skip 데모뿐).
- e2e 7건은 whisper 바이너리 있을 때만 전부 실행(없으면 6건 조용히 skip) — 환경 의존 커버리지.

### [Honesty] — 기능 주장은 거의 다 사실. 결함은 **문서 스테일 2건**.
- 사실 확인: 자막 애니 앱 연결, 'none' 보존, vivid 강함(sat 1.60), cinematic 정렬(1.30/0.70 코드), 스타일팩 command-bus 공유, LLM 라이브+rule 폴백, MCP 7 tool — **모두 코드로 사실.**
- **① README가 자기 NL/MCP 레이어를 "0% built·roadmap"이라 부정(`README.md:132-133`, Phase 1~4를 미래작업으로)** — 이미 구현·테스트됨. 역방향 스테일(과소평가). 외부 검수자가 README만 보면 핵심 차별자 없다고 오판.
- **② SHOWCASE-REPORT 본문이 "cinematic 코드 1.2로 약함"이라 단언(`:32,:50,:102`)** — 코드는 이미 1.30/0.70. 상단 배너(`:9`)만 정정 → 한 문서 안에서 모순.

### [UX·Competitive] — 코어는 강하나 라이브 배선에 P0 갭.
- 와우 지점: 자동 자막 reveal = 유일·최강 차별점. vivid 1탭 실제 강함(소스 의존). 스타일 팩 = plan 추상화 깔끔.
- **★P0 출시 블로커:** **라이브 앱 `applyStylePack`가 doBurn/scheduleReburn을 호출 안 함**(`store.ts:792` 주석 "자막 번인은 별도", `index.tsx:1306-1313` onChange가 `applyStylePack(id)`만 호출). → 팩 선택해도 reveal/karaoke 자막이 화면에 안 뜸. e2e(`style-pack.spec.ts`)는 audit +3건만 보고 번인 미검증이라 이 갭이 안 잡힘.
- **P0~P1:** 데모 갤러리 6장 중 자막은 cook 1장뿐(나머지 5장 색보정만, `gallery.test.ts:43~`) → 첫인상 약함. **P1:** 9:16 자동 리프레이밍 없음, 자막 safe-area 여백 프리셋 없음(`store.ts subtitlePos`, `draw.ts cy=h*0.6` 고정).

---

## 4. 알려진 한계·리스크 (정직)

| 항목 | 상태 | 근거 |
|---|---|---|
| **데모-라이브 갭(P0)** | 데모 산출물은 완벽 reveal 번인, **라이브앱 스타일팩은 자막 재번인 미연결** | `store.ts:792`, `index.tsx:1306` |
| **MCP = .dawn 헤드리스 한정** | 라이브 Electron 브리지 없음, **render/export tool 없음**(7 tool뿐) | `apps/mcp/src/mcp-server.ts`, `docs/P4-MCP.md:94` |
| **로컬 LLM 1.5B 정확도** | 무의미 입력 과잉생성·일부 오답 — **승인 카드가 안전장치**. verify는 mock만, 진짜 추론 미게이트 | `planner.ts:62~`, `tests/demo/llm-edit-demo.test.ts`(skip) |
| **색보정 강도/적응형** | vivid는 강하나 **고정강도(적응형 아님)** — 저조도 소스(food)는 리프트 modest | `effects.ts:120`, `output/gallery/food-*` |
| **rule-planner vivid 미도달** | NL 룰 경로 `ColorPreset`에 vivid 제외 → 룰 NL로는 vivid 불가(GUI/팩/LLM만 가능) | `rule-planner.ts:17` |
| **미구현** | 적응형 auto-enhance(signalstats)·9:16 리프레이밍·전환·비트싱크·B-roll·얼굴추적 = 전부 없음 | `SHOWCASE-REPORT.md:50~`, grep 0건 |
| **store 유닛테스트 0** | Zustand store 액션 직접 테스트 없음(e2e/데모만 transitive 커버) | `packages/ui`에 `*.test.ts` 부재 |
| **감사로그 ≠ 재생 소스** | undo/redo와 desync(R1), 키순서 의존(R2) | `store.ts:undo/redo`, `audit.ts:hashInput` |
| **문서 스테일** | README "0% built"(과소), SHOWCASE 본문 cinematic "1.2"(코드와 모순) | `README.md:132`, `SHOWCASE-REPORT.md:32/50/102` |
| **에셋 미배포** | sources(유튜브)·vendor(모델)는 gitignore — 재현은 로컬 에셋 보유 종속 | `.gitignore` |
| **테스트 수 드리프트** | CLAUDE.md "341" vs 실측 **339** | `pnpm test:unit` |

---

## 5. ★ 사용자가 결정할 것 (의사결정 항목 + 추천 디폴트)

| # | 결정 항목 | 추천 디폴트 | 근거 |
|---|---|---|---|
| **D1** | **라이브 스타일팩 1클릭 갭을 출시 전에 메울 것인가** | **YES(출시 블로커).** `applyStylePack` 끝(또는 onChange)에서 `clearOverlaysByKind('subtitle')`+`doBurn(subtitlePos, packStyle)` 자동 호출 + e2e에 자막 번인 검증 추가 | 데모-라이브 갭. P0. `store.ts:792`/`index.tsx:1306` |
| **D2** | **프로덕션 1차 기능 셋** | (1) 자동 자막 reveal/karaoke (2) 스타일 팩 1클릭(D1 포함) (3) vivid 1탭 색보정. **전환/비트싱크/B-roll은 1차 제외** | 셋 다 코어 견고·결정적·테스트 두터움. 나머지는 신규 엔진 필요 |
| **D3** | **모델 크기 1.5B vs 7B** | **1.5B 유지 + 승인 카드 필수.** 정확도 한계는 카드로 방어, 웜 속도 이점. 7B는 옵션(고사양 사용자) | `planner.ts` few-shot이 1.5B 오답 직접 교정, 승인 카드 안전장치 |
| **D4** | **MCP 범위: 파일(.dawn) vs 라이브 브리지** | **파일 헤드리스 유지(1차).** 라이브 Electron 브리지·render/export tool은 후속 로드맵 | 헤드리스가 결정적·안전. `docs/P4-MCP.md:94`도 후속으로 명시 |
| **D5** | **색보정 강도·기본 프리셋** | **기본 = vivid(1탭 화사).** 단 **콘텐츠 적응형 강도(signalstats)는 후속.** rule-planner에도 vivid 매핑 추가 검토 | vivid가 가장 강함(`effects.ts:120`), 저조도는 적응형 없으면 modest(D5 후속) |
| **D6** | **자막 기본 애니** | **기본 = reveal(누적 등장).** 'none' 정적은 옵션으로 보존(번인 e2e 호환) | 간판 기능, 가독성 양호. captionFrames 단위테스트 존재 |
| **D7** | **더미→실배포 에셋 정책** | **vendor/모델·sources는 계속 gitignore. 배포용 라이선스-클린 샘플 에셋 별도 준비** | 유튜브 소스는 테스트 전용. 배포 갤러리는 자막 reveal 클립 2~3장 추가 권장 |
| **D8** | **9:16 자동 리프레이밍 / safe-area** | **safe-area 여백 프리셋 + 정적 center-crop 9:16 verb부터(얼굴추적은 후순위)** | 한국 숏폼 최소 진입 요건. 현재 미구현 |
| **D9** | **문서 정정** | **즉시: README "0% built" 갱신 + SHOWCASE 본문 cinematic 1.30 정정 + 테스트수 339 정정** | 사실 왜곡(과소/모순) — 외부 검수자 오판 방지 |

---

## 6. 다음 단계 권고 (우선순위)

**P1 (출시 직전 필수 — 모두 배선/큐레이션 작업, 신규 엔진 아님 → ROI 높음)**
1. **D1: 라이브 스타일팩에 자막 자동 재번인 연결** + e2e 자막 번인 검증 추가. ("와우 productize"의 마지막 1cm)
2. **D9: 문서 정정 3건**(README 0%, SHOWCASE cinematic, 테스트수). 즉시·저비용.
3. **store 액션 유닛테스트 추가**(applyStylePack/undo·redo/doBurn 트리거) — R1·R3 회귀 방어.
4. **데모 갤러리 재구성** — 자막 reveal 클립 2~3장 추가, vivid는 밝은 소스로 임팩트 가시화.

**P2 (1차 출시 후)**
5. **D5 적응형 색강도(signalstats)** + rule-planner vivid 매핑.
6. **D8 safe-area 프리셋 + 정적 center-crop 9:16 verb.**
7. **R1 감사로그 재생 정책**(reverse/compensating 엔트리 or truncate) + R2 정규화(키 정렬) 직렬화 — cross-process/replay 토대.
8. 전환·비트싱크·B-roll·얼굴추적·MCP 라이브 브리지/render(D4 후속) = 신규 엔진, 로드맵 후반.

---

### 핵심 파일(절대경로)
- `packages/core/src/edit-command.ts` (applyCommand 단일 디스패처)
- `packages/core/src/effects.ts` (cinematic:117 / vivid:120)
- `packages/core/src/subtitles.ts` (captionFrames:111)
- `packages/ui/src/store.ts` (applyStylePack:792 — 번인 미호출)
- `packages/ui/src/index.tsx` (doBurn:1160 / 팩 onChange:1306)
- `packages/core/src/rule-planner.ts` (ColorPreset:17 — vivid 제외)
- `apps/mcp/src/mcp-server.ts` (7 tool, render/export 없음)
- `tests/demo/gallery.test.ts` (clip 구성:43 — 6장 중 1장만 자막)
- `docs/SHOWCASE-REPORT.md` (본문 cinematic 스테일:32/50/102)
- `README.md` ("0% built":132)
