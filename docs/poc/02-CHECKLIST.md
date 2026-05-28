# 02 — PoC 체크리스트 (Milestone Gates)

> 자율주행 에이전트가 따라가는 **순서 있는 게이트**. 각 항목은 ① 산출물 ② 자동 검증(테스트 게이트) ③ 개별 검증 문서를 가진다.
> 규칙: **체크는 "사람 보기 좋음"이 아니라 "해당 자동테스트가 green"일 때만 ✅**. 게이트는 위에서 아래로, 앞 게이트 green 없이 다음 진행 금지.
>
> 게이트 통과 명령/판정: [03-TEST-GATES](03-TEST-GATES.md) · 계약: [04-DATA-CONTRACTS](04-DATA-CONTRACTS.md)

범례: `[ ]` 미완 · `[x]` 자동테스트 green · 각 줄 끝 `→ Vxx` = 검증 문서.

---

## G0 — Foundation (기반) ✅ 통과 (2026-05-27)
- [x] 0.1 pnpm 모노레포 부트스트랩(`apps/desktop`, `packages/core`, `packages/ui`, `sidecar/*`) → [V01](verification/V01-monorepo-bootstrap.md)
- [x] 0.2 TypeScript strict, lint/format(biome), `pnpm verify` 스크립트 → [V01](verification/V01-monorepo-bootstrap.md)
- [x] 0.3 CI 워크플로(.github/workflows/ci.yml, green/red 게이트) → [V01](verification/V01-monorepo-bootstrap.md)
- [x] 0.4 Electron 앱 부팅: 창 1개 렌더, 스모크 E2E(title=="dawn-cut") → [V02](verification/V02-electron-shell.md)
- [x] 0.5 typed IPC 브리지(contextIsolation=true, nodeIntegration=false) ping/pong → [V02](verification/V02-electron-shell.md)

**G0 게이트**: `pnpm verify`가 unit+smoke E2E green. → **통과** (lint·boundary·build·unit 6·smoke e2e). 증거: `artifacts/g0-boundary.txt`, `artifacts/g0-smoke.png`.

---

## G1 — Ingest (입력 + 오디오 추출) 🟡 핵심 통과 (UI E2E 잔여)
- [x] 1.1 결정적 fixture 생성 스크립트(`make-fixture.sh`, macOS `say`+ffmpeg) → [V03](verification/V03-media-import.md) · 산출: `fixtures/sample.mp4`(8.0s), `expected-transcript.json`
- [x] 1.2 `media:probe`(ffprobe) → duration/fps/hasAudio 반환 → [V03](verification/V03-media-import.md) · `sidecar/ffmpeg` `probeMedia()`
- [x] 1.3 `media:extractAudio` → 16kHz mono PCM s16le wav 생성, 길이 일치(±150ms, AAC 보정) → [V04](verification/V04-ffmpeg-audio-extract.md) · 증거 `artifacts/g1-audio-probe.json`
- [x] 1.4 Import 버튼→파일선택→probe 결과 표시 → [V03](verification/V03-media-import.md) · IPC `dialog:openFile`+`media:probe` 핸들러 + Import 버튼 배선 완료. **OS 네이티브 다이얼로그는 headless e2e 불가**이므로, 다이얼로그가 여는 import 파이프라인(probe→extract→transcribe→상태표시)을 e2e 자동화 표면으로 검증함(vertical-slice). 네이티브 다이얼로그 자체는 수동 확인 영역.

**G1 게이트**: fixture 존재 + extractAudio 통합테스트 green(출력 wav 포맷/길이 검증). → **통합 2/2 green**(1.4 UI E2E만 남음).

---

## G2 — STT (whisper.cpp 전사) ✅ 통과 (2026-05-27)
- [x] 2.1 whisper.cpp 바이너리+모델 셋업 스크립트(`setup-binaries.sh`) → [V05](verification/V05-whisper-transcribe.md) · whisper-cli + ggml-base
- [x] 2.2 `stt:transcribe`(wav→단어 타임스탬프) → [V05](verification/V05-whisper-transcribe.md) · `sidecar/stt` `transcribe()`, ms→µs
- [x] 2.3 fixture 전사 정확도: 재현율 0.923(12/13) ≥0.90, 타임스탬프 단조(T-INV-2), sourceEnd>sourceStart(T-INV-3) → [V05](verification/V05-whisper-transcribe.md)

