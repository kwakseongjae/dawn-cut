#!/usr/bin/env bash
# grok CLI 이미지 생성 래퍼(사이클 7 실측, 2026-06-11) — 프로모 에이전트(#18)의 에셋 생성기.
# 사용: scripts/grok-image.sh "<프롬프트>" <출력.png>
# 전제: `grok login` 완료(grok.com 계정). 도구: image_gen/image_edit 보유 확인됨.
set -euo pipefail
PROMPT="$1"; OUT="$2"
mkdir -p "$(dirname "$OUT")"
cd "$(dirname "$OUT")"
grok --always-approve -p "image_gen 도구로 다음 이미지를 1장 생성해 ${OUT} 절대경로에 저장해줘: ${PROMPT}. 완료되면 저장된 파일의 절대경로만 한 줄로 출력해." >/dev/null
[ -s "$OUT" ] || { echo "❌ 생성 실패: $OUT"; exit 1; }
echo "$OUT"
