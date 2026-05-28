# V09 — 텍스트 기반 컷 deleteWordRange (property-based) ★ R2 핵심 / 최우선

> 검증 대상: G4 (4.1 deleteWordRange 구현, 4.2 명령 후 전 TL/SYNC 불변식 재성립, 4.3 undo 왕복, 4.4 질량보존)
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)

## 목적
dawn-cut 차별화 wedge 의 기술 성립성 그 자체인 **R2 — 텍스트 기반 편집** 을 증명한다. 전사에서 단어 범위를 지우면 타임라인이 **리플 컷**되고, 양방향 매핑([V08](V08-transcript-timeline-sync.md))과 모든 모델 불변식이 깨지지 않음을 **property-based 테스트(fast-check, ≥200 케이스, 고정 seed)** 로 증명한다.

이 문서는 PoC 전체에서 가장 중요하다(00-SEED GOAL: "가장 중요한 증명 대상(R2)"). 단일 예제가 아니라 랜덤 단어범위 전수에 가깝게 불변식을 강제한다.

### `deleteWordRange` 알고리즘 (01-POC-DESIGN §6 인용)
```
입력: fromWordId, toWordId (transcript.order 상 from ≤ to)
1. 범위 단어들의 source 구간 합치기:
   srcCut = union([w.sourceStart, w.sourceEnd) for w in range)  // 보통 연속 → [a, b)
2. 현재 타임라인에서 mediaId 일치하는 클립 c 중 [a,b)를 포함하는 클립 찾기
3. c 를 최대 3조각으로 분할:
     left  = [c.sourceStart, a)
     (gap  = [a, b)  ← 제거 대상)
     right = [b, c.sourceEnd)
4. left, right 만 남기고 right.timelineStart 를 left 끝으로 당김 (ripple)
5. 뒤따르는 모든 클립 timelineStart -= (b-a)
6. durationProgram 재계산, 모든 불변식 재검증(assert)
```
경계: 단어 구간이 클립 경계와 안 맞을 때는 **프레임 경계로 스냅(±1 frame)**. 빈 left/right 는 생성 안 함.

### 명령 의미론 (04 §4 인용)
```ts
type EditCommand = { type: 'deleteWordRange'; fromWordId: string; toWordId: string } | ...;
interface CommandResult {
  before: TimelineModel;    // undo 용 스냅샷(또는 역명령)
  after: TimelineModel;
  removedProgramUs: number; // 이 명령으로 줄어든 시간
}
```
1. `[fromWordId..toWordId]` 범위 단어들의 source 구간 합집합 계산.
2. 해당 source 구간을 덮는 클립을 **분할(split) 후 가운데 제거**.
3. 뒤 클립들을 앞으로 **당김(ripple)** → 틈 없음(TL-INV-2) 유지.
4. 삭제된 단어는 `wordToProgram == null` 이 됨.

## 전제조건
- [V06](V06-transcript-model.md), [V07](V07-timeline-model.md), [V08](V08-transcript-timeline-sync.md) green.
- `packages/core/timeline/commands/deleteWordRange.ts` 에 `apply()` 와 `undo()`(또는 `CommandResult.before` 복원)가 구현되어 있다.
- fast-check 설치, 시간 단위 정수 µs, fps=30(프레임=33,333µs).
- 테스트는 랜덤 입력이지만 **고정 seed**(03 §4: property test 고정 seed 기록)로 결정적 재현 가능.

## 산출물 (Deliverables)
- `packages/core/timeline/commands/deleteWordRange.ts` — apply/undo, `removedProgramUs` 산출, 프레임 경계 스냅.
- `tests/unit/deleteWordRange.property.test.ts` — fast-check property(≥200 케이스, 고정 seed).
- `artifacts/g4-property-report.txt` — 케이스 수, seed, 0 반례(반례 없음) 기록.

