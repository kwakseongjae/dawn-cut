# 03 — 자동 테스트 게이트 (Verification Gates)

> "goal이 확인한다"의 구현체. 각 체크리스트 항목은 **실행 가능한 명령 + 기계 판정 기준**을 가진다.
> 에이전트는 이 명령들이 전부 green이어야 PoC를 완료로 선언할 수 있다. 사람 판단 개입 없음.
>
> 관련: [02-CHECKLIST](02-CHECKLIST.md) · [04-DATA-CONTRACTS](04-DATA-CONTRACTS.md) · [05-ENVIRONMENT](05-ENVIRONMENT.md)

---

## 1. 테스트 계층
| 계층 | 도구 | 대상 | 결정성 |
|---|---|---|---|
| unit | Vitest | `packages/core`(순수 TS), 불변식, property test | 완전 결정적 |
| integration | Vitest + 실제 바이너리 | FFmpeg/whisper.cpp 호출, fixture 입출력 | 결정적 fixture 기반 |
| e2e | Playwright(Electron) | 클릭 경로 전체 | fixture 기반 |
| boundary | dependency-cruiser/eslint-rule | core의 electron/fs 비의존 | 정적 |

## 2. 단일 진입점
```bash
pnpm verify        # = lint + boundary + unit + integration + e2e, 하나라도 red면 비0 종료
pnpm verify:unit   # G3/G4 빠른 루프
pnpm verify:int    # G1/G2/G5/G7 (바이너리 필요)
pnpm verify:e2e    # G8
```
CI는 `pnpm verify` 종료코드로 게이트. **종료코드 0 = PoC 통과의 필요조건.**

---

## 3. 게이트별 명령 & 판정 기준

> 형식: **게이트 → 명령 → PASS 조건(기계 판정) → 증거 산출물(`artifacts/`)**

### G0 Foundation
- `pnpm -r build` → 모든 패키지 빌드 성공(exit 0).
- `pnpm verify:e2e -g "smoke"` → Electron 창 뜨고 타이틀=="dawn-cut". 증거: `artifacts/g0-smoke.png`.
- `pnpm boundary` → core 위반 0건. 증거: `artifacts/g0-boundary.txt`.

### G1 Ingest
- `bash scripts/make-fixture.sh` → `fixtures/sample.mp4`, `fixtures/expected-transcript.json` 생성. PASS: 파일 존재 + ffprobe 길이 ∈ [7s,12s]. (실측 보정 2026-05-27: Samantha 보이스 기준 ~8.0s)
- `pnpm verify:int -g "extractAudio"` → 출력 wav: 16000Hz, mono, PCM s16le, 길이 == 소스 ±1frame. 증거: `artifacts/g1-audio-probe.json`.

### G2 STT
- `pnpm verify:int -g "transcribe"` → whisper.cpp 실제 실행. PASS:
  - `expected-transcript.json`의 키워드 집합 대비 **재현율 ≥ 0.90**(정규화 후 토큰 비교),
  - word 타임스탬프 단조 비감소(T-INV-2),
  - 모든 word `sourceEnd>sourceStart`.
  - 증거: `artifacts/g2-words.json`, `artifacts/g2-recall.txt`.

### G3 Core Models
- `pnpm verify:unit -g "transcript|timeline|sync"` → PASS: T-INV-1..4, TL-INV-1..4, SYNC-INV-1..3 단언 통과.
- `pnpm boundary` → core가 `electron|fs|child_process|path(node)` import 0건.
- 증거: `artifacts/g3-coverage.txt`(core 라인 커버리지 ≥ 80%).

### G4 Text-based Edit ★
- `pnpm verify:unit -g "deleteWordRange"` → **property-based**(fast-check, ≥200 케이스): 랜덤 단어범위 삭제 후
  - 전 TL-INV/SYNC-INV 재성립(CMD-INV-1),
  - undo 후 deep-equal(CMD-INV-2),
  - `removedProgramUs == before.dur - after.dur ≥ 0`(CMD-INV-3),
  - 살아있는 단어 순서 = order의 부분수열(SYNC-INV-2).
  - 증거: `artifacts/g4-property-report.txt`(케이스 수, seed, 0 반례).

