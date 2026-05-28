# 05 — 환경 & 결정적 Fixture

> 에이전트가 **실제로 whisper.cpp + FFmpeg를 로컬에서 돌릴 수 있어야** 한다(사용자 결정).
> 모든 통합/E2E 테스트의 결정성은 여기서 만든 고정 fixture에 달려 있다.
>
> 관련: [03-TEST-GATES](03-TEST-GATES.md) · [V04](verification/V04-ffmpeg-audio-extract.md)·[V05](verification/V05-whisper-transcribe.md)

---

## 1. 대상 환경
- OS: macOS (Apple Silicon 우선, Intel 허용). PoC는 Mac 전용.
- Node ≥ 20, pnpm ≥ 9.
- Xcode Command Line Tools (whisper.cpp 빌드용).

## 2. FFmpeg / ffprobe
- 설치: `brew install ffmpeg` (LGPL 빌드 권장 — `--enable-gpl` 불요).
- 호출은 항상 **subprocess**(라이선스 분리, ARCHITECTURE §10).
- 버전 고정: `scripts/setup-binaries.sh`가 `ffmpeg -version`을 `artifacts/env-ffmpeg.txt`에 기록.

## 3. whisper.cpp
`scripts/setup-binaries.sh` 가 수행:
```bash
# 1) 클론 + 빌드 (vendor/whisper.cpp)
git clone --depth 1 https://github.com/ggml-org/whisper.cpp vendor/whisper.cpp
cmake -B vendor/whisper.cpp/build vendor/whisper.cpp && cmake --build vendor/whisper.cpp/build -j
# 2) 모델 다운로드 (base — 속도/정확도 균형, 영어+다국어)
bash vendor/whisper.cpp/models/download-ggml-model.sh base
```
- 바이너리 경로: `vendor/whisper.cpp/build/bin/whisper-cli` (버전에 따라 `main`).
- 모델: `ggml-base.bin`. (테스트 속도 위해 base 고정. tiny는 정확도 미달 위험)
- 출력은 JSON(`--output-json`) + **word 타임스탬프(`--max-len 1` 또는 `-ml 1` / `--word-thold`)**. 단어단위 타임스탬프 플래그는 빌드 버전에 맞춰 `whisper-cli --help`로 확인 후 래퍼에 고정.
- 라이선스: MIT (자유). NOTICE에 표기.

> 주의: whisper 버전에 따라 CLI 플래그가 바뀐다. 래퍼(`sidecar/stt`)는 **버전 감지 후 플래그 매핑**하고, 셋업 시 `whisper-cli --version`을 `artifacts/env-whisper.txt`에 기록.

## 4. 결정적 Fixture 생성 — `scripts/make-fixture.sh`

네트워크/저작권 없는 **재현 가능한** 내레이션 영상을 macOS `say`로 합성.

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p fixtures
SCRIPT="The quick brown fox jumps over the lazy dog. \
Dawn cut makes editing simple. We remove silence automatically."

# 1) TTS → aiff → wav (16k mono) — 알려진 정답 텍스트
say -v Samantha -o fixtures/voice.aiff "$SCRIPT"
ffmpeg -y -i fixtures/voice.aiff -ar 16000 -ac 1 fixtures/voice.wav

# 2) 의도적 무음 구간 삽입(테스트용): 문장 사이 1초 무음 2곳
#    (silenceN.wav 생성 후 concat — 상세는 스크립트 본문)
# 3) 색 배경 비디오 + 오디오 → sample.mp4 (fps=30)
ffmpeg -y -f lavfi -i color=c=navy:s=640x360:r=30 \
  -i fixtures/voice_with_silence.wav -shortest \
  -c:v libx264 -pix_fmt yuv420p -c:a aac fixtures/sample.mp4

# 4) 기대 전사 산출(키워드 집합) → expected-transcript.json
#    { "keywords": ["quick","brown","fox","dawn","cut","silence", ...],
#      "silences": [{"startUs":..,"endUs":..}, ...], "fps":30 }
```

산출물(커밋 대상):
- `fixtures/sample.mp4` — ~10s, 640x360, 30fps, 내레이션+무음 2구간.
- `fixtures/expected-transcript.json` — 기대 키워드 + 무음 구간 + fps.

> `say` 출력은 동일 머신/보이스에서 **결정적**. 테스트는 절대 타임스탬프가 아닌 **키워드 재현율 + 무음 IoU + 길이 허용오차**로 판정(03 §4).

## 5. 셋업 검증 (게이트 전제)
```bash
bash scripts/setup-binaries.sh   # ffmpeg/whisper/모델 준비, env 기록
bash scripts/make-fixture.sh     # fixtures 생성
pnpm verify:int -g "extractAudio|transcribe"  # G1/G2 스모크
```
실패 시 STOP하고 환경 문제를 사람에게 보고(00-SEED safety).

## 6. 비밀/네트워크
- PoC는 **외부 API·키 불필요**(전부 로컬). 네트워크는 셋업(클론/모델 다운로드) 단계에서만.
- 테스트 실행 시점에는 네트워크 의존 금지(결정성).

## 7. .gitignore 권장
```
vendor/        # whisper.cpp 소스/빌드
*.bin          # 모델
artifacts/     # 게이트 증거(CI 업로드)
fixtures/*.aiff
node_modules/
```
(단 `fixtures/sample.mp4`·`expected-transcript.json`은 커밋 — 결정성 위해. 용량 크면 Git LFS.)
