# V12 — TimelineModel→EDL 변환 + FFmpeg MP4 export (길이 ±1frame)

> 검증 대상: 게이트 G7 / 체크리스트 7.1, 7.2, 7.3
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)

## 목적
가설 H3의 검증. 편집 결과 TimelineModel을 렌더 명세 EDL로 정확히 변환하고(EDL-INV-1,2), `export:render`가 FFmpeg subprocess로 EDL대로 MP4를 만들며, 출력 MP4의 실측 길이(ffprobe)가 `EDL.totalDuration`과 ±1 frame 안에서 일치함(EDL-INV-3)을 증명한다. 이것이 "텍스트 편집 → 실제 파일"의 마지막 관문이다.

## 전제조건
- 선행 게이트 green: G0~G6 (편집된 TimelineModel을 입력으로 사용).
- 환경([05-ENVIRONMENT](../05-ENVIRONMENT.md) §2): `brew install ffmpeg`(LGPL 빌드), `ffmpeg`/`ffprobe` subprocess 호출 가능.
- fixture 존재([05-ENVIRONMENT](../05-ENVIRONMENT.md) §4): `fixtures/sample.mp4`(640x360, 30fps).
- 시간 단위 정수 µs, fps=30([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §0·§2).

## 산출물 (Deliverables)
- `toEdl(TimelineModel): Edl` 변환 함수([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §5, `packages/core/render/`):
  - 각 클립 → `EdlSegment { mediaPath, sourceStart, sourceEnd, programStart }`, `programStart` 오름차순·연속.
  - `totalDuration = Σ(sourceEnd - sourceStart)`.
- `export:render` IPC 핸들러([01-POC-DESIGN](../01-POC-DESIGN.md) §5): 입력 `{edl, outPath}` → 출력 `{outPath, actualDurationUs}`.
  - FFmpeg subprocess로 각 세그먼트를 trim/concat → 단일 MP4 렌더. **`--enable-gpl` 미사용**(LGPL 유지, [00-SEED](../00-SEED.md) CONSTRAINTS 3).
- export 통합테스트 + 증거 `artifacts/g7-export.mp4`, `artifacts/g7-probe.json`.

## 검증 절차
```bash
# 0) 선행: fixture/바이너리 준비
bash scripts/setup-binaries.sh
bash scripts/make-fixture.sh

# 1) TimelineModel→EDL 변환 + 실제 FFmpeg 렌더 + ffprobe 길이 검증 통합테스트
pnpm verify:int -g "export"

# 2) 증거 확인: 출력 MP4 + ffprobe 결과
#    artifacts/g7-export.mp4, artifacts/g7-probe.json
```
검증 흐름:
1. 편집된(또는 fixture 기반) TimelineModel을 `toEdl`로 변환 → EDL-INV-1(`Σ세그먼트길이 == totalDuration`), EDL-INV-2(`totalDuration == durationProgram`, ±0 정수 µs) 단언.
2. `export:render(edl, outPath)` 실행 → FFmpeg가 MP4 생성(subprocess). FFmpeg 호출 인자에 `--enable-gpl` 부재 확인(LGPL 빌드).
3. `ffprobe`로 출력 MP4의 실제 길이(µs) 측정 → `artifacts/g7-probe.json`에 기록.
4. 실측 길이 == `EDL.totalDuration` ±1 frame 단언. 스트림이 valid(ffprobe로 video 스트림 디코드 가능) 확인.

## 자동 테스트 게이트
- 명령: `pnpm verify:int -g "export"`
- PASS 조건(기계 판정):
  - **EDL-INV-1**: `Σ(sourceEnd - sourceStart) == totalDuration` ([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §5).
  - **EDL-INV-2**: `EDL.totalDuration == TimelineModel.durationProgram` (±0, 정수 µs) ([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §5).
  - **EDL-INV-3**: ffprobe 실측 MP4 길이 == `EDL.totalDuration` **±33,333µs(±1 frame, fps=30)** ([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §5, [03-TEST-GATES](../03-TEST-GATES.md) G7).
  - 출력 MP4 재생 가능(ffprobe 스트림 valid) ([03-TEST-GATES](../03-TEST-GATES.md) G7).
  - FFmpeg subprocess 호출, 인자에 `--enable-gpl` 없음 ([00-SEED](../00-SEED.md) CONSTRAINTS 3).
  - 종료코드 == 0.

## 통과 기준 체크
- [x] `toEdl` 변환이 EDL-INV-1(`Σ세그먼트 == totalDuration`) 단언 통과 — 7.1, [04](../04-DATA-CONTRACTS.md) §5
- [x] `toEdl` 변환이 EDL-INV-2(`totalDuration == durationProgram`, ±0) 단언 통과 — 7.1
- [x] `export:render`가 FFmpeg subprocess로 EDL대로 MP4 생성 — 7.2
- [x] `--enable-gpl` 미사용(LGPL 유지) — [00-SEED](../00-SEED.md) CONSTRAINTS 3
- [x] ffprobe 실측 길이 == `EDL.totalDuration` ±33,333µs(±1frame) — 7.3, [04](../04-DATA-CONTRACTS.md) EDL-INV-3
- [x] 출력 MP4 스트림 valid(ffprobe 디코드 가능) — [03](../03-TEST-GATES.md) G7

## 증거 (Evidence)
- [x] `artifacts/g7-export.mp4` 생성됨 — EDL대로 렌더된 출력 MP4 ([03](../03-TEST-GATES.md) G7 증거)
- [x] `artifacts/g7-probe.json` 생성됨 — ffprobe 실측 길이(µs), `EDL.totalDuration`, 차이(≤ 33,333µs), 스트림 valid 여부 기록 ([03](../03-TEST-GATES.md) G7 증거)

## 실패 시 (STOP)
- 같은 게이트 3회 연속 실패 → **STOP-1**: 중단하고 실패 로그+가설과 함께 사람에게 보고([00-SEED](../00-SEED.md) §SAFETY).
- ffmpeg/ffprobe 환경 셋업 실패 → **STOP-2**: 임의 우회 금지, 사람에게 보고.
- 길이 허용오차(±1frame = 33,333µs)를 느슨하게 늘려 통과시키거나 fixture를 조작하는 것 금지 → **STOP-4**.
- `--enable-gpl`로 우회하거나 GPL 코드 차용 금지([00-SEED](../00-SEED.md) CONSTRAINTS 3).
- 계약([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md), 특히 EDL-INV) 변경이 필요하면 임의 변경 금지 → **STOP-3**(사람 승인).
