# V15 — 프로젝트 저장/열기 (.dawn)

> 검증 대상: G10 (10.1 직렬화 코어, 10.2 IPC/UI, 10.3 e2e 복원)
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)
> 상태: ✅ 통과 (2026-05-27)

## 목적
재녹화·재전사 없이 편집 상태를 저장하고 다시 열 수 있게 한다(OpenScreen이 내세운 "Save and reopen projects"). `.dawn` = `{schemaVersion, mediaPath, transcript, timeline}` JSON.

## 산출물
- `packages/core/src/project.ts` — `makeProject`/`serializeProject`/`deserializeProject`/`validateProject`.
- `apps/desktop`: IPC `project:save`/`project:open`, preload `saveProject`/`openProject`, store actions, UI `Save .dawn`/`Open .dawn`.

## 불변식 / 규칙
- **라운드트립**: `deserialize(serialize(p))` 가 `p` 와 deep-equal(id 포함).
- **로드 검증**: `deserializeProject` 는 schemaVersion≠1 또는 모델 불변식(T-INV/TL-INV/SYNC-INV) 위반 시 **throw** — 손상 프로젝트 무음 로드 금지.

## 검증 절차 / 게이트
- 명령: `pnpm test:unit -t Project` · `pnpm test:e2e`
- PASS 조건:
  - 라운드트립 deep-equal(원본/편집본 둘 다).
  - 잘못된 schemaVersion → `/schemaVersion/` throw; 불변식 위반 → `/invalid project/` throw.
  - e2e: 편집(dur2)→save→재import(전체 dur>dur2)→open→`duration==dur2` 복원.

## 통과 기준 체크
- [x] 라운드트립 deep-equal (원본 + 컷 적용본).
- [x] 손상/스키마 위반 로드 거부(throw).
- [x] e2e 상태 복원(duration 일치).

## 증거 (Evidence)
- [x] `artifacts/g10-project.dawn` — e2e가 저장/재로딩한 실제 프로젝트 파일.

## 실패 시 (STOP)
- 라운드트립 불일치: 직렬화 누락 필드 점검. 로드 검증 throw 우회 금지(STOP-4).