## 검증 절차
1. 임의 생성기(arbitrary): 결정적 base `TranscriptModel`+`TimelineModel`(통클립 1개)에서 `transcript.order` 상 유효한 `(fromIdx ≤ toIdx)` 쌍을 fast-check 로 생성. (여러 차례 연속 삭제 시퀀스도 케이스로 포함 가능)
2. 각 케이스마다 `before` 스냅샷 저장 → `deleteWordRange.apply()` → `after` 산출.
3. 불변식 단언 (전부 재성립해야 함):
   - **CMD-INV-1**: 명령 적용 후 모든 **TL-INV-1..4**([V07](V07-timeline-model.md)) / **SYNC-INV-1..3**([V08](V08-transcript-timeline-sync.md)) 재성립. (특히 TL-INV-2 gapless = 리플 성립, SYNC-INV-3 질량보존)
   - **CMD-INV-2 (undo 왕복)**: `apply` 후 `undo` 하면 모델이 **구조적으로 동일**(deep-equal, **id 포함**)하게 복원. `deepEqual(undo(apply(m)), before)`.
   - **CMD-INV-3 (질량보존)**: `removedProgramUs === before.durationProgram - after.durationProgram` ∧ `removedProgramUs >= 0`.
   - **SYNC-INV-2 (순서 부분수열)**: 삭제 후 살아있는 단어들의 program 순서 == `transcript.order` 의 부분수열.
4. 프레임 경계 스냅: 단어 구간이 클립/프레임 경계와 안 맞을 때 컷 경계가 프레임 그리드에 스냅되며, 길이 검증은 **±1 frame(33,333µs)** 허용오차로 판정(01-POC-DESIGN §6 / 04 §0). 그 외 정수 µs 일치 불변식(CMD-INV-3 등)은 스냅 후의 값으로 ±0 일관.
5. 케이스 ≥200, 0 반례 확인 후 리포트 기록.
6. 실행:
   ```bash
   pnpm verify:unit -g "deleteWordRange"
   ```

## 자동 테스트 게이트
- 명령: `pnpm verify:unit -g "deleteWordRange"`
- PASS 조건(기계 판정) — 03 §3 G4 / 04 §4 인용:
  - fast-check **≥ 200 케이스**, **0 반례(no counterexample)**, 고정 seed 기록.
  - **CMD-INV-1**: 각 케이스 after 에서 TL-INV-1..4 ∧ SYNC-INV-1..3 전부 true.
  - **CMD-INV-2**: `deepEqual(undo(apply), before) === true`(id 포함 구조적 동일).
  - **CMD-INV-3**: `removedProgramUs === before.durationProgram - after.durationProgram` ∧ `>= 0`.
  - **SYNC-INV-2**: 살아있는 단어 program 순서 = `order` 부분수열(true).
  - 프레임 경계 스냅: 컷 길이 ±1 frame(33,333µs) 이내(경계 미스매치 케이스), 그 외 불변식은 ±0 정수 µs.
  - Vitest 종료코드 0, 0 fail.

## 통과 기준 체크
- [x] `deleteWordRange` 가 01-POC-DESIGN §6 알고리즘(합집합→left/gap/right 분할→리플 당김)대로 동작.
- [x] property 케이스 ≥ 200, 0 반례, 고정 seed 기록.
- [x] CMD-INV-1 재성립(전 TL-INV/SYNC-INV).
- [x] CMD-INV-2 undo 왕복 deep-equal(id 포함).
- [x] CMD-INV-3 `removedProgramUs == before.dur - after.dur >= 0`.
- [x] SYNC-INV-2 살아있는 단어 순서 = order 부분수열.
- [x] 프레임 경계 스냅 ±1 frame 준수.
- [x] `pnpm verify:unit -g "deleteWordRange"` 종료코드 0.

## 증거 (Evidence)
- [x] `artifacts/g4-property-report.txt` — 실행 케이스 수(≥200), 고정 seed, 반례 0 명시.
- [x] Vitest 리포트(green) — `deleteWordRange` 그렙 매칭 테스트 전부 pass, 0 fail.
- [x] `artifacts/g3-coverage.txt` — commands 모듈 커버리지 포함(core 전체 ≥80%).

## 실패 시 (STOP)
- 반례 발견: fast-check 가 출력한 **최소 반례 + seed** 를 `artifacts/g4-property-report.txt` 에 기록하고 알고리즘 결함을 수정. **케이스 수/허용오차/판정을 느슨하게 바꿔 통과시키지 말 것**(00-SEED STOP-4 — 이 게이트가 R2 의 핵심 증거).
- CMD-INV-2 실패(undo 불일치): `before` 스냅샷이 얕은 복사이거나 id 재생성됨. deep clone/구조 보존 점검.
- TL-INV-2 위배(리플 후 틈): 5단계 "뒤따르는 모든 클립 timelineStart -= (b-a)" 누락 의심.
- 계약 변경 필요 판단 시 임의 변경 금지(STOP-3). 같은 게이트 3회 연속 실패 → 중단하고 최소 반례+seed+가설과 함께 보고(STOP-1).