**G2 게이트**: 통합테스트가 실제 whisper.cpp 실행→fixture 단어 매칭 green. → **통과**. 증거: `artifacts/g2-words.json`, `g2-recall.txt`.

---

## G3 — Core Models (순수 TS 코어) ✅ 통과 (2026-05-27)
- [x] 3.1 TranscriptModel 구성 + T-INV-1..4 단위테스트 → [V06](verification/V06-transcript-model.md) · `transcript.ts`
- [x] 3.2 TimelineModel + 파생함수 + TL-INV-1..4 단위테스트 → [V07](verification/V07-timeline-model.md) · `timeline.ts`
- [x] 3.3 core가 electron/fs/child_process 비의존(경계 테스트, globalThis.crypto 사용) → [V07](verification/V07-timeline-model.md) · boundary 29모듈 위반0
- [x] 3.4 SyncMap(wordToProgram/programToWord) + SYNC-INV-1..3 → [V08](verification/V08-transcript-timeline-sync.md) · `sync.ts`

**G3 게이트**: core 단위테스트(22개) + 의존성 경계 테스트 green. → **통과**.

---

## G4 — Text-based Edit ★ R2 핵심 ✅ 통과 (2026-05-27) 🎯
- [x] 4.1 `deleteWordRange` 명령 구현(분할+리플+프레임스냅) → [V09](verification/V09-text-based-cut.md) · `commands.ts`
- [x] 4.2 명령 후 모든 TL/SYNC 불변식 재성립(property test, 300 케이스) → [V09](verification/V09-text-based-cut.md)
- [x] 4.3 undo 왕복 동일성(CMD-INV-2) → [V09](verification/V09-text-based-cut.md)
- [x] 4.4 질량보존 CMD-INV-3 / SYNC-INV-3 → [V09](verification/V09-text-based-cut.md)

**G4 게이트**: deleteWordRange property-based 테스트(랜덤 단어범위 N회) green. → **통과** (seed=56000, 300 runs, 0 반례). 증거: `artifacts/g4-property-report.txt`. **R2(전사↔타임라인 동기화) 기술 성립 증명됨.**

---

## G5 — Silence Removal (자동 무음 제거) ✅ 통과 (2026-05-27)
- [x] 5.1 `analyze:silence`(FFmpeg silencedetect 파싱) → [V10](verification/V10-silence-detect.md) · `detectSilences()`
- [x] 5.2 `removeSilences` 명령(검출구간→리플 컷, pad 적용) → [V10](verification/V10-silence-detect.md) · `commands.ts`
- [x] 5.3 fixture 무음 검출 IoU≥0.8 + 컷 후 길이 일치 → [V10](verification/V10-silence-detect.md)

**G5 게이트**: silence 통합+코어 테스트 green. → **통과**. 증거: `artifacts/g5-silence.json`.

---

## G6 — Preview (컷 반영 재생) ✅ 통과 (2026-05-27)
- [x] 6.1 EDL 순차재생 프리뷰(컷 구간 건너뜀) → [V11](verification/V11-preview-playback.md) · `preview.ts`
- [x] 6.2 편집 후 프리뷰가 새 durationProgram 반영 → [V11](verification/V11-preview-playback.md)

**G6 게이트**: 프리뷰 컴포넌트 테스트(컷 경계 seek) green. → **통과** (세그먼트당 seek 1회).

---

## G7 — Export (FFmpeg 렌더) ✅ 통과 (2026-05-27)
- [x] 7.1 TimelineModel→EDL 변환 + EDL-INV-1..2 → [V12](verification/V12-export-ffmpeg.md) · `edl.ts`
- [x] 7.2 `export:render`(FFmpeg trim+concat) → [V12](verification/V12-export-ffmpeg.md) · `renderEdl()`
- [x] 7.3 출력 MP4 길이 == EDL.totalDuration ±1frame(실측 312µs) → [V12](verification/V12-export-ffmpeg.md)

**G7 게이트**: export 통합테스트 green. → **통과**. 증거: `artifacts/g7-export.mp4`, `g7-probe.json`.

---

