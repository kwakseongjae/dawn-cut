# CLAUDE.md

**먼저 [`AGENTS.md`](./AGENTS.md)를 읽어라** — 작업 프로토콜·불변 규약·로드맵 파이프라인·도구 함정의 정본. 이 파일은 Claude Code 전용 보강만 담는다.

## 세션 연속성 프로토콜

- **시작**: `bash scripts/context_restore.sh` 실행(또는 `docs/roadmap/STATUS.md` 체크포인트 읽기) → 막힘/대기 항목부터 처리.
- **체크포인트**: 작업 단위 완료·결정 확정마다 `STATUS.md` 체크포인트와 작업 패킷 저널을 **먼저 갱신하고 나서** 보고한다. 채팅에만 있는 맥락은 잃어버린 것으로 간주.
- **종료**: `docs/roadmap/JOURNAL.md` 맨 위에 항목 추가(한 일/열린 것/다음, 5줄 이내).
- **컨텍스트가 요약(compact)된 채 재개되면**: 첫 행동으로 `context_restore.sh`를 실행해 복원한다.

## Claude Code 전용

- `.claude/settings.json`의 **SessionStart 훅**(startup/resume/clear/compact)이 `context_restore.sh` 출력을 컨텍스트에 자동 주입한다 — 출력이 이미 보이면 다시 실행할 필요 없이 그걸로 복원하면 된다.
- **compact 시점 제어**: `/config`에서 Auto-compact를 끄면 시점을 완전히 통제할 수 있다(`/context`로 잔량 확인 → 작업 경계에서 `/compact 다음 작업: <ID>, docs/roadmap/ 경로들 유지`). 켜두는 경우에도 위 체크포인트 규칙이 방어선이므로 유실은 없다.
- compact 직전 "플러시"는 훅으로 보장할 수 없다(PreCompact 훅은 모델을 개입시키지 못함) — 그래서 **체크포인트 갱신이 상시 규칙**인 것.
