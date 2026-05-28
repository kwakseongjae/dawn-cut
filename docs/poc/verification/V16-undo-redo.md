# V16 — Undo/Redo 히스토리

> 검증 대상: G11 (11.1 history 코어, 11.2 store/UI, 11.3 e2e)
> 관련: [02-CHECKLIST](../02-CHECKLIST.md)
> 상태: ✅ 통과 (2026-05-27)

## 목적
편집(단어 삭제, 무음 제거)을 되돌리고 다시 적용할 수 있게 한다. 순수 history 리듀서를 core에 두어 로직을 단위 테스트하고, 스토어가 TimelineModel 스냅샷에 적용한다.

## 산출물
- `packages/core/src/history.ts` — `History<T>`, `initHistory`/`pushHistory`/`undoHistory`/`redoHistory`/`canUndo`/`canRedo` (순수·불변).
- `packages/ui` store: `past`/`future` + `undo`/`redo` 액션(편집 시 push, import/open 시 리셋), UI `Undo`/`Redo` 버튼(canUndo/canRedo로 비활성).

## 규칙
- push 는 redo 스택을 비운다. 경계에서 undo/redo 는 no-op.
- import/openProject 는 히스토리를 초기화(편집 이력은 세션/프로젝트 단위).

## 검증 절차 / 게이트
- 명령: `pnpm test:unit -t history` · `pnpm test:e2e`
- PASS 조건:
  - 단위: push→undo 가 이전 present 복원, redo 재적용, push 가 redo 클리어, 경계 no-op, 다단계 시퀀스.
  - e2e: 단어 삭제(dur1<dur0) 후 **undo → duration==dur0**, **redo → duration==dur1**.

## 통과 기준 체크
- [x] history 순수 리듀서 단위테스트 green.
- [x] e2e undo/redo duration 왕복 검증.
- [x] import/open 시 히스토리 리셋.

## 증거 (Evidence)
- [x] unit `history.test.ts` green (5 cases).
- [x] e2e `vertical-slice.spec.ts` undo/redo 단계 green.

## 실패 시 (STOP)
- undo 후 duration 불일치: push 타이밍(편집 전 timeline 저장) 점검. 게이트 약화 금지(STOP-4).