### G5 Silence
- `pnpm verify:int -g "silence"` → fixture에 삽입된 무음구간(예: 2.0~3.0s, 6.0~6.8s) 검출. PASS: 검출구간이 기대구간과 IoU ≥ 0.8. `removeSilences` 후 durationProgram == 원본 - Σ무음 ±1frame. 증거: `artifacts/g5-silence.json`.

### G6 Preview
- `pnpm verify:unit -g "preview"` → 컴포넌트 테스트: EDL 경계에서 `video.currentTime` 점프 호출 검증(jsdom + 모킹). PASS: 컷 세그먼트 수만큼 seek 발생, 컷 구간 미재생.

### G7 Export
- `pnpm verify:int -g "export"` → TimelineModel→EDL(EDL-INV-1,2 단언) → FFmpeg 렌더 → **ffprobe 실측 길이 == EDL.totalDuration ±33,333µs**(EDL-INV-3). 출력 재생 가능(ffprobe 스트림 valid). 증거: `artifacts/g7-export.mp4`, `artifacts/g7-probe.json`.

### G8 E2E (DoD)
- `pnpm verify:e2e` → Playwright 시나리오 3종:
  1. import→전사 토큰 ≥1개 렌더, 타임라인 클립 1개,
  2. 특정 단어 3개 삭제 → 표시 durationProgram **감소**(Δ>0) + 삭제단어 취소선,
  3. remove silences → durationProgram 추가 감소,
  4. export → 출력파일 존재 + ffprobe 길이 == UI 표시 길이 ±1frame.
  - 증거: `artifacts/g8-trace.zip`(Playwright trace), `artifacts/g8-final.mp4`.
- 최종: `pnpm verify` 종료코드 0.

---

### G9 Auto Subtitles (PoC 이후 첫 기능)
- `pnpm test:unit -t subtitles` → SUB-INV-1..3, SRT 형식, cue 그룹핑/커버리지.
- `pnpm test:int -- g9-subtitles` → 실제 전사→cue(program 좌표)→`validateCues`==[]→SRT→소프트 자막 mux 렌더. PASS: `hasSubtitleStream`==true, 길이 == EDL.totalDuration ±1frame. 증거: `artifacts/g9-subtitles.srt`, `g9-subtitled.mp4`, `g9-cues.json`.
- e2e: `Export .srt`→파일 생성+형식. 증거: `artifacts/g8-final.srt`.

## 4. 결정성 보장 규칙
- 모든 통합/E2E는 **`fixtures/` 의 고정 자산**만 사용(네트워크·랜덤 입력 금지).
- whisper는 비결정 요소(thread 수)로 인한 미세 편차 가능 → **타임스탬프 절대값이 아닌 단조성·재현율·길이 허용오차(±1frame)로 판정**(절대값 동일성 요구 금지).
- property test는 **고정 seed** 기록(`artifacts/g4-property-report.txt`)으로 재현 가능.

## 5. Definition of Done (PoC)
PoC는 다음이 **동시에** 참일 때만 완료:
1. `pnpm verify` 종료코드 0 (G0~G8 전부 green).
2. `artifacts/` 에 각 게이트 증거 산출물 존재.
3. 검증 문서 V01~V13의 "Evidence" 체크박스가 산출물로 충족.
4. `docs/poc/02-CHECKLIST.md` 의 모든 `[ ]`가 `[x]`(자동 갱신 또는 PR에 기록).

> 하나라도 미충족이면 PoC 미완료. 부분 구현·red 테스트·누락 산출물은 "완료"로 보고 금지.

## 6. 권장 디렉터리
```
tests/{unit,integration,e2e}/
fixtures/{sample.mp4, expected-transcript.json}
artifacts/   # 게이트 증거(.gitignore, CI 업로드)
scripts/{setup-binaries.sh, make-fixture.sh, verify.sh}
```
