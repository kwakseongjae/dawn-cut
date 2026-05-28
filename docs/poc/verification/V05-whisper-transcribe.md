# V05 — whisper.cpp 전사 (단어 타임스탬프 + 재현율 + 단조성)

> 검증 대상: 게이트 G2 / 체크리스트 2.1, 2.2, 2.3
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) · [05-ENVIRONMENT](../05-ENVIRONMENT.md)

## 목적
가설 H2를 실증한다: whisper.cpp 로컬 STT가 결정적 fixture에서 단어 타임스탬프를 실용 정확도로 산출한다. 알려진 키워드 재현율 ≥ 0.90, 타임스탬프 단조 비감소(T-INV-2), 각 word `sourceEnd > sourceStart`(T-INV-3)를 보장한다. 이 출력이 이후 TranscriptModel(G3)과 R2 동기화(G4)의 입력이 되므로 품질 하한을 여기서 고정한다.

## 전제조건
- G0, G1 green(V01~V04): `fixtures/sample.mp4`, 16kHz mono wav 추출 동작.
- `scripts/setup-binaries.sh` 완료([05](../05-ENVIRONMENT.md) §3):
  - `vendor/whisper.cpp` 클론+빌드, 모델 `ggml-base.bin` 다운로드,
  - 바이너리 `vendor/whisper.cpp/build/bin/whisper-cli`(버전에 따라 `main`),
  - `whisper-cli --version`을 `artifacts/env-whisper.txt`에 기록.

## 산출물 (Deliverables)
- `sidecar/stt`의 whisper 래퍼:
  - subprocess로 whisper.cpp 실행, `--output-json` + 단어단위 타임스탬프 플래그(`-ml 1`/`--max-len 1` 등, **빌드 버전 감지 후 플래그 매핑** — [05](../05-ENVIRONMENT.md) §3 주의),
  - 출력 파싱 → `WhisperWordsJson`(각 word `{ text, sourceStart, sourceEnd, confidence }`, 시간은 µs 정수 — [04](../04-DATA-CONTRACTS.md) §0, §1 `Word`),
  - 모델은 `ggml-base` 고정(tiny 금지 — [05](../05-ENVIRONMENT.md) §3).
- main IPC 핸들러 `stt:transcribe`([01](../01-POC-DESIGN.md) §5): 입력 `{ wavPath, lang? }` → 출력 `WhisperWordsJson`(zod 검증).
- 재현율 계산 유틸: `expected-transcript.json`의 `keywords` 대비 전사 토큰을 **정규화(소문자/구두점 제거) 후 집합 비교**([03](../03-TEST-GATES.md) §4).
- 통합테스트 `tests/integration/transcribe.spec.ts`: 실제 whisper.cpp 실행 → 재현율/단조성/구간 단언, `artifacts/g2-words.json` 및 `artifacts/g2-recall.txt` 기록.

## 검증 절차
```bash
# 1) (전제) 바이너리/모델 셋업
bash scripts/setup-binaries.sh
cat artifacts/env-whisper.txt   # 버전 기록 확인

# 2) 전사 통합테스트 (실제 whisper.cpp 실행)
pnpm verify:int -g "transcribe"

# 산출: artifacts/g2-words.json (단어 타임스탬프 JSON)
#       artifacts/g2-recall.txt (재현율 수치)
```

## 자동 테스트 게이트
- 명령: `pnpm verify:int -g "transcribe"`
- PASS 조건(기계 판정), [03-TEST-GATES](../03-TEST-GATES.md) G2:
  - **재현율 ≥ 0.90**: `expected-transcript.json.keywords` 집합 대비 정규화 후 토큰 비교(matched / |keywords| ≥ 0.90).
  - **타임스탬프 단조 비감소(T-INV-2)**: 출력 순서대로 `sourceStart`가 non-decreasing ([04](../04-DATA-CONTRACTS.md) §1 T-INV-2).
  - **모든 word `sourceEnd > sourceStart`(T-INV-3)** ([04](../04-DATA-CONTRACTS.md) §1 T-INV-3).
  - 판정은 **절대 타임스탬프 값이 아닌** 단조성·재현율로만 한다(whisper 비결정 미세편차 허용 — [03](../03-TEST-GATES.md) §4).
  - `artifacts/g2-words.json`, `artifacts/g2-recall.txt` 생성됨.

## 통과 기준 체크
- [x] whisper.cpp 바이너리+`ggml-base` 모델 셋업 완료(`artifacts/env-whisper.txt` 존재)
- [x] `stt:transcribe`가 단어 타임스탬프 JSON(`WhisperWordsJson`) 반환
- [x] 키워드 재현율 ≥ 0.90 (정규화 후 토큰 비교) — [03](../03-TEST-GATES.md) G2
- [x] 타임스탬프 단조 비감소 (T-INV-2) — [04](../04-DATA-CONTRACTS.md) §1
- [x] 모든 word `sourceEnd > sourceStart` (T-INV-3) — [04](../04-DATA-CONTRACTS.md) §1
- [x] `pnpm verify:int -g "transcribe"` 종료코드 0

## 증거 (Evidence)
- [x] `artifacts/g2-words.json` 생성됨 (단어 타임스탬프) — [03](../03-TEST-GATES.md) G2 증거와 일치
- [x] `artifacts/g2-recall.txt` 생성됨 (재현율 ≥ 0.90 기록) — [03](../03-TEST-GATES.md) G2 증거와 일치

## 실패 시 (STOP)
- whisper 빌드/모델 다운로드/ffmpeg 셋업 실패 → **STOP-2**: 임의 우회 금지, 환경 문제로 사람 보고([00-SEED](../00-SEED.md) §SAFETY, [05](../05-ENVIRONMENT.md) §5).
- 재현율 0.90 임계나 단조성/구간 판정을 느슨하게 바꾸거나 fixture를 조작하는 것 금지 → **STOP-4**.
- 같은 게이트 3회 연속 실패 → **STOP-1**(중단·보고).
- 테스트 런타임 네트워크 금지(클론/모델 다운로드는 셋업 단계만) → **STOP-5**.
