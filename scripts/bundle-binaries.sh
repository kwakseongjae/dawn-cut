#!/usr/bin/env bash
# 동봉 바이너리 준비(issue #19) — vendor/dist-bin/{ffmpeg,ffprobe,whisper-cli}.
# ffmpeg/ffprobe: scripts/build-ffmpeg-lgpl.sh 산출물(LGPL, 시스템 라이브러리만 링크).
# whisper-cli: BUILD_SHARED_LIBS=OFF 정적 재빌드(기본 빌드는 @rpath dylib 의존이라 동봉 불가).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/vendor/dist-bin"
WHISPER_DIR="$ROOT/vendor/whisper.cpp"
mkdir -p "$OUT"

# 1) ffmpeg/ffprobe — 없으면 빌드 스크립트 안내.
for b in ffmpeg ffprobe; do
  [ -x "$OUT/$b" ] || { echo "❌ $OUT/$b 없음 — 먼저: bash scripts/build-ffmpeg-lgpl.sh"; exit 2; }
done

# 2) whisper-cli 정적 빌드(별도 build-static 디렉토리 — 기존 dev 빌드 비파괴).
if [ ! -x "$OUT/whisper-cli" ]; then
  cmake -B "$WHISPER_DIR/build-static" -S "$WHISPER_DIR" \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF
  cmake --build "$WHISPER_DIR/build-static" -j --config Release --target whisper-cli
  cp "$WHISPER_DIR/build-static/bin/whisper-cli" "$OUT/whisper-cli"
  strip "$OUT/whisper-cli" || true
fi

# 3) 휴대성 검증 — 시스템 라이브러리 외 의존 금지.
EXTRA=$(otool -L "$OUT/ffmpeg" "$OUT/ffprobe" "$OUT/whisper-cli" | grep -v ":" | grep -v "/usr/lib\|/System/" || true)
if [ -n "$EXTRA" ]; then echo "❌ 비시스템 dylib 의존 — 동봉 불가:"; echo "$EXTRA"; exit 1; fi

ls -lh "$OUT"
echo "✅ 동봉 바이너리 준비 완료 → electron-builder extraResources(bin/)로 들어갑니다"
