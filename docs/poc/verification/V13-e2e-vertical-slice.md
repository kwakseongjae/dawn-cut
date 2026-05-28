# V13 — E2E 수직 슬라이스 (클릭 경로 전체) = PoC DoD

> 검증 대상: 게이트 G8 / 체크리스트 8.1, 8.2, 8.3, 8.4
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)

## 목적
가설 H5(및 H1~H4 종합)의 검증이자 **PoC의 Definition of Done**. Playwright(Electron)로 클릭 경로 전체 — import → 전사/타임라인 렌더 → 단어 삭제(리플 컷) → 무음 제거 → MP4 export — 를 한 번 관통시키고, 각 단계에서 핵심 불변식이 UI에 반영됨을 증명한다. 최종적으로 `pnpm verify` 종료코드 0으로 G0~G8 전부 green임을 확인한다.

## 전제조건
- 선행 게이트 green: G0~G7 전부([V01](V01-monorepo-bootstrap.md)~[V12](V12-export-ffmpeg.md)). G8은 마지막 게이트.
- 환경: whisper.cpp(ggml-base) + FFmpeg/ffprobe 셋업 완료([05-ENVIRONMENT](../05-ENVIRONMENT.md) §2·§3), fixture 생성 완료(`fixtures/sample.mp4`, `expected-transcript.json`).
- E2E 계층(Playwright + Electron, [03-TEST-GATES](../03-TEST-GATES.md) §1): fixture 기반 결정적. 테스트 런타임 네트워크 금지([00-SEED](../00-SEED.md) STOP-5).