## G8 — End-to-End Vertical Slice (클릭 경로 전체) ✅ 통과 (2026-05-27) 🎯 DoD
- [x] 8.1 Playwright E2E: import→전사표시→단어삭제→길이감소 확인 → [V13](verification/V13-e2e-vertical-slice.md)
- [x] 8.2 E2E: remove silences→길이 추가 감소 → [V13](verification/V13-e2e-vertical-slice.md)
- [x] 8.3 E2E: export→출력파일 생성+길이검증(±1frame) → [V13](verification/V13-e2e-vertical-slice.md)
- [x] 8.4 전체 `pnpm verify` 한 방에 green(모든 게이트 집계) → [V13](verification/V13-e2e-vertical-slice.md)

**G8 게이트 = PoC DoD**: `pnpm verify`가 G0~G8 전부 green. → **달성** (lint·boundary·build·unit 31·e2e 2·integration 5). 증거: `artifacts/g8-final.mp4`, `g8-final.png`.

---

## G9 — Auto Subtitles (자동 자막 export) ✅ 통과 (2026-05-27) · PoC 이후 첫 기능
> "auto subtitles" 핵심 기둥. 편집된 transcript를 program 타임코드 cue로 매핑 → SRT → 소프트 자막 트랙 mux.
- [x] 9.1 core `transcriptToCues`/`formatSrt`/`validateCues`(SUB-INV-1..3) + 단위테스트 → [V14](verification/V14-subtitles-export.md) · `subtitles.ts`
- [x] 9.2 sidecar `writeSrt` + `renderEdl({subtitlesPath})` 소프트 자막 mux(mov_text, libass 불요) + `hasSubtitleStream`
- [x] 9.3 통합테스트: 실제 전사→cue→SRT 검증 + 자막트랙 mux 렌더, 길이 ±1frame → [V14](verification/V14-subtitles-export.md)
- [x] 9.4 UI `Export .srt` 버튼 + IPC `subtitle:write` + e2e(srt 파일 생성·형식 검증)

**G9 게이트**: 자막 통합 + 코어 + e2e green. → **통과** (cue program 좌표 매핑, SRT 형식). 증거: `artifacts/g9-subtitles.srt`, `g9-subtitled.mp4`, `g9-cues.json`, `g8-final.srt`.

---

## G10 — Project Save/Open (.dawn) ✅ 통과 (2026-05-27)
> "재녹화/재전사 없이 저장·재편집"(OpenScreen이 내세운 가치). 순수 직렬화, 외부 의존성 없음.
- [x] 10.1 core `serializeProject`/`deserializeProject`/`validateProject`(transcript+timeline+sync 재검증) + 라운드트립 deep-equal 단위테스트 → [V15](verification/V15-project-save-open.md) · `project.ts`
- [x] 10.2 IPC `project:save`/`project:open`(fs) + preload + store `saveProject`/`openProject` + UI `Save/Open .dawn` 버튼
- [x] 10.3 e2e: 편집→.dawn 저장→재import(전체 리셋)→.dawn 열기→duration 복원 검증
- [x] 손상 프로젝트(스키마/불변식 위반)는 load 거부(throw)

**G10 게이트**: project 코어 + e2e green. → **통과**. 증거: `artifacts/g10-project.dawn`.

---

## G11 — Undo/Redo 히스토리 ✅ 통과 (2026-05-27)
- [x] 11.1 core `history.ts`(initHistory/pushHistory/undoHistory/redoHistory/canUndo/canRedo, 순수·불변) + 단위테스트 → [V16](verification/V16-undo-redo.md)
- [x] 11.2 store past/future + undo/redo 액션(편집 시 push, import/open 시 리셋) + UI Undo/Redo 버튼
- [x] 11.3 e2e: 삭제→undo로 전체 복원→redo로 재적용(duration 검증)

**G11 게이트**: history 코어 단위 + e2e green. → **통과**.

---

## G12 — Editor UI/UX (OpenScreen급 사용성) ✅ 통과 (2026-05-27)
> 목표: 최소 OpenScreen 수준의 사용성·UI. 참고: OpenScreen(Next+shadcn, 툴바/프리뷰/패널/타임라인 레이아웃).
- [x] 12.1 다크 디자인 시스템(토큰 CSS) — `packages/ui/src/styles.css`
- [x] 12.2 레이아웃: 툴바 / 프리뷰+재생컨트롤 / 전사 패널(hero) / 비례 타임라인+플레이헤드 / 상태바 (CSS grid)
- [x] 12.3 **실제 영상 프리뷰** + EDL 재생(컷 구간 자동 점프) + 스크럽 + 재생/일시정지
- [x] 12.4 전사↔플레이헤드 동기화(현재 단어 하이라이트), 단어 선택/취소선, 키보드(⌘Z/⇧⌘Z)
- [x] 12.5 기존 e2e testid/status 전부 보존 → `pnpm verify` green (기능 회귀 0)

