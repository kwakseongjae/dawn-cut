# V11 — EDL 순차재생 프리뷰 (컷 구간 건너뜀)

> 검증 대상: 게이트 G6 / 체크리스트 6.1, 6.2
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)

## 목적
실시간 GPU 합성 없이([01-POC-DESIGN](../01-POC-DESIGN.md) §8), 단일 HTML5 `<video>` 1개를 EDL 세그먼트 순서대로 재생하며 컷된 구간을 `currentTime` 점프로 건너뛰는 프리뷰가 동작함을 증명한다(H1 보조). 진짜 합성은 Export(FFmpeg, [V12](V12-export-ffmpeg.md))가 담당하므로, 여기서는 "컷 구간을 실제로 건너뛰는가" + "편집 후 새 길이를 반영하는가"만 검증한다.

## 전제조건
- 선행 게이트 green: G0~G5 (특히 [V09](V09-text-based-cut.md) deleteWordRange, [V10](V10-silence-detect.md) removeSilences — 편집 결과 TimelineModel/EDL을 프리뷰 입력으로 사용).
- 단위 계층 테스트(완전 결정적, [03-TEST-GATES](../03-TEST-GATES.md) §1): jsdom + HTML5 video API 모킹. 실제 디코딩/재생 없음 → 바이너리·네트워크 불필요.
- 프리뷰 입력은 TimelineModel→EDL([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §5): `segments`는 `programStart` 오름차순·연속, `totalDuration == durationProgram`(EDL-INV-2).

## 산출물 (Deliverables)
- `<PreviewPlayer>` 컴포넌트([01-POC-DESIGN](../01-POC-DESIGN.md) §4 `packages/ui`): EDL을 입력받아 단일 `<video>`로 세그먼트를 순차 재생.
  - 재생 로직: 세그먼트 i 시작 시 `video.currentTime = segment[i].sourceStart(초)`로 **seek**, 세그먼트 끝(`sourceEnd`)에 도달하면 다음 세그먼트의 `sourceStart`로 **점프**(컷된 source 구간은 재생 안 함).
  - program 시간 → source 시간 매핑은 EDL 세그먼트 오프셋으로 계산(정수 µs 기준, 표시 시 초 변환).
- 컴포넌트 테스트(Vitest + jsdom): `video.currentTime` setter를 spy로 모킹해 seek 횟수/대상 시각 검증.

## 검증 절차
```bash
# 1) 프리뷰 컴포넌트 단위 테스트 (jsdom + video 모킹, 완전 결정적)
pnpm verify:unit -g "preview"
```
검증 흐름:
1. 컷이 N회 발생한(= 세그먼트 N+1개) EDL을 만들어 `<PreviewPlayer>`에 주입.
2. 재생을 시뮬레이트(timeupdate/ended 이벤트 모킹) → `video.currentTime` setter 호출을 수집.
3. **세그먼트 경계 수(컷 구간 수)만큼 seek 점프**가 발생했는지, 점프 대상이 다음 세그먼트의 `sourceStart`인지 단언.
4. 컷된 source 구간(EDL에 없는 구간)에 `currentTime`이 머무르지 않음(미재생) 확인.
5. 편집(deleteWordRange/removeSilences) 후 새 EDL 주입 → 프리뷰 총 재생 길이 == 새 `EDL.totalDuration`(= 새 `durationProgram`) 반영 확인(6.2).

## 자동 테스트 게이트
- 명령: `pnpm verify:unit -g "preview"`
- PASS 조건(기계 판정):
  - 컷 세그먼트 수만큼 `video.currentTime` seek 점프 발생, 각 점프 대상 == 다음 세그먼트 `sourceStart` ([03-TEST-GATES](../03-TEST-GATES.md) G6).
  - 컷된 구간(EDL `segments`에 포함되지 않은 source 구간)은 재생되지 않음(currentTime이 해당 구간에 진입 안 함) ([03-TEST-GATES](../03-TEST-GATES.md) G6).
  - 편집 후 프리뷰가 인식하는 총 길이 == 새 `EDL.totalDuration`, 그리고 `EDL.totalDuration == TimelineModel.durationProgram`(EDL-INV-2, [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §5).
  - 종료코드 == 0.

## 통과 기준 체크
- [x] `<PreviewPlayer>`가 EDL 세그먼트를 순차 재생(단일 `<video>` + currentTime 점프) — 6.1, [01](../01-POC-DESIGN.md) §8
- [x] 컷 세그먼트 수만큼 seek 발생, 점프 대상 == 다음 세그먼트 `sourceStart` — [03](../03-TEST-GATES.md) G6
- [x] 컷 구간 미재생(currentTime이 제거된 source 구간에 머물지 않음) — [03](../03-TEST-GATES.md) G6
- [x] 편집 후 프리뷰 총 길이 == 새 `EDL.totalDuration`(= `durationProgram`) — 6.2, [04](../04-DATA-CONTRACTS.md) EDL-INV-2
- [x] jsdom + video 모킹으로 완전 결정적(네트워크/바이너리 미사용) — [03](../03-TEST-GATES.md) §4, [00-SEED](../00-SEED.md) STOP-5

## 증거 (Evidence)
- [x] `pnpm verify:unit -g "preview"` 실행 로그(종료코드 0) — seek 횟수 == 컷 세그먼트 수, 점프 대상 시각 기록

> 주: G6는 단위 계층(컴포넌트 테스트)이라 별도 바이너리 산출물(.mp4 등)을 만들지 않는다. 실제 컷 반영 렌더 검증은 [V12](V12-export-ffmpeg.md)(export)와 [V13](V13-e2e-vertical-slice.md)(E2E)에서 산출한다.

## 실패 시 (STOP)
- 같은 게이트 3회 연속 실패 → **STOP-1**: 중단하고 실패 로그+가설과 함께 사람에게 보고([00-SEED](../00-SEED.md) §SAFETY).
- 테스트 런타임에 네트워크 호출 추가 금지(결정성 훼손) → **STOP-5**.
- 판정 기준(seek 횟수/대상)을 느슨하게 바꿔 통과시키는 것 금지 → **STOP-4**.
- 계약([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)) 변경이 필요하면 임의 변경 금지 → **STOP-3**(사람 승인).
