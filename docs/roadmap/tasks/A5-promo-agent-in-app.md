# A5 — promo-agent 앱 내 통합 (자연어 프로모 양산을 GUI로)

- **이슈**: #18 (마무리 단계)
- **의존**: A4 (addOverlay/addVoiceover/addBroll 동사)

## 목표

터미널 전용인 promo-agent(자연어 + 멀티 에셋 → 쇼츠)를 앱 안으로: 에셋 여러 개 드롭 → "OO 홍보 영상 만들어줘" → 템플릿 연출 제안 카드 → 승인 → 타임라인에 EditCommand로 반영(그 뒤 수동 미세조정 가능).

## 왜

사용자 핵심 요구("상품 이미지 2개, 영상 2개 주고 자연어로 알아서") + 사이클 8~10 모션 시스템·템플릿·양산 실증의 최종 배달 지점. CLI 실증은 끝났고 GUI 배달만 남음.

## 완료 조건 (AC)

- [ ] 미디어 패널(또는 어시스턴트)에 '프로모 만들기' 진입점: 에셋 인박스(이미지·영상 다중 드롭) + 자연어 입력
- [ ] LLM 연출 선택(템플릿/무드/카피/보이스/톤 — validateDirection 재사용) → **연출 요약 카드**(선택 근거 + 카피 미리보기) 승인 UI
- [ ] 승인 시: `scripts/lib-promo-templates.ts` 로직을 core/사이드카로 승격 → 오버레이 플랜+TTS+자막이 **EditCommand 시퀀스로 적용**(감사로그에 남음) — 렌더 결과 직접 파일이 아니라 편집 가능한 프로젝트 상태
- [ ] 무음/유음 영상 에셋 혼합 처리(기존 inputHasAudio 경로)
- [ ] 결과 내보내기까지 원플로우 캡쳐 + output/ 아카이브
- [ ] 검증 체인 그린

## 설계 가이드

| 파일 | 역할/변경점 |
|------|-------------|
| `scripts/lib-promo-templates.ts` | → `packages/core/src/promo-templates.ts`로 승격(순수 함수 — boundary 통과 확인). scripts는 얇은 re-export로 유지 |
| `scripts/promo-agent.ts` | 연출 선택·검증 로직을 main IPC(`promo:direct`)로 이식 — 키는 main의 settings.json 사용(기존 규약) |
| `packages/ui/src/store.ts` | promoInbox 상태 + 연출 카드 → A4 동사 시퀀스 dispatch |
| `apps/desktop/src/main/index.ts` | TTS 합성·에셋 카드화(makeImageCard) IPC — 렌더러에서 노드 API 금지 |

**지켜야 할 불변**: LLM은 연출만(카탈로그 검증), 픽셀은 결정적 템플릿. 승인 전 상태 불변. 카피 2줄 미만 등 불량 응답은 명시적 에러(조용한 대체 금지).

## 검증 방법

```bash
pnpm lint && pnpm boundary && pnpm test:unit && pnpm test:int && pnpm test:e2e
npx playwright test --config playwright.qa.config.ts
# 실미디어: output/sources의 상품컷+영상으로 원플로우 실행 → output/promo-app/ 아카이브
```

## 진행 저널 (append-only)
