# A1 — advanced 게이트 철거 → 인앱 모드 토글

- **이슈**: 신규
- **의존**: 없음

## 목표

`DAWN_ADVANCED=1` 환경변수로만 열리던 바이브 편집 표면(NL바·승인 카드·감사로그 등)을 일반 실행에서 기본 노출하고, UI 밀도는 인앱 '간단/프로' 토글로 조절한다.

## 왜

가장 좋은 자산(승인·감사 바이브 편집)이 환경변수 뒤에 숨어 일반 사용자에게 존재 자체가 안 보임. Palmier는 채팅 에이전트가 1급 시민. 비용 대비 효과 최고 항목.

## 완료 조건 (AC)

- [ ] 환경변수 없이 `pnpm --filter @dawn-cut/desktop start`만으로 NL바·plan-card·audit-viewer 노출
- [ ] 툴바(또는 설정)에 간단↔프로 토글 — 프로에서만: 감사로그·내 사전·챕터·자막 세부 스타일(밀도 높은 것들). NL바·승인 카드는 **양쪽 모두 노출**(제품 정체성)
- [ ] 토글 상태 localStorage 영속 + .dawn 저장과 무관(프로젝트 아닌 앱 설정)
- [ ] 기존 e2e(advanced 전제 테스트) 갱신, QA 하네스 그린
- [ ] 검증 체인 그린 + 실행 캡쳐 output/ 아카이브

## 설계 가이드

| 파일 | 역할/변경점 |
|------|-------------|
| `apps/desktop/src/preload/index.ts:22-23` | `advanced: process.env.DAWN_ADVANCED === '1'` — 제거 또는 기본 true로 (하위호환은 남겨도 됨) |
| `packages/ui/src/store.ts:480` | `window.dawn?.advanced ?? false` → `uiMode: 'simple'\|'pro'` 상태 + `setUiMode` 액션으로 대체 |
| `packages/ui/src/index.tsx` | 게이트 지점: 458(레일 필터), 2487(NL바), 2510(자동 하이라이트), 2614(감사로그), 2634(자막 미리보기), 2869(사전) — NL바·plan-card는 무조건, 나머지는 `uiMode==='pro'`로 재분류 |
| `tests/e2e`, `tests/qa` | DAWN_ADVANCED 전제 스펙 갱신(grep으로 전수 확인) |

**지켜야 할 불변**: 모드 토글은 표시만 바꾼다 — 상태 변경은 여전히 승인 카드(applyCommand) 경유. e2e testid·status 문자열 보존.

## 검증 방법

```bash
pnpm lint && pnpm test:unit && pnpm test:int
pnpm test:e2e                                          # desktop build 포함
npx playwright test --config playwright.qa.config.ts   # QA 하네스 8플로우
pkill -f dawn-cut; pnpm --filter @dawn-cut/desktop start   # 환경변수 없이! 캡쳐 검증
```

## 진행 저널 (append-only)

### 2026-07-10 — 구현 완료(체인 대기)
- 재분류 확정: **항상** = 레일 전 패널(text/sticker 포함)·NL바·plan-card·자동 하이라이트 / **프로 게이트** = 감사로그·자막 미리보기 카드(subtitle-pos)·내 사전·챕터. 툴바 간단↔프로 토글(ui-mode, localStorage 영속).
- store.advanced 완전 제거(uiMode로 대체), preload advanced는 deprecated 주석만(하위호환).
- 테스트 갱신: showcase-gate 재작성(신 시맨틱 — 환경변수 없이 검증), auto-highlight 숨김 단언→가시성, nl-command/QA 하네스 DAWN_ADVANCED 제거.
- ★플레이크 폭탄 선제 제거: uiMode localStorage가 e2e 실행 간 잔존(Electron userData) → 게이트 테스트는 토글 상태를 **읽고 결정적으로 맞춘 뒤** 단언. QA 하네스는 pro 전용 요소(subtitle-pos/glossary) 사용 → 런치 후 UI로 프로 전환.
- 체인 그린이면 v0.1.18 커밋. 메모리의 "앱 실행 시 DAWN_ADVANCED=1" 노트도 폐기 대상.
