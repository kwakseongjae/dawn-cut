#!/usr/bin/env bash
# setup-llm.sh — P3 LLM 사이드카용 로컬 추론 스택 준비(무겁다, 옵션).
#
#   1) llama.cpp 클론 + 빌드(Apple Silicon = Metal 자동) → vendor/llama.cpp/build/bin/llama-cli
#   2) 소형 instruct GGUF 다운로드 → vendor/llama.cpp/models/<model>.gguf
#
# 둘 다 없어도 dawn-cut은 동작한다(룰 플래너로 graceful fallback). 이 스크립트는
# '자유형 자연어 → LLM 플랜'을 켜고 싶을 때만 실행한다. 멱등(이미 있으면 건너뜀).
#
# 모델: Qwen2.5-1.5B-Instruct Q4_K_M (~1.1GB, Apache-2.0). 한국어 의도 이해 + GBNF 제약에
#       충분하면서 가볍다. 더 정확히: Qwen2.5-3B로 DAWN_LLM_MODEL_URL/PATH 오버라이드.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LLAMA_DIR="$ROOT/vendor/llama.cpp"
MODELS_DIR="$LLAMA_DIR/models"
BIN="$LLAMA_DIR/build/bin/llama-cli"
SERVER_BIN="$LLAMA_DIR/build/bin/llama-server"

LLAMA_REPO="${DAWN_LLAMA_REPO:-https://github.com/ggml-org/llama.cpp}"
LLAMA_REF="${DAWN_LLAMA_REF:-b4589}"  # 핀: 재현 가능한 빌드. 필요시 오버라이드.
MODEL_URL="${DAWN_LLM_MODEL_URL:-https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf}"
MODEL_PATH="${DAWN_LLM_MODEL_PATH:-$MODELS_DIR/qwen2.5-1.5b-instruct-q4_k_m.gguf}"

log() { printf '\033[36m[setup-llm]\033[0m %s\n' "$*"; }

# ── 1) llama.cpp 빌드 (llama-cli = one-shot 폴백, llama-server = 상주 기본 경로) ──
if [ -x "$BIN" ] && [ -x "$SERVER_BIN" ]; then
  log "llama-cli + llama-server 이미 빌드됨 (건너뜀)"
else
  if [ ! -d "$LLAMA_DIR/.git" ]; then
    log "llama.cpp 클론 ($LLAMA_REF)…"
    rm -rf "$LLAMA_DIR"
    git clone "$LLAMA_REPO" "$LLAMA_DIR"
    git -C "$LLAMA_DIR" checkout "$LLAMA_REF" 2>/dev/null || \
      log "ref '$LLAMA_REF' 체크아웃 실패 — 기본 브랜치로 진행"
  fi
  log "cmake configure (Metal/Accelerate 자동)…"
  cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build" -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF
  log "build (llama-cli + llama-server)…"
  cmake --build "$LLAMA_DIR/build" --config Release -j "$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" \
    --target llama-cli --target llama-server
  [ -x "$BIN" ] || { echo "빌드 실패: $BIN 없음"; exit 1; }
  [ -x "$SERVER_BIN" ] || { echo "빌드 실패: $SERVER_BIN 없음"; exit 1; }
  log "빌드 완료: $BIN, $SERVER_BIN"
fi

# ── 2) 모델 다운로드 ──
mkdir -p "$MODELS_DIR"
if [ -f "$MODEL_PATH" ] && [ "$(stat -f%z "$MODEL_PATH" 2>/dev/null || echo 0)" -gt 100000000 ]; then
  log "모델 이미 있음: $MODEL_PATH ($(du -h "$MODEL_PATH" | cut -f1), 건너뜀)"
else
  log "모델 다운로드 → $MODEL_PATH (~1.1GB)…"
  curl -L --fail --retry 3 -o "$MODEL_PATH.part" "$MODEL_URL"
  mv "$MODEL_PATH.part" "$MODEL_PATH"
  log "다운로드 완료: $(du -h "$MODEL_PATH" | cut -f1)"
fi

log "준비 완료. dawn-cut이 상주 server(기본)로 자동 사용. 수동 검증:"
log "  $SERVER_BIN -m $MODEL_PATH -ngl 99 -c 4096 --port 8127 --no-webui  # 그 후 POST /completion"
log "  (one-shot 폴백: $BIN -m $MODEL_PATH -p '안녕' -n 16 -no-cnv)"
