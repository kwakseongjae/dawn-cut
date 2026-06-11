#!/usr/bin/env bash
# LGPL ffmpeg/ffprobe 빌드 — 패키징 동봉용 (issue #19).
#
# 왜 직접 빌드하나: brew ffmpeg는 --enable-gpl(libx264 등)이라 동봉 시 NOTICE(LGPL) 위반
# (DIRECTION-REVIEW 기결정). GPL 외부 라이브러리 없이 빌드하면 LGPL 본체 + macOS
# VideoToolbox(h264_videotoolbox 인코더)로 모든 제품 경로(프록시/렌더/오디오)가 충족된다.
# 외부 dylib 의존 0 → .app Resources/bin에 그대로 동봉 가능.
#
# 산출물: vendor/dist-bin/{ffmpeg,ffprobe} (+ 버전/라이선스 기록)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/vendor/ffmpeg-src"
OUT="$ROOT/vendor/dist-bin"
VER="${FFMPEG_VERSION:-7.1}"

mkdir -p "$OUT"
if [ ! -d "$SRC" ]; then
  git clone --depth 1 --branch "n$VER" https://git.ffmpeg.org/ffmpeg.git "$SRC"
fi
cd "$SRC"

# LGPL 핵심: --disable-gpl(기본이지만 명시) + 외부 GPL 라이브러리 일절 미링크.
# videotoolbox = macOS 하드웨어 H.264/HEVC 인코딩(libx264 대체). 나머지는 LGPL 내장 코덱.
./configure \
  --prefix="$SRC/_install" \
  --disable-gpl --disable-nonfree \
  --disable-doc --disable-debug \
  --disable-ffplay \
  --disable-sdl2 --disable-outdevs \
  --enable-videotoolbox \
  --disable-shared --enable-static || { tail -30 ffbuild/config.log; exit 1; }

make -j"$(sysctl -n hw.ncpu)"
cp ffmpeg ffprobe "$OUT/"
strip "$OUT/ffmpeg" "$OUT/ffprobe" || true

"$OUT/ffmpeg" -version | head -2 | tee "$OUT/ffmpeg-version.txt"
# 동봉 정합성 검증: GPL 표시가 없어야 한다.
if "$OUT/ffmpeg" -version | head -1 | grep -qi "enable-gpl"; then
  echo "❌ GPL 빌드가 섞임 — 동봉 금지"; exit 1
fi
# 시스템 프레임워크 외 외부 dylib 의존이 없어야 휴대 가능.
echo "--- otool 의존성:"
EXTRA=$(otool -L "$OUT/ffmpeg" "$OUT/ffprobe" | grep -v ":" | grep -v "/usr/lib\|/System/" || true)
if [ -n "$EXTRA" ]; then echo "❌ 비시스템 dylib 의존 — 동봉 불가:"; echo "$EXTRA"; exit 1; fi
echo "(시스템 라이브러리만 — OK)"
echo "✅ LGPL ffmpeg/ffprobe → $OUT"
