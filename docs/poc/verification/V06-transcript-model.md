# V06 — TranscriptModel 구성 + 불변식(T-INV)

> 검증 대상: G3 (3.1) — TranscriptModel 구성 + T-INV-1..4 단위테스트
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)

## 목적
whisper.cpp 출력(단어 타임스탬프 JSON, IPC `stt:transcribe` 의 `WhisperWordsJson`)을 [04-DATA-CONTRACTS §1](../04-DATA-CONTRACTS.md) 의 `TranscriptModel` 로 정규화하고, 그 결과가 불변식 **T-INV-1..4** 를 만족함을 단위테스트로 증명한다.

이 모델은 R2(전사↔타임라인 동기화)의 입력 측 진실 원천이다. `order`(전역 표시 순서)와 `words`(id→Word)의 정합성이 깨지면 이후 SyncMap([V08](V08-transcript-timeline-sync.md))·deleteWordRange([V09](V09-text-based-cut.md))가 전부 무너지므로, 여기서부터 계약을 정확히 강제한다.

대상 타입 (04 §1 인용):
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
  language: string;
  words: Record<string, Word>;       // id → Word
  order: string[];                   // Word.id 의 전역 표시 순서
  segments: TranscriptSegment[];
}
```

## 전제조건
- G2 green: `stt:transcribe` 가 fixture(`fixtures/sample.mp4`→wav) 전사를 산출하고, `artifacts/g2-words.json` 가 존재한다.
- `packages/core/transcript/` 에 `buildTranscriptModel(whisperWords, mediaId, language)` 빌더와 zod 스키마가 구현되어 있다.
- 시간 단위는 정수 µs (04 §0). 부동소수 누적 금지.
- 테스트는 `fixtures/` 고정 자산만 사용 (네트워크/랜덤 입력 금지, 00-SEED CONSTRAINTS 5).

## 산출물 (Deliverables)
- `packages/core/transcript/model.ts` — `Word`/`TranscriptSegment`/`TranscriptModel` 타입 + `buildTranscriptModel()`.
- `packages/core/transcript/model.schema.ts` — zod 런타임 스키마(계약 일치 강제, 04 §6: 불일치 = 빌드 실패).
- `tests/unit/transcript-model.test.ts` — T-INV-1..4 단언 테스트(고정 fixture + `artifacts/g2-words.json` 정규화 케이스 포함).

## 검증 절차
1. 빌더 입력 준비: `artifacts/g2-words.json`(G2 산출) 및 결정적 인라인 fixture 단어 시퀀스를 사용한다.
2. `buildTranscriptModel()` 호출 → `TranscriptModel` 생성. zod 스키마로 파싱하여 형태 일치를 먼저 강제한다.
3. 불변식 단언:
   - **T-INV-1 (order↔words 정합)**: `order` 의 모든 id 가 `words` 에 존재하고, `words` 의 모든 키가 `order` 에 **정확히 1번** 등장. (`new Set(order).size === order.length` 이고 `Object.keys(words)` 와 집합 동일)
   - **T-INV-2 (단조 비감소)**: `order` 순서대로 `sourceStart` 가 **non-decreasing**. (`words[order[i]].sourceStart <= words[order[i+1]].sourceStart` for all i) — whisper word 타임스탬프 시간순.
   - **T-INV-3**: 각 Word 가 `sourceEnd > sourceStart`.
   - **T-INV-4**: 정규화 후 `text` 가 비어있지 않음(빈/공백-only 토큰 제거됨).
4. 정규화 경계 케이스: 빈 토큰 입력 → T-INV-4 위배 없이 제거됨을 확인. `schemaVersion === 1`, `confidence ∈ [0,1]` 확인.
5. 실행:
   ```bash
   pnpm verify:unit -g "transcript"
   ```

## 자동 테스트 게이트
- 명령: `pnpm verify:unit -g "transcript"`
- PASS 조건(기계 판정): 아래 4개 단언이 전부 true (04 §1 인용, 03 §3 G3 판정 "T-INV-1..4 단언 통과")
  - T-INV-1: `Object.keys(words)` 집합 == `order` 집합 ∧ `order` 중복 없음.
  - T-INV-2: 모든 인접쌍에서 `sourceStart` non-decreasing (`<=`).
  - T-INV-3: 모든 Word `sourceEnd > sourceStart`.
  - T-INV-4: 모든 Word `text.trim().length > 0`.
  - zod 파싱 성공(`schemaVersion === 1`, 04 계약과 형태 일치).
  - Vitest 종료코드 0, 0 fail.

## 통과 기준 체크
- [x] `buildTranscriptModel()` 가 zod 스키마를 통과하는 `TranscriptModel`(schemaVersion=1)을 생성한다.
- [x] T-INV-1 단언 통과(order↔words 정확 1:1).
- [x] T-INV-2 단언 통과(sourceStart 단조 비감소).
- [x] T-INV-3 단언 통과(sourceEnd>sourceStart).
- [x] T-INV-4 단언 통과(빈 토큰 제거, text 비공백).
- [x] `pnpm verify:unit -g "transcript"` 종료코드 0.

## 증거 (Evidence)
- [x] `artifacts/g2-words.json` — 정규화 입력(G2에서 생성, 본 테스트가 소비).
- [x] Vitest 리포트(green) — `transcript` 그렙 매칭 테스트 전부 pass, 0 fail.
- [x] `artifacts/g3-coverage.txt` 에 transcript 모듈 커버리지가 포함됨(전체 core 라인 ≥80%, [V07](V07-timeline-model.md) 게이트와 공유).

## 실패 시 (STOP)
- T-INV-2 위배(타임스탬프 역전): whisper 출력 정렬/병합 로직 결함 가능. 빌더에서 `order` 를 `sourceStart` 기준 안정 정렬하되 **fixture/허용오차를 조작해 통과시키지 말 것**(00-SEED STOP-4). 03 §4: whisper 미세편차는 단조성으로 판정하므로 절대값을 느슨하게 하지 않는다.
- 계약 불일치(zod 파싱 실패): 04 §6 에 따라 빌드 실패로 간주. 계약 변경이 필요하면 임의 변경 금지, 사람 승인 요청(STOP-3).
- 같은 게이트 3회 연속 실패 → 중단하고 실패 로그+가설과 함께 보고(STOP-1).
