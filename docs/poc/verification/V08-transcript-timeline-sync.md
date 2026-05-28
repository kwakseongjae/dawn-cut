# V08 — 전사↔타임라인 동기화 SyncMap + 불변식(SYNC-INV) ★ R2 핵심

> 검증 대상: G3 (3.4) — SyncMap(wordToProgram/programToWord) + SYNC-INV-1..3 단위테스트
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)

## 목적
dawn-cut의 가장 비싼 리스크 **R2(전사↔타임코드 양방향 동기화가 어떤 편집 후에도 깨지지 않는다)** 의 핵심 자료구조인 **SyncMap** 을 구현하고, 불변식 **SYNC-INV-1..3**([04-DATA-CONTRACTS §3](../04-DATA-CONTRACTS.md))을 단위테스트로 증명한다.

SyncMap 은 `TranscriptModel`([V06](V06-transcript-model.md))의 단어와 `TimelineModel`([V07](V07-timeline-model.md))의 살아있는 클립을 잇는다. 이 매핑이 깨지면 텍스트 기반 편집(R2, [V09](V09-text-based-cut.md))이 성립하지 않으므로, 본 문서는 PoC 전체에서 특히 꼼꼼히 강제한다.

대상 API (04 §3 인용):
```ts
// 단어 → program 시간 구간 (현재 편집 상태 기준)
function wordToProgram(wordId: string): { start: number; end: number } | null;
// program 시간 t → 그 시점에 재생되는 단어
function programToWord(tProgram: number): string | null;
```

매핑 규칙 (04 §3 인용):
- Word 의 `[sourceStart, sourceEnd)` 가 **현재 타임라인에 살아있는 클립**(같은 mediaId, source 구간 포함)에 포함되면 → 해당 클립의 **source→program 오프셋**으로 변환.
  - 오프셋: 살아있는 클립 `c` 가 `[c.sourceStart, c.sourceEnd)` 를 `c.timelineStart` 부터 배치하므로, source 시각 `s` → program `s - c.sourceStart + c.timelineStart`. 단어 구간 `[ws, we)` → `{ start: ws - c.sourceStart + c.timelineStart, end: we - c.sourceStart + c.timelineStart }`.
- 단어가 어떤 살아있는 클립에도 포함되지 않으면(=컷되어 사라짐) → `wordToProgram` 은 **`null`**, UI 에서 "삭제됨(취소선)" 표시.

## 전제조건
- [V06](V06-transcript-model.md), [V07](V07-timeline-model.md) green.
- `packages/core/transcript/sync.ts` 에 `SyncMap`(또는 `wordToProgram`/`programToWord` 순수 함수, `(transcript, timeline)` 클로저)이 구현되어 있다.
- 시간 단위는 정수 µs (04 §0). 모든 비교는 정수 일치(±0); 허용오차는 본 게이트에서 사용하지 않는다.

## 산출물 (Deliverables)
- `packages/core/transcript/sync.ts` — `wordToProgram(wordId)`, `programToWord(tProgram)`, `livingWords(transcript, timeline)` 헬퍼.
- `tests/unit/sync-map.test.ts` — SYNC-INV-1..3 단언(미편집 통클립 + 가운데 클립 1개 제거된 편집 상태 둘 다 케이스).

## 검증 절차
1. 살아있는 단어 판정: Word `[ws, we)` 를 포함하는 살아있는 클립 `c`(같은 mediaId, `c.sourceStart <= ws ∧ we <= c.sourceEnd`)가 존재 → 살아있음, 없으면 컷됨(`wordToProgram == null`).
2. **SYNC-INV-1 (라운드트립)**: 살아있는 모든 Word `w` 에 대해
   ```
   programToWord(wordToProgram(w).start) === w.id
   ```
   (구간 시작 시각에 재생되는 단어가 자기 자신). 컷된 단어는 `wordToProgram(w) === null` 이므로 라운드트립 대상에서 제외.
