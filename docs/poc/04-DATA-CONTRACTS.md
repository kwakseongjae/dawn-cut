# 04 — 데이터 계약 (Data Contracts)

> PoC의 **단일 진실 원천(single source of truth)**. 모든 모듈·테스트·검증 문서는 이 계약을 참조한다.
> 이 계약이 깨지면 PoC는 실패다. 여기 정의된 타입·불변식·허용오차는 자동테스트의 판정 근거가 된다.
>
> 관련: [01-POC-DESIGN](01-POC-DESIGN.md) · [03-TEST-GATES](03-TEST-GATES.md) · 검증 [V06](verification/V06-transcript-model.md)·[V07](verification/V07-timeline-model.md)·[V08](verification/V08-transcript-timeline-sync.md)

---

## 0. 단위·규약 (모든 모듈 공통)

| 항목 | 규약 |
|---|---|
| 시간 단위 | **마이크로초(µs) 정수** (`bigint` 또는 안전한 number 범위 내 정수). 부동소수 누적오차 금지 |
| 시간 표기 | `t`(절대 µs), `start`/`end`(반열린구간 `[start, end)`) |
| 좌표계 | source(원본 미디어 타임라인) vs program(편집 결과 타임라인) 명확히 구분 |
| ID | `crypto.randomUUID()` 문자열. 모델 내 유일 |
| 직렬화 | JSON (`.dawn` = 단일 JSON 파일, `schemaVersion` 필수) |
| 허용오차 | 시간 비교 기본 tolerance = **±1 frame** (PoC fps=30 → 33,333µs). 명시된 곳에서만 사용 |

---

## 1. TranscriptModel (전사 모델)

whisper.cpp 출력(단어 타임스탬프)을 정규화한 불변 데이터 + 편집 상태.

```ts
interface Word {
  id: string;
  text: string;          // 표시 토큰 (공백/구두점 포함 정규화 전 원문 보존)
  sourceStart: number;   // 원본 미디어 기준 µs
  sourceEnd: number;     // 원본 미디어 기준 µs (sourceEnd > sourceStart)
  confidence: number;    // 0..1
  mediaId: string;       // 어느 소스 미디어의 단어인가
}

interface TranscriptSegment {
  id: string;
  words: string[];       // Word.id 순서 배열
  speaker?: string;      // PoC는 단일 화자 가정, 필드만 예약
}

interface TranscriptModel {
  schemaVersion: 1;
  mediaId: string;
  language: string;      // whisper 감지/지정 언어
  words: Record<string, Word>;       // id → Word
  order: string[];       // Word.id 의 전역 표시 순서
  segments: TranscriptSegment[];
}
```

### 불변식 (T-INV)
- **T-INV-1**: `order`의 모든 id는 `words`에 존재하고, `words`의 모든 키는 `order`에 정확히 1번 등장.
- **T-INV-2**: `order` 순서대로 `sourceStart`는 **단조 비감소**(non-decreasing). (whisper word 타임스탬프는 시간순)
- **T-INV-3**: 각 Word는 `sourceEnd > sourceStart`.
- **T-INV-4**: 정규화 후 `text`는 비어있지 않음(빈 토큰 제거됨).

---

## 2. TimelineModel (타임라인 모델)

program(편집 결과) 좌표계의 트랙·클립 구조. PoC는 **단일 비디오 트랙 + 1개 소스**로 한정하되 모델은 다중 대비.

```ts
interface Clip {
  id: string;
  mediaId: string;
  // source 좌표계: 원본 미디어에서 잘라온 구간
  sourceStart: number;   // µs
  sourceEnd: number;     // µs
  // program 좌표계: 결과 타임라인에 놓인 위치
  timelineStart: number; // µs (program)
  // timelineEnd 는 파생: timelineStart + (sourceEnd - sourceStart)
}

interface Track {
  id: string;
  kind: 'video' | 'audio';
  clips: string[];       // Clip.id, timelineStart 오름차순
}

interface TimelineModel {
  schemaVersion: 1;
  fps: number;           // PoC = 30
  clips: Record<string, Clip>;
  tracks: Track[];
  durationProgram: number; // 파생/캐시: 마지막 clip의 timelineEnd
}
```

### 파생 함수
- `clipDuration(c) = c.sourceEnd - c.sourceStart`
- `clipTimelineEnd(c) = c.timelineStart + clipDuration(c)`

