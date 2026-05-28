#!/usr/bin/env bash
# Generate a small bundled asset library — procedural animated GIFs/clips
# so the "Library" tab has REAL animated content out of the box, with no
# API keys and no network. Real APIs (Tenor/Pexels) layer on top via env keys.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="$ROOT/assets/library"
mkdir -p "$LIB"

# helper: render a 2-second animated GIF from a lavfi expression
gif() {
  local out="$1" expr="$2" fps="${3:-12}"
  ffmpeg -y -loglevel error -f lavfi -t 2 -i "$expr" \
    -vf "fps=${fps},scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
    -loop 0 "$LIB/$out"
  echo "  $out"
}

echo "▶ building bundled animated library at $LIB"
gif "test-pattern.gif"    "testsrc2=size=320x180:rate=12"
gif "mandelbrot.gif"      "mandelbrot=size=320x180:rate=12:bailout=10"
gif "game-of-life.gif"    "life=size=320x180:rate=12:mold=10:r=12:ratio=0.05:death_color=#202040:life_color=#7c4dff"
gif "color-pulse.gif"     "gradients=size=320x180:rate=12"
gif "rgb-test-bars.gif"   "rgbtestsrc=size=320x180:rate=12"
gif "yuv-test-bars.gif"   "yuvtestsrc=size=320x180:rate=12"
gif "smpte-bars.gif"      "smptebars=size=320x180:rate=12"
gif "haldclut.gif"        "color=c=0x00000000:s=320x180:r=12,format=rgba,geq=r='128+127*sin(2*PI*(X/W+T))':g='128+127*sin(2*PI*(Y/H+T*1.3))':b='128+127*sin(2*PI*((X+Y)/(W+H)+T*0.8))':a=255"

echo "✅ bundled library ready ($(ls -1 "$LIB" | wc -l | tr -d ' ') items)"
ls -1 "$LIB" | sed 's/^/  /'
