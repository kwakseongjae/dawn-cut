#!/usr/bin/env bash
# Fetch/generate dummy media for a real end-to-end demo:
#   demo/talk.mp4      — ~20s narrated video (macOS `say`), several sentences + silences
#   demo/photo1.jpg..  — real photos (picsum) for the image-overlay test; falls back to
#                        generated color cards if offline.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p demo
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
VOICE="${DAWN_DEMO_VOICE:-Samantha}"
FPS=30

SENTENCES=(
  "Welcome to dawn cut, the open source video editor."
  "You can edit your video simply by editing the text."
  "Delete a word, and the timeline updates instantly."
  "It removes silent gaps automatically."
  "Export to MP4, GIF, or subtitles in one click."
  "Everything runs locally on your machine."
)

echo "▶ synthesizing narration ($VOICE)…"
i=0; LIST="$TMP/list.txt"; : > "$LIST"
GAP="$TMP/gap.wav"
ffmpeg -y -loglevel error -f lavfi -t 0.8 -i anullsrc=r=16000:cl=mono "$GAP"
for s in "${SENTENCES[@]}"; do
  i=$((i+1))
  say -v "$VOICE" -o "$TMP/s$i.aiff" "$s"
  ffmpeg -y -loglevel error -i "$TMP/s$i.aiff" -ar 16000 -ac 1 "$TMP/s$i.wav"
  echo "file '$TMP/s$i.wav'" >> "$LIST"
  echo "file '$GAP'" >> "$LIST"   # silence between sentences (for auto-cut demo)
done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -ar 16000 -ac 1 "$TMP/voice.wav"

echo "▶ muxing demo video…"
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x10233f:s=1280x720:r=$FPS" \
  -i "$TMP/voice.wav" -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac demo/talk.mp4

echo "▶ fetching demo images…"
fetch_img() { # $1=seed $2=out
  if curl -fsSL --max-time 15 "https://picsum.photos/seed/$1/960/540.jpg" -o "$2" 2>/dev/null && [ -s "$2" ]; then
    echo "  downloaded $2 (picsum)"
  else
    ffmpeg -y -loglevel error -f lavfi -i "color=c=0x$3:s=960x540" -frames:v 1 "$2"
    echo "  generated  $2 (fallback color card)"
  fi
}
fetch_img dawncut1 demo/photo1.jpg 7c4dff
fetch_img dawncut2 demo/photo2.jpg 46d39a

echo "✅ demo assets ready:"
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 demo/talk.mp4 | xargs printf "  talk.mp4 duration=%ss\n"
ls -1 demo/*.jpg | sed 's/^/  /'