### 불변식 (TL-INV)
- **TL-INV-1**: 한 트랙 내 클립들은 program 좌표계에서 **겹치지 않음** (`clipTimelineEnd(cᵢ) ≤ clipⱼ.timelineStart` for i<j).
- **TL-INV-2 (gapless, PoC 한정)**: 비디오 트랙은 컷 후에도 **틈 없음** — 즉 `clip[i+1].timelineStart == clipTimelineEnd(clip[i])`. (리플 편집의 정의)
- **TL-INV-3**: 모든 클립 `sourceEnd > sourceStart`, `timelineStart ≥ 0`.
- **TL-INV-4**: `durationProgram == max(clipTimelineEnd)` (클립 없으면 0).

---

## 3. SyncMap (전사 ↔ 타임코드 매핑) — ★ PoC 핵심(R2)

전사 단어와 타임라인 클립을 잇는 양방향 매핑. PoC 성패가 여기 달림.

```ts
// 단어 → program 시간 구간 (현재 편집 상태 기준)
function wordToProgram(wordId: string): { start: number; end: number } | null;
// program 시간 t → 그 시점에 재생되는 단어
function programToWord(tProgram: number): string | null;
```

매핑 규칙:
- Word의 `[sourceStart, sourceEnd)`가 **현재 타임라인에 살아있는 클립**(같은 mediaId, source 구간 포함)에 포함되면 → 해당 클립의 source→program 오프셋으로 변환.
- 단어가 어떤 살아있는 클립에도 포함되지 않으면(=컷되어 사라짐) → `wordToProgram` 은 `null`, UI에서 "삭제됨(취소선)" 표시.

### 불변식 (SYNC-INV)
- **SYNC-INV-1 (단방향 일관성)**: 살아있는 모든 Word에 대해 `programToWord(wordToProgram(w).start) == w` (라운드트립).
- **SYNC-INV-2 (보존)**: 어떤 편집 후에도, 살아있는 단어들의 program 순서 == TranscriptModel.order 의 부분수열(subsequence). (단어 순서는 절대 뒤집히지 않음)
- **SYNC-INV-3 (질량 보존)**: `durationProgram == Σ(살아있는 클립의 duration)`. 컷한 만큼만 줄어든다.

---

## 4. EditCommand (편집 명령) + Undo

모든 편집은 명령으로 표현. PoC 필수 명령 2종.

```ts
type EditCommand =
  | { type: 'deleteWordRange'; fromWordId: string; toWordId: string }   // 전사에서 단어범위 삭제
  | { type: 'removeSilences'; minSilenceUs: number; padUs: number };    // 자동 무음 제거

interface CommandResult {
  before: TimelineModel;   // undo 용 스냅샷(또는 역명령)
  after: TimelineModel;
  removedProgramUs: number; // 이 명령으로 줄어든 시간
}
```

### `deleteWordRange` 의미론
1. `[fromWordId..toWordId]` 범위 단어들의 source 구간 합집합 계산.
2. 해당 source 구간을 덮는 클립을 **분할(split) 후 가운데 제거**.
3. 뒤 클립들을 앞으로 **당김(ripple)** → 틈 없음(TL-INV-2) 유지.
4. 삭제된 단어는 `wordToProgram == null` 이 됨.

### 불변식 (CMD-INV)
- **CMD-INV-1**: 명령 적용 후 모든 TL-INV / SYNC-INV 재성립.
- **CMD-INV-2 (undo 왕복)**: `apply` 후 `undo` 하면 모델이 **구조적으로 동일**(deep-equal, id 포함).
- **CMD-INV-3**: `removedProgramUs == before.durationProgram - after.durationProgram ≥ 0`.

---

## 5. EDL (Export Decision List) — 렌더 입력

타임라인을 FFmpeg가 이해할 렌더 명세로 변환한 결과.

```ts
interface EdlSegment {
  mediaPath: string;
  sourceStart: number;   // µs
  sourceEnd: number;     // µs
  programStart: number;  // µs (검증용)
}
interface Edl {
  fps: number;
  segments: EdlSegment[]; // programStart 오름차순, 연속
  totalDuration: number;  // µs == Σ segment 길이
}
```

### 불변식 (EDL-INV)
- **EDL-INV-1**: `Σ(sourceEnd-sourceStart) == totalDuration`.
- **EDL-INV-2**: `totalDuration == TimelineModel.durationProgram` (±0, 정수 µs).
- **EDL-INV-3 (export 검증)**: 렌더된 MP4의 실제 길이(ffprobe) == `totalDuration` **±1 frame**(33,333µs). → [V12](verification/V12-export-ffmpeg.md)

---

## 6. 계약 버전 관리
- 모든 모델에 `schemaVersion`. PoC = `1`.
- 계약 변경 시 이 문서 + 관련 검증 문서 + 게이트 동시 갱신. 계약과 코드 불일치는 **빌드 실패로 간주**.