3. **SYNC-INV-2 (순서 부분수열 보존)**: 살아있는 단어들을 program 시작시각(`wordToProgram(w).start`) 오름차순으로 나열한 id 수열이, `TranscriptModel.order` 의 **부분수열(subsequence)** 과 정확히 일치. (단어 순서는 절대 뒤집히지 않음 — order 에서 일부만 빠진 형태)
4. **SYNC-INV-3 (질량 보존)**: `timeline.durationProgram == Σ(살아있는 클립의 clipDuration)`. 컷한 만큼만 줄어든다. (살아있는 클립 = 현재 `timeline.clips` 의 전체; "살아있는"은 04 §3 SYNC-INV-3 정의 그대로)
5. 케이스 매트릭스:
   - C1: 미편집(통클립 1개) — 전 단어 살아있음, 라운드트립 전부 성립, order 와 부분수열 == 전체 일치.
   - C2: 가운데 일부 단어 컷됨(클립 분할/리플 후 상태) — 컷 단어 `null`, 살아있는 단어 부분수열 보존, durationProgram == Σ 살아있는 클립 duration.
   - 경계: program 경계 시각 `t == clipTimelineEnd(c)`(반열린구간) → 그 클립에 속하지 않음. `programToWord` 가 살아있는 클립 어디에도 안 걸리면 `null`.
6. 실행:
   ```bash
   pnpm verify:unit -g "sync"
   ```

## 자동 테스트 게이트
- 명령: `pnpm verify:unit -g "sync"`
- PASS 조건(기계 판정) — 04 §3 / 03 §3 G3 인용:
  - **SYNC-INV-1**: 모든 살아있는 `w` 에서 `programToWord(wordToProgram(w).start) === w.id` (true).
  - **SYNC-INV-2**: program 시작시각 오름차순 살아있는 단어 id 수열이 `transcript.order` 의 부분수열 (`isSubsequence(livingByProgram, order) === true`).
  - **SYNC-INV-3**: `timeline.durationProgram === Σ clipDuration(살아있는 클립)` (정수 µs, ±0).
  - 컷된 단어는 `wordToProgram(w) === null`.
  - 반열린구간 `[start, end)` 규약 준수(경계 시각은 다음 단어/`null`).
  - Vitest 종료코드 0, 0 fail.

## 통과 기준 체크
- [x] `wordToProgram` 가 살아있는 클립의 source→program 오프셋으로 정확 변환, 컷 단어는 `null` 반환.
- [x] `programToWord` 가 program 시각의 단어 id 반환(없으면 `null`), 반열린구간 규약 준수.
- [x] SYNC-INV-1 라운드트립 단언 통과(살아있는 전 단어).
- [x] SYNC-INV-2 순서 부분수열 보존 단언 통과.
- [x] SYNC-INV-3 질량 보존 단언 통과(durationProgram == Σ 살아있는 클립 duration).
- [x] C1(미편집)·C2(일부 컷) 케이스 모두 green.
- [x] `pnpm verify:unit -g "sync"` 종료코드 0.

## 증거 (Evidence)
- [x] Vitest 리포트(green) — `sync` 그렙 매칭 테스트 전부 pass, 0 fail.
- [x] `artifacts/g3-coverage.txt` 에 sync 모듈 커버리지 포함(core 전체 ≥80%, [V07](V07-timeline-model.md)와 공유).

## 실패 시 (STOP)
- SYNC-INV-1 라운드트립 실패: 오프셋 계산(`s - c.sourceStart + c.timelineStart`) 또는 살아있는 클립 탐색 결함. 반열린구간 경계 처리 점검.
- SYNC-INV-2 위배(순서 역전): 단어를 program 시각이 아닌 다른 기준으로 정렬했을 가능성. order 부분수열 정의를 엄격히 적용(부분수열 ≠ 부분집합).
- SYNC-INV-3 위배: durationProgram 캐시와 실제 클립 합 불일치 → TL-INV-4([V07](V07-timeline-model.md)) 연계 점검. **질량보존 판정을 느슨히 하지 말 것**(STOP-4).
- 계약 변경 필요 판단 시 임의 변경 금지(STOP-3). 같은 게이트 3회 연속 실패 → 중단 보고(STOP-1).
