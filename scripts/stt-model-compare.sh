#!/usr/bin/env bash
# 주어진 whisper 모델로 한국어 fixture(voice.wav)를 자연모드 전사하고,
# Cycle-0에서 base가 틀린 어휘(무음/한번/구두점)가 교정됐는지 체크한다.
# 사용: bash scripts/stt-model-compare.sh <model-name-or-path>
#   예: bash scripts/stt-model-compare.sh base
#       bash scripts/stt-model-compare.sh large-v3-turbo
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BIN="vendor/whisper.cpp/build/bin/whisper-cli"
WAV="artifacts/stt-spike/voice.wav"
MODELS_DIR="vendor/whisper.cpp/models"

MODEL_ARG="${1:-base}"
case "$MODEL_ARG" in
  */*|*.bin) MODEL="$MODEL_ARG" ;;            # 경로면 그대로
  *)         MODEL="$MODELS_DIR/ggml-$MODEL_ARG.bin" ;;  # 이름이면 표준 경로
esac

[ -f "$WAV" ]   || { echo "❌ $WAV 없음 — 먼저: bash scripts/stt-korean-spike.sh"; exit 1; }
[ -f "$MODEL" ] || { echo "❌ 모델 없음: $MODEL"; exit 1; }

OUT="artifacts/stt-spike/cmp-$(basename "$MODEL" .bin)"
echo "== model: $MODEL =="
T0=$(python3 -c 'import time;print(time.time())')
"$BIN" -m "$MODEL" -f "$WAV" -l ko -oj -ojf -of "$OUT" -np >/dev/null 2>&1
T1=$(python3 -c 'import time;print(time.time())')

python3 - "$OUT.json" "$T0" "$T1" <<'PY'
import json, sys
j = json.load(open(sys.argv[1], encoding='utf-8'))
elapsed = float(sys.argv[3]) - float(sys.argv[2])
txt = ''.join(s.get('text','') for s in j.get('transcription', [])).strip()
print("transcript:", txt)
print(f"elapsed: {elapsed:.1f}s")
checks = {
  "무음(not 몸)":   ("무음" in txt and "몸 구간" not in txt),
  "한번(not 한 번)": ("한번" in txt),
  "써 보세요/써보세요": ("써 보세요" in txt or "써보세요" in txt),
  "첫문장 마침표":   ("안녕하세요." in txt),
}
print("checks:")
for k,v in checks.items():
    print(f"  {'✅' if v else '❌'} {k}")
print("PASS" if all(checks.values()) else "PARTIAL")
PY
