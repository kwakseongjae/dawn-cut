# A2 — NL 바 → '어시스턴트' 채팅 패널 승격

- **이슈**: #14 (드라이런 diff 승인 UI 쇼케이스 완성의 확장)
- **의존**: A1

## 목표

한 줄짜리 NL 바를 좌측 레일 5번째 패널 '어시스턴트'(채팅형)로 승격 — 대화 맥락 유지, 제안→diff 카드→승인이 대화 흐름 안에 배치, 적용된 편집은 대화에 기록으로 남는다.

## 왜

Palmier의 앱 내 채팅 에이전트가 이 카테고리의 표준 UX가 됨. 우리의 차별점(승인 카드·부분 적용·감사)이 대화 흐름 안에 있어야 "신뢰할 수 있는 바이브 편집"이 체감됨.

## 완료 조건 (AC)

- [ ] 레일에 '어시스턴트' 패널(Bot 아이콘) — 기존 nl-bar 기능 포함(제거는 A2 완료 후)
- [ ] 대화 리스트: 사용자 요청 / 플래너 제안(plan-card 인라인, 명령별 토글 유지) / 적용 결과(감사 해시 표기) / 실패·거부 사유
- [ ] 멀티턴: 직전 제안·적용 내역을 플래너 프롬프트 컨텍스트로 전달(최근 N턴 요약)
- [ ] 적용 시 타임라인/대본에서 변경 클립·어절 하이라이트(1.5s 플래시 등)
- [ ] 대화는 세션 메모리(프로젝트 저장에 미포함 — 감사로그가 영구 기록)
- [ ] e2e: 채팅으로 "말버릇 빼줘" → 카드 승인 → 상태 변화 검증
- [ ] 검증 체인 그린 + 캡쳐 아카이브

## 설계 가이드

| 파일 | 역할/변경점 |
|------|-------------|
| `packages/ui/src/index.tsx:448-453` | RAIL에 `assistant` 추가(5번째) |
| `packages/ui/src/index.tsx:2487-2612` | 기존 nl-bar + plan-card 로직을 AssistantPanel로 이전·재배치(diff 카드 컴포넌트는 재사용) |
| `packages/ui/src/store.ts:1280-1379` | `planAndPreview/approvePlan/rejectPlan` 재사용 + `chatHistory` 상태 신설, planAndPreview에 대화 컨텍스트 파라미터 추가 |
| `packages/core/src/planner.ts:77` | buildPlanPrompt에 최근 대화 요약 섹션(optional) — 매니페스트 어휘 제약은 그대로 |

**지켜야 할 불변**: approvePlan이 유일한 상태 변경 지점(대화 UI가 우회 금지). 플래너 어휘는 plannerManifest만.

## 검증 방법

```bash
pnpm lint && pnpm test:unit && pnpm test:int && pnpm test:e2e
npx playwright test --config playwright.qa.config.ts
```

## 진행 저널 (append-only)
