#!/usr/bin/env bash
# 이미 구운 키워드강조 자막 번인본(output/korean/subtitled.mp4)에서 앞 ~10s를
# 공유용 히어로 GIF로 추출한다 → output/hero/hero.gif
#   · 480px 폭, 12fps, 무한루프, palettegen→paletteuse 로 작고 선명하게.
#   · 멱등: 다시 돌리면 같은 결과로 덮어쓴다. output/ 는 .gitignore(사람 확인용).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SRC="output/korean/subtitled.mp4"
HERO_DIR="output/hero"
HERO="$HERO_DIR/hero.gif"
DUR="${DAWN_HERO_DUR:-10}"   # 추출할 앞부분 길이(초)
FPS=12
WIDTH=480

# 0) ffmpeg 확인.
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "✗ ffmpeg 가 없습니다. 먼저 'pnpm setup:binaries' 로 sidecar 를 준비하세요." >&2
  exit 1
fi

# 1) 입력(번인 자막본) 확인 — 없으면 친절히 안내.
if [ ! -f "$SRC" ]; then
  echo "✗ $SRC 가 없습니다." >&2
  echo "  먼저 자막 번인본을 만들어 주세요:  pnpm demo:run" >&2
  echo "  (output/korean/subtitled.mp4 가 생성되면 다시 이 스크립트를 실행)" >&2
  exit 1
fi

mkdir -p "$HERO_DIR"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PAL="$TMP/hero-pal.png"
VF="fps=$FPS,scale=$WIDTH:-2:flags=lanczos"

echo "🎬 히어로 GIF 생성: $SRC 앞 ${DUR}s → ${WIDTH}px·${FPS}fps·무한루프"

# 2) palettegen: 256색 최적 팔레트 추출(앞 DUR초만).
echo "  · 팔레트 추출(palettegen)…"
ffmpeg -y -loglevel error -t "$DUR" -i "$SRC" -vf "$VF,palettegen" "$PAL"

# 3) paletteuse: 팔레트로 GIF 생성(무한루프).
echo "  · GIF 합성(paletteuse, loop=무한)…"
ffmpeg -y -loglevel error -t "$DUR" -i "$SRC" -i "$PAL" \
  -lavfi "$VF[x];[x][1:v]paletteuse" -loop 0 "$HERO"

echo "✓ 완료: $HERO ($(du -h "$HERO" | cut -f1))"