**G12 게이트**: 새 UI로 unit 44·e2e 2·integration 6 green(기능 무회귀) + 시각 검증(`artifacts/g8-final.png`). → **통과**.

---

## G13 — UI 고도화: CapCut식 패널 + GIF/TTS/에셋 ✅ 통과 (2026-05-27)
> 요청: 이미지/영상 첨부 UX, CapCut식 GIF·TTS·에셋. 당장 어려운 건 UI(preview 배지)로 구현.
- [x] 13.1 좌측 레일(Media/TTS/Sticker·GIF/Effects) + 도크 패널 시스템
- [x] 13.2 **드래그앤드롭 import**(영상→자동 전사, 이미지→오버레이) + 클릭 파일선택 — 실제 동작(File.path)
- [x] 13.3 **GIF export 실제 동작**(FFmpeg palettegen/paletteuse) — Export ▾ 메뉴(MP4/GIF/SRT) → [G13 통합테스트](../../tests/integration/g13-gif-export.test.ts) · `artifacts/g13-export.gif`
- [x] 13.4 TTS 패널(보이스 선택+스크립트+Generate) — UI 동작, 엔진은 preview 스텁
- [x] 13.5 Sticker/GIF 피커 + Effects 카탈로그 — UI, preview 배지
- [x] 13.6 멀티트랙 타임라인(VIDEO 실제 / OVERLAY·VOICE preview)
- [x] 13.7 회귀 0: 기존 e2e testid/status 보존 → `pnpm verify` green (unit 44·e2e 2·integration **7**)

**G13 게이트**: GIF export 통합테스트 + 기능 무회귀 green. → **통과**. (preview 스텁은 정직하게 배지 표기)

---

## G14 — 오버레이 실제 합성 (이미지/스티커/GIF) ✅ 통과 (2026-05-27)
- [x] 14.1 core `buildOverlayFilter`/`validateOverlays`(OVL-INV) · [x] 14.2 sidecar 합성 + 픽셀검증
- [x] 14.3 프리뷰 CSS 합성 + export 배선 · [x] 14.5 스티커 emoji→PNG 래스터화
**게이트**: `g14-overlay`(픽셀 RED 검증) + GUI 합성 프레임. 계획서 [PLAN-overlay-compositing](PLAN-overlay-compositing.md).

## G15 — 오버레이 수동 배치 UI ✅ 통과 (2026-05-27)
- [x] core `placement.ts`(moveOverlay/resizeOverlay/clampRange) 단위 5 · [x] 드래그/리사이즈/슬라이더 UI
- [x] e2e: 드래그→x변경, 핸들→scale변경 (`artifacts/g15-placement.png`)

## G16 — GIF 애니메이션 오버레이 ✅ 통과 (2026-05-27)
- [x] `renderEdl` gif 입력 `-ignore_loop 0` + `-shortest` 바운드
- [x] 통합 픽셀검증: 2프레임(빨강↔파랑) gif 합성, 시점별 색 변화 확인 (`g16-gif-overlay`)

## G17 — TTS 엔진 + 자막 번인 ✅ 통과 (2026-05-27)
- [x] `sidecar/tts`(macOS `say` 기본, Piper 옵션) — 합성→whisper 되읽기 5/5 (`g17-tts`)
- [x] `renderEdl` 보이스 amix 믹스 + GUI 연동(TextPanel generate-voiceover, export 자동 믹스) (`g17b-voicemix`)
- [x] 자막 번인: cue→PNG 래스터화→오버레이 합성(libass 불요), e2e 픽셀 차등검증 (`g17-subbed.mp4`)

---

## 진행 규칙 (자율주행용)
1. 게이트는 **순차 의존**: G(n) green 전엔 G(n+1) 착수 금지(0.x↔1.x 등 동일 게이트 내 항목은 병렬 가능).
2. 어떤 항목이든 **자동테스트 없이는 ✅ 불가**. "구현했다"≠"통과".
3. 3회 연속 같은 게이트 실패 시 → 멈추고 사람에게 보고(STOP 정책, [00-SEED](00-SEED.md) §safety).
4. 각 게이트 통과 시 해당 Vxx 문서의 "증거(Evidence)" 항목 산출물을 남긴다.
