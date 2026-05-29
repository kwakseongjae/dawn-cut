#!/usr/bin/env bash
# Build whisper.cpp + download model, and record tool versions (05-ENVIRONMENT §2-3).
# Requires: git, cmake, a C/C++ toolchain (Xcode CLT on macOS), ffmpeg.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p artifacts vendor

# --- preflight ---
command -v cmake >/dev/null 2>&1 || { echo "❌ cmake not found. Run: brew install cmake"; exit 2; }
command -v ffmpeg >/dev/null 2>&1 || { echo "❌ ffmpeg not found. Run: brew install ffmpeg"; exit 2; }

ffmpeg -version | head -1 | tee artifacts/env-ffmpeg.txt

WHISPER_DIR="vendor/whisper.cpp"
# large-v3-turbo: 한국어 어휘정확도가 검수자동화에 필요(base는 '무음→몸' 오인).
# Cycle-0 게이트 실측 결과 기본 채택(~1.6GB). 가벼운 셋업은 DAWN_WHISPER_MODEL=base.
MODEL="${DAWN_WHISPER_MODEL:-large-v3-turbo}"

# 1) clone (shallow) if missing
if [ ! -d "$WHISPER_DIR/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"
fi

# 2) build
cmake -B "$WHISPER_DIR/build" -S "$WHISPER_DIR" -DCMAKE_BUILD_TYPE=Release
cmake --build "$WHISPER_DIR/build" -j --config Release

# 3) model
bash "$WHISPER_DIR/models/download-ggml-model.sh" "$MODEL"

# 4) locate cli binary (name varies by version) and record version
BIN=""
for cand in "$WHISPER_DIR/build/bin/whisper-cli" "$WHISPER_DIR/build/bin/main"; do
  [ -x "$cand" ] && BIN="$cand" && break
done
[ -n "$BIN" ] || { echo "❌ whisper cli binary not found after build"; exit 1; }

echo "whisper binary: $BIN" | tee artifacts/env-whisper.txt
"$BIN" --help 2>&1 | head -5 | tee -a artifacts/env-whisper.txt || true
echo "model: ggml-$MODEL.bin" | tee -a artifacts/env-whisper.txt

echo "✅ binaries ready. cli=$BIN model=ggml-$MODEL.bin"
