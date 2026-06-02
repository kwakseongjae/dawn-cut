# dawn-cut

### 내 영상이 이 컴퓨터를 절대 떠나지 않는 오픈소스 영상 편집기.

문서 편집하듯 영상을 편집하세요 — **자동 자막, 텍스트 기반 컷편집, 자동 무음 제거까지
100% 로컬.** 클라우드 없음, 계정 없음, 워터마크 없음, 구독 없음.

<p>
  <img alt="100% local" src="https://img.shields.io/badge/100%25-local-2ea44f">
  <img alt="no watermark" src="https://img.shields.io/badge/no-watermark-2ea44f">
  <img alt="no subscription" src="https://img.shields.io/badge/no-subscription-2ea44f">
  <img alt="no account" src="https://img.shields.io/badge/no-account-2ea44f">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue">
</p>

[English](README.md) · **한국어**

> **상태: v0.1.** 결정적(deterministic) 편집 코어는 실제로 동작하고, 테스트되어 있으며,
> 바로 쓸 수 있습니다 — 텍스트 기반 컷, 무음 제거, 한국어 자동 자막, **1탭 적응형 자동
> 보정**, **저신뢰 자막 검수·교정**, 색보정, 9:16/1:1 리프레이밍, 이미지/스티커/GIF 오버레이,
> 1클릭 스타일 팩, TTS, SRT/챕터 내보내기까지 전부 100% 로컬입니다. 자연어 AI 편집과 헤드리스
> **MCP** 에이전트 서버도 로컬에서 동작하지만, **"실험적(experimental)"으로 표기**해서 냅니다 —
> 모델을 한 번 받아야 하고 아직 다듬는 중이기 때문입니다. 모든 것을 정직하게 라벨링합니다:
> [지금 되는 것](#지금-되는-것) · [실험적 기능](#실험적-기능-opt-in) · [로드맵](#로드맵).

---

## 데모

<!-- TODO(release): 라이선스-클린 히어로 GIF(원본 → 자막+색보정 컷)를 assets/hero.gif에 추가 후 복원 -->
_(첫 릴리스와 함께 데모 GIF 추가 예정 — `docs/PRODUCTION.md` 참고)_

> 실제 `whisper.cpp` + FFmpeg로 끝까지 돌린 재현 가능한 결과가 [`demo-output/`](demo-output/README.md)에
> 있습니다: 23.6초 영어 내레이션 클립을 전사 → 텍스트 편집 → 무음 제거(17.3초) → 끌 수 있는
> 소프트 자막 트랙 + SRT + 재사용 가능한 `.dawn` 프로젝트로 내보냅니다. 재생성:
> `pnpm demo:assets && pnpm demo:run && pnpm demo:ui`.

---

## 왜 dawn-cut인가

흔한 "AI 영상 편집기"는 당신이 정말 원하는 두 가지 — *프라이버시*와 *AI 도움* — 중 **하나만**
고르게 만듭니다. 클라우드 도구는 당신의 영상을 가져가고, 로컬 도구는 똑똑하지 못하죠.
dawn-cut은 둘 중 하나를 포기하지 않아도 되도록 만들었습니다.

| | dawn-cut | CapCut | Vrew | Descript | OpenCut |
|---|---|---|---|---|---|
| 100% 로컬 실행 | **예** | 아니오(클라우드) | 아니오(클라우드 STT) | 아니오(클라우드) | 예(브라우저) |
| 계정/워터마크/구독 없음 | **예** | 아니오 | 무료 제한 | 크레딧/제한 | 예 |
| 단어 단위 STT + 텍스트 기반 편집 | **예** | 아니오 | 부분적 | 예 | 아니오 |
| 자동 자막(한국어 포함) | **예(로컬)** | 클라우드 | 클라우드 | 클라우드 | 아니오 |
| 결정적·검증 가능한 편집 코어(EDL + 불변식) | **예** | 아니오 | 아니오 | 아니오 | 아니오 |
| 오픈소스 | **예(MIT)** | 아니오 | 아니오 | 아니오 | 예(MIT) |

- **vs CapCut** — 영상이 노트북을 떠나지 않습니다. 텔레메트리 없음, 당신의 얼굴·목소리에 대한
  라이선스를 주장하는 약관 없음, 내보내기 워터마크 없음.
- **vs Vrew** — 비슷한 수준의 한국어 자동 자막(whisper `large-v3-turbo`)을 로컬·무제한·무료로.
  whisper 토큰에서 한국어 *어절*(단어+조사)을 무손실로 재조립합니다 —
  [`whisper.ts`](packages/core/src/whisper.ts) 참고.
- **vs Descript** — "문장을 지우면 영상이 잘리는" 같은 텍스트 기반 편집을, 클라우드·크레딧·업로드
  없이.
- **vs OpenCut** — OpenCut이 범용 수동 타임라인을 차지했다면, dawn-cut은 그것이 남긴 빈자리
  — **단어 단위 STT, 텍스트 기반 편집, 그리고 기계가 운전할 수 있는 결정적 편집 코어** — 즉
  에이전트 편집의 토대를 가져갑니다.

---

## 지금 되는 것

정직한 목록 — 아래 항목은 모두 [`packages/core`](packages/core)에 구현되어 단위/속성 테스트로
검증되거나, Electron UI에 실제로 연결되어 있습니다.

- **단어 단위 전사** — `whisper.cpp`(MIT, 로컬)가 단어별 타임스탬프를 만들고, 한국어 *어절*을
  무손실로 재조립합니다(글자 정확도 검증, mojibake 0).
- **텍스트 기반 편집** — 단어 범위를 지우면 해당 영상이 잘리고 빈틈없이 당겨집니다
  (`deleteWordRange`, `cutSourceRange`).
- **자동 무음 제거** — 무음 구간을 감지해 여유(padding)를 두고 잘라냅니다(`removeSilences`).
- **말버릇 감지** — 보수적인 한국어 말버릇 사전, 정확 일치만(`detectFillers`).
- **자막 정확도 검수·교정** — whisper 토큰 확률에서 신뢰도가 낮은(오인식 가능성 높은) *어절*을
  골라(`lowConfidenceWords`) 대본에서 빨갛게 표시하고, 그 어절들 사이를 점프하며, 더블클릭으로
  바로 고칠 수 있습니다. 교정 내용은 cue/SRT/자막 번인에 자동 반영되고 감사로그에 남습니다
  (`correctWord` verb).
- **1탭 적응형 자동 보정** — 실제 영상을 분석(FFmpeg `signalstats`: 밝기/대비/채도)해 *계산된*
  색보정을 적용합니다 — 어두우면 밝히고, 둔하면 화사하게, 과보정은 절대 하지 않습니다
  (`analyzeVideo` → 순수 `autoEnhanceParams` → `applyAutoEnhance`; 길이 불변, 정확한 수치를
  EDL에 기록).
- **자동 자막** — 살아있는 단어를 프로그램 시간 기준 cue로 묶고, 문장 끝/컷/글자수에서 끊으며,
  단어별 **reveal / karaoke** 애니메이션 + **SRT** 내보내기(`transcriptToCues`, `captionFrames`,
  `formatSrt`).
- **자동 챕터** — 대본에서 룰 기반으로 유튜브 `M:SS 제목` 챕터 목록 생성(`extractChapters`,
  `formatChapters`).
- **내 사전(고유명사 치환)** — 대본 전체에 결정적 용어 치환(`applyGlossary`).
- **색보정** — 6종 프리셋(warm / cool / punch / cinematic / flat / vivid)을 강도(intensity)로
  가중, command bus로 적용 후 FFmpeg `eq`/`curves`로 렌더(`applyColorgrade`, `COLOR_PRESETS`).
- **9:16 / 1:1 리프레이밍** — 가로 영상을 오버레이 좌표까지 맞춘 중앙 크롭으로 세로 쇼츠/정사각
  으로(`cropForAspect`, `renderEdl({ reframe })`).
- **이미지 / 스티커 / GIF 오버레이** — 위치·크기·투명도·z순서·회전·블렌드 모드·다중 키프레임
  모션 경로를 FFmpeg overlay 필터로 **출력 영상에 실제 합성**
  ([`overlay.ts`](packages/core/src/overlay.ts), [`draw.ts`](packages/core/src/draw.ts),
  `renderEdl`).
- **1클릭 스타일 팩** — 6종 장르 프리셋(viral-punch, mukbang-sizzle, beauty-glow, golden-hour,
  city-night, talk-clean)을 *plan*(`EditCommand[]` 묶음)으로 표현 → GUI·LLM 플래너·MCP가 모두
  공유(`STYLE_PACKS`, `templates.ts`).
- **TTS 보이스오버** — 내레이션 합성(macOS `say`) 후 익스포트에 믹스.
- **결정적 EDL 내보내기** — 타임라인이 Export Decision List로 컴파일되고 FFmpeg 사이드카가
  렌더(`timelineToEdl`).
- **대본 ↔ 타임라인 동기화** — 단어와 프로그램 시간의 증명 가능한 양방향 매핑(`wordToProgram`,
  `programToWord`).
- **프로젝트 저장 / 열기** — 버전 관리되는 `.dawn` JSON, 전체 undo/redo
  ([`history.ts`](packages/core/src/history.ts)).
- **Electron 데스크톱 앱** — 미디어 가져오기, 전사, 텍스트로 편집, 스크럽, 라이브 자막
  미리보기, 내보내기.

### 분위기가 아니라 데이터 계약 위에

편집 코어가 해자입니다. 이것은 **순수 TypeScript**라 `electron`, `fs`, `child_process`, `path`를
import할 수 없습니다(`dependency-cruiser`로 강제). 모든 모델은 검증된 불변식의 지배를 받습니다:

- **시간은 정수 마이크로초(µs)**, 구간은 반열린 `[start, end)`.
- `validateSync`가 대본↔타임라인 왕복을 증명(SYNC-INV).
- `validateEdl`이 내보내기 목록의 연속성·총길이 정확성을 증명(EDL-INV).
- `validateCues`가 자막의 순차성·비중첩·범위를 증명(SUB-INV).
- 명령은 `{ before, after, removedProgramUs }`를 반환하는 **순수 함수** → 모든 편집이 undo·replay
  가능.

결정성·검증·undo·헤드리스 실행 — 이 속성들이 바로 AI 편집 에이전트가 필요로 하는 비기능 요구사항
입니다.

---

## 실험적 기능 (opt-in)

아래는 **지금도 로컬에서 끝까지 동작**하지만, 모델을 한 번 받아야 하거나 알려진 한계가 있어
"실험적"으로 표기합니다. 목업이 아니라 진짜이고, 다만 다듬는 중입니다. 의도적으로 켜세요 —
위의 코어는 절대 이들에 의존하지 않습니다.

- **자연어 편집(로컬 LLM 플래너)** — *"말버릇 빼고 시네마틱하게"* 라고 입력하면 로컬 `llama.cpp`
  플래너(기본 **Qwen2.5-1.5B**, Apache-2.0)가 **검증된 `EditCommand` plan**을 만들고, 적용 전에
  dry-run diff로 미리보기합니다. 문법 제약 디코딩(GBNF)으로 스키마를 벗어나지 않게 하며, 모델이
  없으면 결정적 룰 플래너로 폴백합니다. 설치: `pnpm setup:llm`.
  _주의:_ 모델 다운로드 필요, 계획 품질은 1.5B 모델 한계에 묶임, CI는 룰 경로만 검증(LLM 경로는
  수동 확인).
- **MCP 에이전트 서버** — 헤드리스 [Model Context Protocol](https://modelcontextprotocol.io)
  서버(`@dawn-cut/mcp`)로 외부 에이전트(Claude Desktop / Cursor)가 `.dawn` 프로젝트 위에서 **같은**
  command bus를 구동합니다: `open_project → command_manifest → plan → dry_run → apply →
  save_project → render`(9:16/1:1 리프레이밍 포함). 모든 편집이 GUI와 동일한 불변식 + 해시체인
  감사로그를 거칩니다.
  _주의:_ `render`는 아직 자막/오버레이 번인을 포함하지 않습니다(컷+색+줌+리프레이밍만), 워크스페이스
  헤드리스로 실행(`npx` 설치형 bin은 아직 미배포). [`docs/P4-MCP.md`](docs/P4-MCP.md) 참고.

---

## 비전

> **원하는 걸 말하면, AI가 편집을 제안하고, 당신이 타임라인/EDL을 검토한 뒤 렌더한다.** 블랙박스가
> 아니라.

최종 목표는 *"빈 공간 잘라내고 핵심에 자막 달아줘"* 라고 입력하면 LLM이 **검증되고 직렬화 가능한
`EditCommand` 목록**을 내놓고, 결정적 코어가 그것을 적용·렌더하는 편집기입니다 — 먼저 dry-run
diff로 승인받고서요. 코어가 이미 검토 가능한 중간 표현(타임라인 + EDL)을 노출하고 매 단계를
검증하므로, 에이전트의 편집은 불투명하지 않고 재현·자동검증 가능합니다.

이 중 많은 부분이 **이미 만들어졌습니다.** command bus(Zod 파생 `EditCommand` + 불변식 검증 +
해시체인 감사로그), 1클릭 스타일 팩(*plan*으로 표현된 템플릿), 9:16/1:1 리프레이밍은 코어에
실려 있고, 로컬 llama.cpp 플래너(자연어 → plan → dry-run → 승인)와 `render` 도구를 갖춘 헤드리스
**MCP 서버**(외부 AI가 같은 command bus로 `.dawn` 편집)는 [실험적](#실험적-기능-opt-in)으로 함께
냅니다. 아직 남은 것: 앱↔MCP 라이브 브리지, MCP 자막 번인, 전환/비트싱크, 멀티트랙.
[`docs/PRODUCTION.md`](docs/PRODUCTION.md) 참고.

---

## 로드맵

- **Phase 1 — Command bus.** UI에 흩어진 편집 동작을 단일 직렬화 `EditCommand` 유니언 + 단일
  `applyCommand` 디스패처로 모으고, verb마다 Zod 스키마 1개(→ TS 타입 + 런타임 가드 + JSON-Schema
  매니페스트). 매 명령 후 불변식 검증 게이트.
- **Phase 2 — Dry-run / diff / commit + 감사로그.** 복제 상태에서 편집을 미리보고 diff(제거 µs,
  변경 cue, 길이 변화)를 보여준 뒤 append-only 해시체인 로그로 커밋. 펀치인 줌·색보정 실렌더
  (effect-aware EDL) 추가.
- **Phase 3 — 로컬 LLM 플래너(차별점).** `llama.cpp` 사이드카(whisper.cpp IPC 패턴 재사용) +
  문법 제약 디코딩으로 자연어에서 검증된 `EditCommand` plan 생성, dry-run + 승인 + 커밋 —
  100% 로컬.
- **Phase 4 — MCP 서버 + OTIO + 멀티트랙.** 명령 레지스트리를 외부 에이전트용 MCP 서버로 노출하고,
  멀티트랙/다중 소스(B-roll, PIP, 음악)로 일반화하며, Premiere/Resolve/FCP 연동용 OTIO 내보내기 추가.

---

## 빠른 시작

**Node ≥ 20**, **pnpm 10**, (전사용) **cmake** + **FFmpeg** 필요.

```bash
pnpm install            # 워크스페이스 의존성 설치

pnpm verify             # lint + 코어 경계 검사 + 빌드 + 단위 + E2E
                        # (whisper 의존 단계는 자동 스킵; fixture 있으면 통합 테스트 실행)

pnpm setup:binaries     # whisper.cpp 빌드 + 모델 다운로드 (cmake + ffmpeg 필요)
                        # 기본 모델: large-v3-turbo (~1.6GB)
                        # 가벼운 설치: DAWN_WHISPER_MODEL=base pnpm setup:binaries

pnpm make:fixture       # 결정적 테스트 영상 생성 (macOS `say` 사용)
```

그 외 유용한 스크립트: `pnpm test:unit`, `pnpm test:int`, `pnpm test:e2e`,
`pnpm setup:llm`(자연어 편집 활성화, 선택), `pnpm demo:assets && pnpm demo:run && pnpm demo:ui`
(실제 미디어 풀 데모).

---

## 아키텍처

코어에 엄격한 이식성 경계를 둔 3계층:

```
UI / 셸     ──►  편집 코어     ──►  AI / 렌더 사이드카
(Electron, React)  (순수 TS)        (Node 서브프로세스 래퍼)
```

- **`packages/core`** — 이식 가능한 순수 TypeScript 편집 코어: 대본 / 타임라인 / 동기화 / 명령 /
  EDL / 자막 / 오버레이 / 챕터. Node·Electron import 금지(강제). 미래의 에이전트가 운전할 대상.
- **`packages/ui`** — React UI + Zustand 스토어(`@dawn-cut/ui`).
- **`apps/desktop`** — Electron 셸(`@dawn-cut/desktop`).
- **`sidecar/stt`** — `whisper.cpp` 서브프로세스 래퍼, 단어 단위 타임스탬프(MIT).
- **`sidecar/ffmpeg`** — FFmpeg / ffprobe 서브프로세스 래퍼(LGPL, 서브프로세스 호출만).
- **`sidecar/tts`** — TTS(기본 macOS `say` 오프라인, Piper 옵트인).

**EDL**은 *편집*과 *내보내기*를 분리하는 결정적 IR입니다: 코어가 만들고 FFmpeg 사이드카가
소비하므로 같은 편집은 항상 같은 결과로 렌더됩니다. 전체 설계:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), PoC 문서는
[`docs/poc/`](docs/poc/README.md).

### 검증 주도

모든 마일스톤 게이트는 자동 테스트로 뒷받침됩니다. `pnpm verify`가 `0`으로 종료하는 것이 "완료"의
필요조건입니다. [`docs/poc/03-TEST-GATES.md`](docs/poc/03-TEST-GATES.md) 참고.

---

## 라이선스

**MIT** — [LICENSE](LICENSE), [NOTICE](NOTICE) 참고. 코어는 영원히 무료·로컬입니다.
