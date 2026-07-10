#!/usr/bin/env bash
# dawn-cut 컨텍스트 복원 — 새 세션/compact 직후 이 출력만으로 현재 위치를 복원한다.
# 정본: docs/roadmap/STATUS.md (체크포인트+원장) · 작업 맥락: docs/roadmap/tasks/<ID>-*.md
# Claude Code에선 SessionStart 훅이 자동 실행(.claude/settings.json). 다른 도구는 수동 실행.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

STATUS="docs/roadmap/STATUS.md"
JOURNAL="docs/roadmap/JOURNAL.md"

echo "════════ 체크포인트 (${STATUS}) ════════"
awk '/^## ⚡/{f=1} f && /^---/{exit} f{print}' "$STATUS" 2>/dev/null || echo "(없음 — ${STATUS} 확인)"

echo "════════ 원장: 진행중·막힘 ════════"
grep -E '\|\s*(doing|blocked)\s*\|' "$STATUS" 2>/dev/null || echo "(진행 중/막힘 작업 없음)"

# 진행 중 작업이 있으면 그 패킷의 저널 꼬리를 주입(이어서 작업할 미시 맥락).
ACTIVE=$(grep -m1 '진행중_작업:' "$STATUS" 2>/dev/null | sed 's/.*진행중_작업: *//; s/[[:space:]#].*//')
if [ -n "${ACTIVE:-}" ] && [ "$ACTIVE" != "없음" ]; then
  PACKET=$(ls docs/roadmap/tasks/"${ACTIVE}"-*.md 2>/dev/null | head -1)
  if [ -n "${PACKET:-}" ]; then
    echo "════════ 진행 중 패킷 저널 꼬리 (${PACKET}) ════════"
    awk '/^## 진행 저널/{f=1} f{print}' "$PACKET" | tail -25
  fi
fi

echo "════════ 세션 저널 최근 2개 (${JOURNAL}) ════════"
awk '/^## /{n++} n>2{exit} n>=1{print}' "$JOURNAL" 2>/dev/null || echo "(없음)"

echo "════════ GIT ════════"
git log --oneline -5 2>/dev/null || echo "(git 저장소 아님)"
DIRTY=$(git status --short 2>/dev/null | head -20)
[ -n "$DIRTY" ] && { echo "-- dirty --"; echo "$DIRTY"; }

echo "════════ 다음 행동 ════════"
NEXT=$(grep -m1 '다음_작업:' "$STATUS" 2>/dev/null | sed 's/.*다음_작업: *//; s/[[:space:]#].*//')
echo "다음 작업: ${NEXT:-?} → 패킷 docs/roadmap/tasks/${NEXT:-<ID>}-*.md 를 읽고 착수."
echo "프로토콜(착수/저널/완료 규칙): AGENTS.md · 계획 정본: docs/roadmap/ROADMAP.md"
