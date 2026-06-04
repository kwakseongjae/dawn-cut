#!/usr/bin/env bash
# setup-tts-neural.sh — 뉴럴 TTS(Piper) 옵션 설치. 무거우며 선택이다.
#
# 기본 dawn-cut TTS는 macOS `say`(오프라인·내장, 한국어 '유나' 자동전환)로 충분하다.
# 이 스크립트는 '뉴럴 음색(Piper)'을 원할 때만 실행한다 — 없어도 say로 graceful fallback.
#
#   1) Piper 바이너리 다운로드 → vendor/piper/piper
#   2) 영어 뉴럴 보이스(en_US) 다운로드 → vendor/piper/models/*.onnx(+.json)
#   3) 사용법: 아래 export를 셸/실행환경에 넣고 앱 실행 → TextPanel 배지가 '뉴럴(Piper)'로 바뀜
#
#   export DAWN_PIPER_BIN="$PWD/vendor/piper/piper"
#   export DAWN_PIPER_MODEL="$PWD/vendor/piper/models/en_US-lessac-medium.onnx"
#
# ⚠️ 한국어 뉴럴: 공식 rhasspy/piper-voices에는 한국어(ko) 보이스가 '없다'(2026 기준). 유일한
#   커뮤니티 ko 모델(neurlang/kss)은 (a) 표준 Piper가 아닌 Rust(pygoruut) 런타임을 요구하고
#   (b) 라이선스가 CC-BY-NC(비상업)라 기본 동봉/권장하지 않는다. 따라서 한국어는 당분간 `say`(유나)가
#   최선이며, 한국어 뉴럴은 별도 통합 트랙(piper-rs)으로 다룬다. 이 스크립트는 영어 뉴럴만 받는다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIPER_DIR="$ROOT/vendor/piper"
MODELS_DIR="$PIPER_DIR/models"
mkdir -p "$MODELS_DIR"

PIPER_VER="${DAWN_PIPER_VER:-2023.11.14-2}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="piper_macos_aarch64.tar.gz" ;;
  Darwin-x86_64) ASSET="piper_macos_x64.tar.gz" ;;
  Linux-x86_64) ASSET="piper_linux_x86_64.tar.gz" ;;
  Linux-aarch64) ASSET="piper_linux_aarch64.tar.gz" ;;
  *) echo "지원하지 않는 플랫폼: $(uname -s)-$(uname -m)"; exit 1 ;;
esac
PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/${ASSET}"

if [ ! -x "$PIPER_DIR/piper" ]; then
  echo "▸ Piper 바이너리 다운로드: $PIPER_URL"
  curl -fsSL "$PIPER_URL" -o "$PIPER_DIR/piper.tar.gz"
  tar -xzf "$PIPER_DIR/piper.tar.gz" -C "$PIPER_DIR" --strip-components=1
  rm -f "$PIPER_DIR/piper.tar.gz"
  chmod +x "$PIPER_DIR/piper" || true
else
  echo "✓ Piper 바이너리 존재 — 건너뜀"
fi

# 영어 뉴럴 보이스(테스트용, MIT/공개). 한국어는 위 주석 참고(say 유나 사용).
VOICE_BASE="${DAWN_PIPER_VOICE_BASE:-https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium}"
MODEL="$MODELS_DIR/en_US-lessac-medium.onnx"
if [ ! -f "$MODEL" ]; then
  echo "▸ 영어 뉴럴 보이스 다운로드(en_US-lessac-medium)"
  curl -fsSL "$VOICE_BASE/en_US-lessac-medium.onnx" -o "$MODEL"
  curl -fsSL "$VOICE_BASE/en_US-lessac-medium.onnx.json" -o "$MODEL.json"
else
  echo "✓ 보이스 모델 존재 — 건너뜀"
fi

cat <<EOF

✅ 뉴럴 TTS 준비 완료. 아래를 셸/실행환경에 넣고 앱을 실행하세요:

  export DAWN_PIPER_BIN="$PIPER_DIR/piper"
  export DAWN_PIPER_MODEL="$MODEL"
  DAWN_ADVANCED=1 pnpm --filter @dawn-cut/desktop start

  → 음성·TTS 패널 배지가 '뉴럴(Piper)'로 표시됩니다(영어). 한국어는 say(유나) 사용.
EOF
