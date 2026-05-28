# V07 — TimelineModel + 파생함수 + 불변식(TL-INV) + 코어 경계

> 검증 대상: G3 (3.2 TimelineModel/파생함수/TL-INV-1..4, 3.3 코어 의존성 경계)
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)

## 목적
program(편집 결과) 좌표계의 `TimelineModel`([04-DATA-CONTRACTS §2](../04-DATA-CONTRACTS.md))을 구현하고, 파생 함수와 불변식 **TL-INV-1..4** 를 단위테스트로 증명한다. 또한 **★ `packages/core` 가 `electron`/`fs`/`child_process`/node-`path` 에 비의존**임을 dependency-cruiser boundary 테스트로 정적 강제하고(위반 0건), core 라인 커버리지 ≥80% 를 확보한다.

코어 격리는 00-SEED CONSTRAINTS 1 / 01-POC-DESIGN §4 "레이어 경계 계약"의 불변 조건이다. 파일·프로세스 접근은 전부 인터페이스 주입으로만 허용되며, 이래야 추후 모바일 코어 재사용 경로가 열린다(00-SEED NORTH-STAR).

대상 타입 (04 §2 인용):
```ts
interface Clip {
  id: string;
  mediaId: string;
  sourceStart: number;   // µs (source 좌표계)
  sourceEnd: number;     // µs
  timelineStart: number; // µs (program 좌표계)
  // timelineEnd 는 파생: timelineStart + (sourceEnd - sourceStart)
}
interface Track { id: string; kind: 'video' | 'audio'; clips: string[]; }  // timelineStart 오름차순
interface TimelineModel {
  schemaVersion: 1;
  fps: number;           // PoC = 30
  clips: Record<string, Clip>;
  tracks: Track[];
  durationProgram: number; // 파생/캐시: 마지막 clip 의 timelineEnd
}
```

## 전제조건
- [V06](V06-transcript-model.md) green (TranscriptModel 구성, 단일 소스 mediaId 확정).
- `packages/core/timeline/` 에 모델·파생함수·초기화(`initTimelineFromTranscript` → 통클립 1개) 구현.
- dependency-cruiser 설정(`.dependency-cruiser.cjs`)과 `pnpm boundary` 스크립트 존재.
- Vitest 커버리지(c8/v8) 설정으로 `packages/core` 라인 커버리지 측정 가능.

## 산출물 (Deliverables)
- `packages/core/timeline/model.ts` — `Clip`/`Track`/`TimelineModel` + zod 스키마.
- `packages/core/timeline/derive.ts` — `clipDuration(c)`, `clipTimelineEnd(c)` (04 §2 파생함수 정의 그대로).
- `tests/unit/timeline-model.test.ts` — TL-INV-1..4 단언.
- `.dependency-cruiser.cjs` — core → `electron|fs|child_process|path(node)` 금지 규칙.
- `artifacts/g3-boundary.txt` 또는 `artifacts/g0-boundary.txt` — boundary 결과(위반 0건).
- `artifacts/g3-coverage.txt` — core 라인 커버리지 ≥80%.

## 검증 절차
1. 파생함수 정의 확인 (04 §2):
   - `clipDuration(c) = c.sourceEnd - c.sourceStart`
   - `clipTimelineEnd(c) = c.timelineStart + clipDuration(c)`
2. 모델 불변식 단언:
   - **TL-INV-1 (비겹침)**: 한 트랙 내 program 좌표계에서 겹치지 않음 — `clipTimelineEnd(cᵢ) <= clipⱼ.timelineStart` for i<j (트랙 clips 는 timelineStart 오름차순).
   - **TL-INV-2 (gapless, PoC 한정)**: 비디오 트랙은 컷 후에도 틈 없음 — `clip[i+1].timelineStart == clipTimelineEnd(clip[i])` (정수 µs 정확 일치, 리플 편집의 정의).
   - **TL-INV-3**: 모든 클립 `sourceEnd > sourceStart` ∧ `timelineStart >= 0`.
   - **TL-INV-4**: `durationProgram == max(clipTimelineEnd)` (클립 없으면 0).
