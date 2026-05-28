# V10 — 자동 무음 검출(silencedetect) + removeSilences 리플 컷

> 검증 대상: 게이트 G5 / 체크리스트 5.1, 5.2, 5.3
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)

## 목적
가설 H4의 검증. FFmpeg `silencedetect` 출력을 파싱해 fixture에 의도적으로 삽입된 무음 구간을 정확히 검출하고(`analyze:silence`), 그 구간을 `removeSilences` 명령으로 리플 컷해 타임라인 길이가 "무음만큼만" 줄어드는지 증명한다. 무음 제거는 텍스트 기반 편집(deleteWordRange, [V09](V09-text-based-cut.md))과 동일한 리플 컷 메커니즘을 재사용하므로, 여기서 모든 TL-INV/SYNC-INV/CMD-INV가 재성립해야 한다.

## 전제조건
- 선행 게이트 green: G0~G4 (특히 [V09](V09-text-based-cut.md)의 deleteWordRange 리플 컷 — removeSilences가 동일 분할/당김 로직을 공유).
- 환경([05-ENVIRONMENT](../05-ENVIRONMENT.md)): `brew install ffmpeg`(LGPL, `--enable-gpl` 금지), FFmpeg가 subprocess로 호출 가능.
- fixture 존재([05-ENVIRONMENT](../05-ENVIRONMENT.md) §4): `fixtures/sample.mp4` — 문장 사이에 **의도적 무음 1초 2곳**이 삽입됨. `fixtures/expected-transcript.json`의 `silences: [{startUs, endUs}, ...]`(2개) + `fps: 30`이 기대 정답.
- 시간 단위는 정수 µs([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §0). 부동소수 누적 금지.

## 산출물 (Deliverables)
- `analyze:silence` IPC 핸들러([01-POC-DESIGN](../01-POC-DESIGN.md) §5): 입력 `{path, noiseDb, minSilenceUs}` → 출력 `{silences: [{start, end}]}`(정수 µs).
  - FFmpeg `-af silencedetect=noise=<noiseDb>:d=<minSilence초>` 실행 → stderr의 `silence_start`/`silence_end` 라인 파싱 → 초(소수) → µs 정수 변환(반올림, 부동소수 누적 금지).
- `removeSilences` 편집 명령([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §4): `{ type: 'removeSilences'; minSilenceUs: number; padUs: number }`.
  - 검출된 각 무음 구간 `[start, end)`에 `padUs`를 안쪽으로 적용(`[start+pad, end-pad)`만 제거 → 단어 머리/꼬리 보호), 해당 source 구간을 덮는 클립을 분할 후 가운데 제거, 뒤 클립을 당김(리플) → 틈 없음([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) TL-INV-2) 유지.
  - 결과 `CommandResult { before, after, removedProgramUs }` 반환.
- silence 통합/코어 테스트 + 증거 `artifacts/g5-silence.json`.

## 검증 절차
```bash
# 0) 선행: fixture/바이너리 준비 (이미 G1에서 수행됐다면 생략)
bash scripts/setup-binaries.sh
bash scripts/make-fixture.sh

# 1) silencedetect 검출 + removeSilences 컷 통합테스트 실행
pnpm verify:int -g "silence"

# 2) 증거 JSON 확인 (검출 구간 vs 기대 구간 IoU, 컷 전후 durationProgram)
#    artifacts/g5-silence.json 의 detected/expected/iou/durations 필드 확인
```
검증 흐름:
1. `analyze:silence(sample.mp4, noiseDb, minSilenceUs)` → 검출 구간 배열을 얻는다.
2. 검출 구간 각각을 `expected-transcript.json.silences`의 대응 구간과 매칭해 **IoU**(교집합/합집합) 계산.
3. 검출 구간으로 `removeSilences` 적용 → `after.durationProgram` 과 `before.durationProgram - Σ(제거된 무음 길이)` 비교.
4. 명령 후 [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)의 TL-INV-1..4 / SYNC-INV-1..3 / CMD-INV-1..3 재성립 단언.

## 자동 테스트 게이트
- 명령: `pnpm verify:int -g "silence"`
- PASS 조건(기계 판정):
  - 검출된 각 무음 구간과 fixture 기대 구간([05-ENVIRONMENT](../05-ENVIRONMENT.md) §4의 의도적 무음 2곳)의 **IoU ≥ 0.8**([03-TEST-GATES](../03-TEST-GATES.md) G5).
  - `removeSilences` 후 `durationProgram == 원본 durationProgram - Σ(제거된 무음 길이)` **±1 frame(= 33,333µs, fps=30)** ([03-TEST-GATES](../03-TEST-GATES.md) G5, 허용오차 [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §0).
  - 명령 후 TL-INV-1..4(겹침 없음/gapless/양수 길이/durationProgram 일치), SYNC-INV-1..3(라운드트립/순서 부분수열/질량보존), CMD-INV-3(`removedProgramUs == before.dur - after.dur ≥ 0`) 전부 재성립([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §2·§3·§4).
  - 모든 시간 값이 정수 µs([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §0).
  - 종료코드 == 0.

## 통과 기준 체크
- [x] `analyze:silence`가 silencedetect stderr를 파싱해 `{silences:[{start,end}]}`(정수 µs) 반환 — 5.1
- [x] 검출 무음 구간 2곳 각각 기대 구간과 IoU ≥ 0.8 — [03](../03-TEST-GATES.md) G5
- [x] `removeSilences`가 pad 적용 후 리플 컷, TL-INV-2(gapless) 유지 — 5.2
- [x] 컷 후 `durationProgram == 원본 - Σ무음 ±1frame(33,333µs)` — 5.3, [04](../04-DATA-CONTRACTS.md) §0
- [x] 명령 후 TL-INV-1..4 / SYNC-INV-1..3 / CMD-INV-3 재성립 — [04](../04-DATA-CONTRACTS.md) CMD-INV-1
- [x] FFmpeg subprocess 호출, `--enable-gpl` 미사용 — [00-SEED](../00-SEED.md) CONSTRAINTS 3

## 증거 (Evidence)
- [x] `artifacts/g5-silence.json` 생성됨 — 검출 구간(`detected`), 기대 구간(`expected`), 각 IoU(`iou ≥ 0.8`), 컷 전/후 `durationProgram`, `Σ무음`, `removedProgramUs` 기록 ([03](../03-TEST-GATES.md) G5 증거와 일치)

## 실패 시 (STOP)
- 같은 게이트 3회 연속 실패 → **STOP-1**: 중단하고 실패 로그+가설과 함께 사람에게 보고([00-SEED](../00-SEED.md) §SAFETY).
- whisper 빌드/모델/ffmpeg 등 환경 셋업 실패 → **STOP-2**: 임의 우회 금지, 사람에게 보고.
- IoU 임계값(0.8)·길이 허용오차(±1frame)를 느슨하게 바꾸거나 fixture의 무음 구간을 조작해 통과시키는 것 금지 → **STOP-4**.
- 테스트 통과를 위해 계약([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)) 변경이 필요하면 임의 변경 금지 → **STOP-3**(사람 승인).
