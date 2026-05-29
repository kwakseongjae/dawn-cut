#!/usr/bin/env bash
# Cycle-0 spike: measure how whisper.cpp (-ml 1, ggml-base) tokenizes KOREAN.
# Hypothesis: Korean BPE produces sub-eojeol fragments → space-joined cues break.
# Output: artifacts/stt-spike/{voice.wav, ml1.json, natural.json, meta.txt}
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="artifacts/stt-spike"
mkdir -p "$OUT"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

VOICE="${DAWN_KO_VOICE:-Yuna}"
BIN="vendor/whisper.cpp/build/bin/whisper-cli"
MODEL="vendor/whisper.cpp/models/ggml-base.bin"

# Info-style narration: filler (음/어/그러니까), proper nouns (던컷/오픈소스/유튜브),
# eojeol with particles (오늘은/자막을/자동으로/구간도).
S1="안녕하세요. 오늘은 오픈소스 영상 편집기 던컷을 소개합니다."
S2="음, 그러니까 이 프로그램은 자막을 자동으로 만들어 줍니다."
S3="어, 무음 구간도 자동으로 제거할 수 있어요."
S4="유튜브에 올리기 전에 한번 써 보세요."

i=0
for S in "$S1" "$S2" "$S3" "$S4"; do
  i=$((i+1))
  say -v "$VOICE" -o "$TMP/s$i.aiff" "$S"
  ffmpeg -y -loglevel error -i "$TMP/s$i.aiff" -ar 16000 -ac 1 "$TMP/s$i.wav"
done
printf "file '%s'\n" "$TMP/s1.wav" "$TMP/s2.wav" "$TMP/s3.wav" "$TMP/s4.wav" > "$TMP/list.txt"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$TMP/list.txt" -ar 16000 -ac 1 "$OUT/voice.wav"

echo "== reference transcript ==" | tee "$OUT/meta.txt"
printf '%s\n%s\n%s\n%s\n' "$S1" "$S2" "$S3" "$S4" | tee -a "$OUT/meta.txt"
echo "== audio duration ==" | tee -a "$OUT/meta.txt"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/voice.wav" | tee -a "$OUT/meta.txt"

echo "== whisper -ml 1 (CURRENT sidecar setting) =="
"$BIN" -m "$MODEL" -f "$OUT/voice.wav" -l ko -ml 1 -oj -ojf -of "$OUT/ml1" -np
echo "== whisper natural segments (no -ml) =="
"$BIN" -m "$MODEL" -f "$OUT/voice.wav" -l ko -oj -ojf -of "$OUT/natural" -np

echo "✅ spike artifacts in $OUT"
ls -la "$OUT"
