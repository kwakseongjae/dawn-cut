# V14 — 자동 자막 export (SRT + 소프트 자막 mux)

> 검증 대상: G9 (9.1 cue/SRT 코어, 9.2 writeSrt+mux, 9.3 통합, 9.4 UI/e2e)
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) · [V08](V08-transcript-timeline-sync.md)
> 상태: ✅ 통과 (2026-05-27) — PoC(G0~G8) 이후 첫 기능

## 목적
dawn-cut의 핵심 기둥인 **"auto subtitles"** 를 구현·검증한다. 편집된 transcript의 살아있는 단어를 **program 타임코드**(SyncMap, [V08])로 매핑해 자막 cue를 만들고, SRT로 직렬화하며, export 시 **소프트 자막 트랙**으로 mux한다. 자막 타이밍이 편집 결과(컷·무음제거 반영)와 일치함을 보장한다.

## 전제조건
- G3([V06]~[V08]), G5([V10]), G7([V12]) green. whisper.cpp 빌드(통합용).
- SubtitleCue 는 **program 좌표**(편집 결과 기준). cue 는 살아있는 단어만 포함.

## 산출물 (Deliverables)
- `packages/core/src/subtitles.ts` — `transcriptToCues`(그룹핑: maxGapUs/maxWordsPerCue), `formatSrt`(HH:MM:SS,mmm), `validateCues`(SUB-INV).
- `sidecar/ffmpeg`: `writeSrt(path,content)`, `renderEdl(edl,out,{subtitlesPath})`(mov_text 소프트 mux), `hasSubtitleStream(path)`.
- `apps/desktop`: IPC `subtitle:write`, preload `writeSrt`, UI `Export .srt` 버튼, store `exportSrt`.
- 테스트: `subtitles.test.ts`(unit), `g9-subtitles.test.ts`(integration), e2e SRT 단계.

## 불변식 (SUB-INV)
- **SUB-INV-1**: cue 는 startUs 오름차순·비겹침, index 순차(1..N).
- **SUB-INV-2**: 각 cue `startUs < endUs`, text 비어있지 않음.
- **SUB-INV-3**: 모든 cue 가 program 구간 `[0, durationProgram]` 내.
- (커버리지) 살아있는 단어는 cue 텍스트에 포함, 컷된 단어는 미포함.

## 검증 절차
1. 단위: `pnpm test:unit -t subtitles` — scene 기반 cue 생성/검증, 컷 후 gap 분리, SRT 타임스탬프 형식, SUB-INV-2 위반 검출.
2. 통합(실제 ffmpeg/whisper): import→transcribe→removeSilences→`transcriptToCues`→`validateCues`==[] → `writeSrt` → `renderEdl({subtitlesPath})` → `hasSubtitleStream(out)`==true, 길이 == EDL.totalDuration ±1frame.
3. e2e: `Export .srt` 경로(자동화 표면 `__editor.exportSrt`)로 SRT 파일 생성, 형식(`\d{2}:\d{2}:\d{2},\d{3} --> `) 검증.

## 자동 테스트 게이트
- 명령: `pnpm test:unit -t subtitles` · `pnpm test:int -- g9-subtitles` · `pnpm test:e2e`
- PASS 조건(기계 판정):
  - `validateCues(cues, timeline) === []` (SUB-INV-1..3).
  - cue 들이 program 좌표(`endUs ≤ durationProgram + 1frame`).
  - 출력 MP4 에 subtitle 스트림 존재(`hasSubtitleStream`==true), 길이 ±1frame(EDL-INV-3 일관).
  - SRT 가 표준 타임코드 형식.

## 통과 기준 체크
- [x] cue 가 살아있는 단어만, program 순서로 그룹핑.
- [x] SUB-INV-1..3 단위테스트 green.
- [x] 컷/무음제거 반영된 program 타이밍(편집 결과와 일치).
- [x] SRT 형식 검증.
- [x] 출력 MP4 자막 트랙 존재 + 길이 ±1frame.
- [x] `Export .srt` e2e 파일 생성.

## 증거 (Evidence)
- [x] `artifacts/g9-subtitles.srt` — 편집 결과 program-timed SRT.
- [x] `artifacts/g9-subtitled.mp4` — 자막 트랙 mux 출력.
- [x] `artifacts/g9-cues.json` — cue 목록 + totalDuration.
- [x] `artifacts/g8-final.srt` — e2e 클릭 경로 SRT.

## 실패 시 (STOP)
- libass 부재로 `subtitles` 번인 필터 미지원 → **소프트 자막(mov_text mux)** 으로 전환함(번인 대신, 비파괴적). 향후 번인 필요 시 libass 포함 ffmpeg 빌드 별도 검토.
- cue 가 program 범위 벗어남(SUB-INV-3): wordToProgram 매핑/그룹핑 경계 점검.
- 게이트 약화 금지(STOP-4): 자막 타이밍은 program 좌표 + ±1frame 유지.
