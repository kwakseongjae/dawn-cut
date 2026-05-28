#!/usr/bin/env bash
# Deterministic test fixture (05-ENVIRONMENT §4).
# macOS `say` produces reproducible narration with a KNOWN transcript, plus
# two inserted silence gaps at known boundaries (for G5). Output:
#   fixtures/sample.mp4              — ~10s, 640x360, 30fps, narration + 2 silences
#   fixtures/expected-transcript.json — keywords + silence boundaries (µs) + fps
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p fixtures
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

VOICE="${DAWN_FIXTURE_VOICE:-Samantha}"
FPS=30
GAP=1.0  # seconds of silence between sentences

S1="The quick brown fox jumps over the lazy dog."
S2="Dawn cut makes editing simple."
S3="We remove silence automatically."

# 1) Synthesize each sentence → 16kHz mono wav (deterministic on a given voice).
i=0
for S in "$S1" "$S2" "$S3"; do
  i=$((i + 1))
  say -v "$VOICE" -o "$TMP/s$i.aiff" "$S"
  ffmpeg -y -loglevel error -i "$TMP/s$i.aiff" -ar 16000 -ac 1 "$TMP/s$i.wav"
done

# 2) 1s silence (16kHz mono).
ffmpeg -y -loglevel error -f lavfi -t "$GAP" -i anullsrc=r=16000:cl=mono "$TMP/gap.wav"

# 3) Concatenate: s1 + gap + s2 + gap + s3
printf "file '%s'\n" "$TMP/s1.wav" "$TMP/gap.wav" "$TMP/s2.wav" "$TMP/gap.wav" "$TMP/s3.wav" > "$TMP/list.txt"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$TMP/list.txt" -ar 16000 -ac 1 fixtures/voice.wav

# 4) Color-background video muxed with the narration → sample.mp4
ffmpeg -y -loglevel error -f lavfi -i "color=c=navy:s=640x360:r=$FPS" -i fixtures/voice.wav \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac fixtures/sample.mp4

# 5) Compute silence boundaries (µs) from real part durations and emit expected JSON.
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
D1=$(dur "$TMP/s1.wav"); D2=$(dur "$TMP/s2.wav"); D3=$(dur "$TMP/s3.wav")

python3 - "$D1" "$D2" "$D3" "$GAP" "$FPS" <<'PY'
import json, sys
d1, d2, d3, gap, fps = (float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]),
                        float(sys.argv[4]), int(sys.argv[5]))
us = lambda s: round(s * 1_000_000)
sil1 = {"startUs": us(d1),                 "endUs": us(d1 + gap)}
sil2 = {"startUs": us(d1 + gap + d2),      "endUs": us(d1 + gap + d2 + gap)}
keywords = ["quick","brown","fox","jumps","lazy","dog",
            "dawn","cut","editing","simple","remove","silence","automatically"]
out = {"fps": fps, "keywords": keywords, "silences": [sil1, sil2],
       "totalAudioUs": us(d1 + gap + d2 + gap + d3)}
with open("fixtures/expected-transcript.json", "w") as f:
    json.dump(out, f, indent=2)
print("expected-transcript.json:", json.dumps(out))
PY

echo "✅ fixture ready:"
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,sample_rate,channels \
  -of default=noprint_wrappers=1 fixtures/sample.mp4