3. 초기화 케이스: `initTimelineFromTranscript` 가 통클립 1개([sourceStart=0, sourceEnd=소스길이), timelineStart=0)를 생성하고 TL-INV-1..4 를 만족하는지 확인.
4. ★ 코어 경계 정적 검사:
   ```bash
   pnpm boundary
   ```
   `packages/core/**` 가 `electron`, `fs`, `node:fs`, `child_process`, `node:child_process`, `path`, `node:path` 를 import 하지 않음을 dependency-cruiser 가 검출 → 위반 0건.
5. 커버리지 측정 후 `artifacts/g3-coverage.txt` 기록:
   ```bash
   pnpm verify:unit -g "timeline" --coverage
   ```
6. 실행:
   ```bash
   pnpm verify:unit -g "timeline"
   pnpm boundary
   ```

## 자동 테스트 게이트
- 명령:
  - `pnpm verify:unit -g "timeline"`
  - `pnpm boundary`
- PASS 조건(기계 판정) — 03 §3 G3 인용:
  - TL-INV-1: 인접 클립 `clipTimelineEnd(cᵢ) <= cⱼ.timelineStart`.
  - TL-INV-2: 인접 클립 `clip[i+1].timelineStart === clipTimelineEnd(clip[i])` (±0, 정수 µs).
  - TL-INV-3: 모든 클립 `sourceEnd > sourceStart` ∧ `timelineStart >= 0`.
  - TL-INV-4: `durationProgram === max(clipTimelineEnd)` (clips 없으면 `=== 0`).
  - 파생함수 `clipDuration`/`clipTimelineEnd` 가 정의 그대로 계산.
  - `pnpm boundary` → core 위반 **0건** (electron|fs|child_process|node-path import 0).
  - core 라인 커버리지 **≥ 80%** (`artifacts/g3-coverage.txt`).
  - Vitest 종료코드 0, 0 fail.

## 통과 기준 체크
- [x] `clipDuration` / `clipTimelineEnd` 가 04 §2 정의와 일치한다.
- [x] TL-INV-1 단언 통과(program 좌표계 비겹침).
- [x] TL-INV-2 단언 통과(gapless, 인접 클립 정확 인접).
- [x] TL-INV-3 단언 통과(sourceEnd>sourceStart, timelineStart≥0).
- [x] TL-INV-4 단언 통과(durationProgram == max(clipTimelineEnd)).
- [x] `pnpm boundary` 위반 0건 — core 가 electron/fs/child_process/node-path 비의존.
- [x] core 라인 커버리지 ≥ 80%.
- [x] `pnpm verify:unit -g "timeline"` 종료코드 0.

## 증거 (Evidence)
- [x] `artifacts/g3-coverage.txt` — core 라인 커버리지 ≥ 80% 수치 기록.
- [x] `artifacts/g0-boundary.txt`(또는 `artifacts/g3-boundary.txt`) — dependency-cruiser 결과, core 위반 0건.
- [x] Vitest 리포트(green) — `timeline` 그렙 매칭 테스트 전부 pass.

## 실패 시 (STOP)
- boundary 위반 발생(core 가 fs/electron 등 import): 해당 의존을 인터페이스 주입으로 전환(01-POC-DESIGN §4). **boundary 규칙을 약화시키지 말 것**(00-SEED STOP-4). core 격리는 불변 제약(CONSTRAINTS 1).
- TL-INV-2 위배(틈 발생): 리플/초기화 로직 결함. 정수 µs 정확 일치를 요구하며 허용오차를 도입하지 않는다(04 §2 는 ±0 정수 µs).
- 커버리지 <80%: 테스트 보강. 임계값을 낮추지 말 것.
- 계약 변경 필요 판단 시 임의 변경 금지(STOP-3). 같은 게이트 3회 연속 실패 → 중단 보고(STOP-1).