## 산출물 (Deliverables)
- Playwright(Electron) E2E 시나리오 3종 + 종합([03-TEST-GATES](../03-TEST-GATES.md) G8):
  1. **import**: Import 클릭 → `fixtures/sample.mp4` 선택 → 전사 토큰 ≥1개 렌더 + 타임라인 클립 1개 렌더.
  2. **단어 삭제**: 전사에서 특정 단어 3개 선택 → Delete → 표시 `durationProgram` **감소(Δ>0)** + 삭제 단어 **취소선**(`wordToProgram == null`, [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §3).
  3. **무음 제거**: "Remove silences" 클릭 → `durationProgram` **추가 감소**.
  4. **export**: Export 클릭 → 저장 경로 지정 → 출력 파일 생성 + ffprobe 실측 길이 == **UI 표시 길이 ±1 frame**.
- 증거: `artifacts/g8-trace.zip`(Playwright trace), `artifacts/g8-final.mp4`(E2E 최종 export 산출물).

## 검증 절차
```bash
# 0) 선행 전제 (이미 됐다면 생략)
bash scripts/setup-binaries.sh
bash scripts/make-fixture.sh

# 1) E2E 3종 + 종합 시나리오
pnpm verify:e2e

# 2) 최종 집계: 모든 게이트(G0~G8) 한 방에 green + 종료코드 0
pnpm verify
```
검증 흐름:
1. **import** → 전사 패널에 토큰 ≥1개, 타임라인에 클립 1개가 보이는지 단언([01-POC-DESIGN](../01-POC-DESIGN.md) §3 클릭 경로).
2. **단어 3개 삭제** → 삭제 전후 UI의 `durationProgram` 표시값을 읽어 Δ>0(감소), 삭제 단어에 취소선 스타일(`wordToProgram==null`) 적용 확인.
3. **remove silences** → 무음 제거 후 `durationProgram` 추가 감소(2단계 대비 더 작아짐) 확인.
4. **export** → 출력 파일(`artifacts/g8-final.mp4`) 존재 + `ffprobe` 실측 길이 == 그 시점 UI 표시 길이 ±1 frame 단언.
5. Playwright trace를 `artifacts/g8-trace.zip`로 저장.
6. 마지막에 `pnpm verify`(= lint + boundary + unit + integration + e2e, [03-TEST-GATES](../03-TEST-GATES.md) §2) 실행 → 종료코드 0 확인.

## 자동 테스트 게이트
- 명령: `pnpm verify:e2e` (G8 시나리오) → 그리고 최종 `pnpm verify` (G0~G8 집계)
- PASS 조건(기계 판정):
  - 시나리오 1: 전사 토큰 ≥1개 + 타임라인 클립 1개 렌더([03-TEST-GATES](../03-TEST-GATES.md) G8).
  - 시나리오 2: 단어 3개 삭제 후 표시 `durationProgram` 감소 **Δ>0** + 삭제 단어 취소선([03-TEST-GATES](../03-TEST-GATES.md) G8; 취소선 = `wordToProgram==null`, [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §3).
  - 시나리오 3: remove silences 후 `durationProgram` **추가 감소**([03-TEST-GATES](../03-TEST-GATES.md) G8).
  - 시나리오 4: 출력 파일 존재 + ffprobe 실측 길이 == UI 표시 길이 **±33,333µs(±1 frame, fps=30)** ([03-TEST-GATES](../03-TEST-GATES.md) G8, 허용오차 [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §0 / EDL-INV-3).
  - **최종(DoD, [03-TEST-GATES](../03-TEST-GATES.md) §5)**: 다음이 **동시에** 참 →
    1. `pnpm verify` 종료코드 == 0 (G0~G8 전부 green),
    2. `artifacts/`에 각 게이트 증거 산출물 전부 존재(`g0-smoke.png`, `g0-boundary.txt`, `g1-audio-probe.json`, `g2-words.json`, `g2-recall.txt`, `g3-coverage.txt`, `g4-property-report.txt`, `g5-silence.json`, `g7-export.mp4`, `g7-probe.json`, `g8-trace.zip`, `g8-final.mp4`),
    3. 검증 문서 V01~V13의 Evidence 체크박스가 산출물로 충족,
    4. `docs/poc/02-CHECKLIST.md`의 모든 `[ ]`가 `[x]`.

## 통과 기준 체크
- [x] E2E 시나리오 1: import → 전사 토큰 ≥1개 + 타임라인 클립 1개 — 8.1
- [x] E2E 시나리오 2: 단어 3개 삭제 → `durationProgram` 감소(Δ>0) + 취소선 — 8.1, [04](../04-DATA-CONTRACTS.md) §3
- [x] E2E 시나리오 3: remove silences → `durationProgram` 추가 감소 — 8.2
- [x] E2E 시나리오 4: export → 출력 파일 존재 + ffprobe 길이 == UI 표시 길이 ±1frame(33,333µs) — 8.3, [04](../04-DATA-CONTRACTS.md) EDL-INV-3
- [x] `pnpm verify` 종료코드 0 (G0~G8 전부 green) — 8.4, [03](../03-TEST-GATES.md) §5
- [x] `artifacts/` 게이트 증거 전부 존재 — [03](../03-TEST-GATES.md) §5
- [x] V01~V13 Evidence 전부 충족 — [03](../03-TEST-GATES.md) §5
- [x] `02-CHECKLIST.md` 전 항목 `[x]` — [03](../03-TEST-GATES.md) §5

## 증거 (Evidence)
- [x] `artifacts/g8-trace.zip` 생성됨 — Playwright trace(클릭 경로 전체 기록) ([03](../03-TEST-GATES.md) G8 증거)
- [x] `artifacts/g8-final.mp4` 생성됨 — E2E 최종 export 산출물 ([03](../03-TEST-GATES.md) G8 증거)
- [x] `pnpm verify` 종료코드 0 로그 — PoC DoD 충족 기록

## 실패 시 (STOP)
- 같은 게이트 3회 연속 실패 → **STOP-1**: 중단하고 실패 로그+가설과 함께 사람에게 보고([00-SEED](../00-SEED.md) §SAFETY).
- whisper/ffmpeg 환경 셋업 실패 → **STOP-2**: 임의 우회 금지, 사람에게 보고.
- 길이 허용오차(±1frame)·Δ>0 판정을 느슨하게 바꾸거나 fixture/UI 표시값을 조작해 통과시키는 것 금지 → **STOP-4**.
- 테스트 런타임 네트워크 호출 추가 금지 → **STOP-5**.
- 계약([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)) 변경이 필요하면 임의 변경 금지 → **STOP-3**(사람 승인).
- **부분 구현·red 테스트·증거 누락은 "PoC 완료"로 보고 금지**([03-TEST-GATES](../03-TEST-GATES.md) §5, [00-SEED](../00-SEED.md) DONE).
