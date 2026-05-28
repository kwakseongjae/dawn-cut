# V03 — 결정적 fixture 생성 + media:probe + Import E2E

> 검증 대상: 게이트 G1 / 체크리스트 1.1, 1.2, 1.4
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [05-ENVIRONMENT](../05-ENVIRONMENT.md) · [01-POC-DESIGN](../01-POC-DESIGN.md) §5

## 목적
모든 통합/E2E 테스트의 결정성 기반이 되는 고정 fixture(`sample.mp4` + `expected-transcript.json`)를 재현 가능하게 생성하고, ffprobe 기반 `media:probe`가 미디어 메타(길이/fps/오디오 유무)를 정확히 반환하며, Import 클릭 경로가 그 결과를 표시함을 증명한다. fixture가 결정적이지 않으면 G2/G5/G7의 판정이 무의미해진다([03-TEST-GATES](../03-TEST-GATES.md) §4).

## 전제조건
- G0 green(V01, V02).
- `scripts/setup-binaries.sh` 완료: FFmpeg/ffprobe 설치([05-ENVIRONMENT](../05-ENVIRONMENT.md) §2), `artifacts/env-ffmpeg.txt` 기록.
- macOS `say` 사용 가능(fixture TTS, [05](../05-ENVIRONMENT.md) §4).

## 산출물 (Deliverables)
- `scripts/make-fixture.sh`([05](../05-ENVIRONMENT.md) §4 본문 구현):
  - `say -v Samantha` → aiff → wav(16k mono), 문장 사이 의도적 무음 2구간 삽입(예: 2.0~3.0s, 6.0~6.8s),
  - `color=navy:s=640x360:r=30` 배경 + 오디오 → `fixtures/sample.mp4`(fps=30),
  - `fixtures/expected-transcript.json` 생성: `{ "keywords": [...], "silences": [{startUs,endUs},...], "fps": 30 }`.
- `sidecar/ffmpeg`의 probe 래퍼: ffprobe 호출 → `{ durationUs, fps, hasAudio }` 파싱(시간은 µs 정수, [04](../04-DATA-CONTRACTS.md) §0).
- main IPC 핸들러 `media:probe`([01](../01-POC-DESIGN.md) §5): 입력 `{ path }`(경로 화이트리스트 검증) → 출력 `{ durationUs, fps, hasAudio }`(zod 런타임 검증).
- 통합테스트 `tests/integration/probe.spec.ts`: `fixtures/sample.mp4` probe → 필드 단언.
- E2E `tests/e2e/import.spec.ts`: Import 버튼 클릭 → fixture 선택 → probe 결과(길이/fps) 화면 표시 단언.

## 검증 절차
```bash
# 1) 바이너리/모델 셋업 (이미 됐으면 스킵)
bash scripts/setup-binaries.sh

# 2) fixture 생성
bash scripts/make-fixture.sh
ls -l fixtures/sample.mp4 fixtures/expected-transcript.json

# 3) fixture 길이 직접 확인 (게이트 판정 근거)
ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 fixtures/sample.mp4

# 4) probe 통합테스트 + Import E2E
pnpm verify:int -g "probe"
pnpm verify:e2e -g "import"
```

## 자동 테스트 게이트
- 명령: `bash scripts/make-fixture.sh && pnpm verify:int -g "probe"`
- PASS 조건(기계 판정):
  - `fixtures/sample.mp4` 및 `fixtures/expected-transcript.json` 파일 **존재** ([03-TEST-GATES](../03-TEST-GATES.md) G1).
  - ffprobe 측정 길이 **∈ [9.5s, 12s]** ([03](../03-TEST-GATES.md) G1).
  - `media:probe`가 `durationUs`(정수 µs), `fps`(== 30), `hasAudio`(== true)를 반환([01](../01-POC-DESIGN.md) §5 출력 계약).
  - Import E2E: 클릭→파일선택→probe 결과(길이/fps)가 UI에 표시됨.

## 통과 기준 체크
- [x] `fixtures/sample.mp4` + `fixtures/expected-transcript.json` 생성됨
- [x] ffprobe 길이 ∈ [9.5s, 12s] — [03](../03-TEST-GATES.md) G1
- [x] `media:probe`가 `{durationUs, fps, hasAudio}` 반환 (fps==30, hasAudio==true)
- [x] Import 버튼 E2E: probe 결과 화면 표시
- [x] `pnpm verify:int -g "probe"` 종료코드 0

## 증거 (Evidence)
- [x] `fixtures/sample.mp4` 생성됨 (커밋 대상, [05](../05-ENVIRONMENT.md) §7)
- [x] `fixtures/expected-transcript.json` 생성됨 (키워드+무음+fps)

> 주: 오디오 추출(1.3)의 probe 증거 `artifacts/g1-audio-probe.json`는 [V04](V04-ffmpeg-audio-extract.md)에서 산출한다.

## 실패 시 (STOP)
- 환경 셋업(ffmpeg/say) 실패 → **STOP-2**: 임의 우회 금지, 환경 문제로 사람에게 보고([00-SEED](../00-SEED.md) §SAFETY, [05](../05-ENVIRONMENT.md) §5).
- 길이가 [9.5s,12s] 밖이라고 **fixture를 조작하거나 허용범위를 넓히는 것 금지** → **STOP-4**.
- 같은 게이트 3회 연속 실패 → **STOP-1**.
- 테스트 런타임 네트워크 금지(클론/모델 다운로드는 셋업 단계만) → **STOP-5**.
