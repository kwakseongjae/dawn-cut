#!/usr/bin/env bash
# 외부 실제 테스트 에셋을 output/sources/ 로 끌어오고, 챕터 데모용 한국어
# 멀티토픽 클립을 생성한다. (output/ 는 .gitignore — 사람 확인용)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
SRC="output/sources"
mkdir -p "$SRC"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

fetch() { # url path
  if [ -f "$2" ]; then echo "✓ 캐시: $2"; return; fi
  echo "↓ 다운로드: $1"
  curl -fsSL -m 60 -o "$2" "$1"
  echo "  → $2 ($(du -h "$2" | cut -f1))"
}

# 외부 실제 에셋
fetch "https://picsum.photos/seed/dawncut/960/540" "$SRC/photo.jpg"
fetch "https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif" "$SRC/earth.gif"
fetch "https://download.samplelib.com/mp4/sample-15s.mp4" "$SRC/clip.mp4"

# 챕터 데모용 한국어 멀티토픽 나레이션(토픽 사이 2s 무음 → 챕터 경계).
KO="$SRC/korean-talk.mp4"
if [ -f "$KO" ]; then
  echo "✓ 캐시: $KO"
else
  echo "🗣  한국어 멀티토픽 클립 생성(say Yuna)…"
  VOICE="${DAWN_KO_VOICE:-Yuna}"
  T1="안녕하세요. 오픈소스 영상 편집기 던컷 사용법을 소개합니다. 이 영상은 전부 이 컴퓨터 안에서만 처리됩니다. 인터넷으로 올라가지 않습니다. 그래서 사생활 걱정이 없습니다."
  T2="먼저 자동 자막 기능입니다. 영상을 끌어다 놓으면 한국어 자막이 자동으로 만들어집니다. 어절 단위로 줄바꿈도 깔끔하게 됩니다. 자막 위치와 색상도 자유롭게 바꿀 수 있어요."
  T3="다음은 무음 제거입니다. 말과 말 사이의 빈 구간을 자동으로 찾아서 한 번에 잘라 줍니다. 민감도는 슬라이더로 조절할 수 있습니다. 군더더기 없는 영상이 됩니다."
  T4="마지막으로 내보내기입니다. 자막을 입힌 영상으로 저장하거나, 끌 수 있는 자막 트랙을 따로 넣을 수도 있습니다. 워터마크도 구독료도 없습니다. 감사합니다."
  i=0
  for S in "$T1" "$T2" "$T3" "$T4"; do
    i=$((i+1))
    say -v "$VOICE" -o "$TMP/t$i.aiff" "$S"
    ffmpeg -y -loglevel error -i "$TMP/t$i.aiff" -ar 16000 -ac 1 "$TMP/t$i.wav"
  done
  ffmpeg -y -loglevel error -f lavfi -t 2 -i anullsrc=r=16000:cl=mono "$TMP/gap.wav"
  printf "file '%s'\n" "$TMP/t1.wav" "$TMP/gap.wav" "$TMP/t2.wav" "$TMP/gap.wav" \
    "$TMP/t3.wav" "$TMP/gap.wav" "$TMP/t4.wav" > "$TMP/list.txt"
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$TMP/list.txt" -ar 16000 -ac 1 "$TMP/voice.wav"
  ffmpeg -y -loglevel error -f lavfi -i "color=c=#0d1b3a:s=854x480:r=30" -i "$TMP/voice.wav" \
    -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac "$KO"
  echo "  → $KO"
fi

echo "── output/sources ──"
for f in "$SRC"/*; do
  printf "%-28s %s\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done
echo "korean-talk 길이: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$KO")s"
