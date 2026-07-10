# B4 — 전환: crossfade / dip-to-black (#8)

- **이슈**: #8
- **의존**: 없음

## 목표

클립 경계에 전환 2종(crossfade, dipToBlack)을 EditCommand 동사로 추가하고 익스포트에서 실렌더. **프로그램 길이 완전 불변**(±0) — "길이 정산형"의 구체 규약은 아래.

## 왜

CapCut 체감 3요소(전환·음악·브랜딩)의 첫 번째. 마케팅 영상 "완성품 느낌"의 필수 요소. 첫 엔진 신기능.

## 핵심 설계 결정 (모트 보존)

1. **길이 정산 = 핸들(source handle) 오버랩**: crossfade는 A 꼬리를 sourceEnd 너머로 D/2, B 머리를 sourceStart 앞으로 D/2 **렌더에서만 확장**해 겹친다(클립 모델·프로그램 좌표 불변). xfade 유효 길이 D_used = handleA+handleB — 소스 EOF/0에서 핸들이 부족하면 **결정적으로 줄어든다**(2프레임 미만이면 하드컷). 프로그램 길이 = Σ클립길이 그대로 → TL/EDL/SYNC 불변식 전부 유지.
2. **dipToBlack은 핸들 불필요**: A 꼬리 fade-out(D/2) + B 머리 fade-in(D/2) + 평범한 concat.
3. **오디오는 오버랩하지 않는다**: 양쪽 afade out/in(D/2)만. 이유 — 핸들 오디오는 '삭제된 내용'(무음/말버릇)을 부활시킬 수 있다. 영상 핸들은 시각적으로 무해, 오디오는 유해.
4. **모델**: `TimelineModel.transitions?: Transition[]` — `{id, afterClipId, kind, durationUs}`. 경계 주소 = 앞 클립 id. TL-INV-5(참조 유효·후속 존재·중복 금지·D≤min(lenA,lenB)). 구조 편집 시 `reconcileTransitions`: 깨진 참조 drop, 과대 D 클램프. splitAt은 X→X-b 재매핑(경계 보존).
5. **렌더 게이트**: `edl.transitions` 없으면 기존 필터그래프와 **바이트 동일**(회귀 0 보장). 있으면 video는 concat 대신 xfade/concat 폴드, audio는 세그먼트 afade.
6. **동사 2개(14→16)**: `addTransition{kind, durationUs, afterClipId?}` — afterClipId 생략 = 모든 내부 경계(플래너 친화). `removeTransition{afterClipId?}` — 생략 = 전부. PLANNER_VERBS에 추가.
7. **UI**: EffectPanel에 전환 select+길이+적용(버스 경유), Timeline 경계에 ⧓ 배지(읽기 전용). 프리뷰 재생은 미지원(C1 범위).

## 완료 조건 (AC)

- [ ] 동사 2종 + TL-INV-5 + reconcile/재매핑 단위 테스트
- [ ] 렌더: crossfade·dip 모두 **출력 길이 == 전환 없음 길이 ±1frame** (통합)
- [ ] dip 경계 프레임 near-black 픽셀 검증 (fixture가 남색 단색이라 crossfade 픽셀 검증은 불가 — 길이·성공만)
- [ ] 전환 없는 렌더 인자 바이트 동일(기존 테스트 무회귀가 증명)
- [ ] EffectPanel 적용 → 감사 +1 + 타임라인 배지 (e2e)
- [ ] .dawn 라운드트립(transitions 저장/복원)
- [ ] 검증 체인 그린

## 설계 가이드 (파일 맵)

| 파일 | 변경 |
|------|------|
| `packages/core/src/types.ts` | Transition/TransitionKind, TimelineModel.transitions?, Edl.transitions? |
| `packages/core/src/timeline.ts` | validateTimeline TL-INV-5, reconcileTransitions |
| `packages/core/src/commands.ts` | rebuildGapless가 reconcile해 승계, splitClipAt 재매핑 |
| `packages/core/src/edit-command.ts` | 스키마 2 + union + dispatcher(경계 전체 확장·교체 규칙) |
| `packages/core/src/edl.ts` | afterClipId→afterIndex 매핑, validateEdl 검사 |
| `packages/core/src/planner.ts` | PLANNER_VERBS + few-shot("부드럽게 이어줘") |
| `packages/core/src/project.ts` | v3 직렬화에 transitions 포함(라운드트립) |
| `sidecar/ffmpeg/src/index.ts` | 폴드 빌더(xfade offset 누적), afade, gif 경로, probe로 핸들 클램프 |
| `packages/ui/src/store.ts` | applyTransition 액션(removeFillers 패턴 — applyCommand+appendAudit+history) |
| `packages/ui/src/index.tsx` | EffectPanel 컨트롤 + Timeline 경계 배지 |

★주의: 명령 판별키는 `verb`가 아니라 **`type`**. rebuildGapless는 `schemaVersion: 1` 하드코딩된 새 모델을 만든다 — transitions 승계 안 하면 모든 리플 편집에서 소실.

## 검증 방법

```bash
pnpm lint && pnpm boundary && pnpm test:unit && pnpm test:int && pnpm test:e2e
npx playwright test --config playwright.qa.config.ts
```

## 진행 저널 (append-only)

### 2026-07-10 — 착수·설계 확정
- 실사: renderEdl 필터 조립(401-463), validateEdl(EDL-INV-1/2), rebuildGapless(신규 모델 생성 — 승계 필요), splitClipAt(`-a`/`-b` id), 플래너 few-shot 판별키 `type`, fixture=남색 단색(픽셀 검증은 dip만 가능).
- 위 '핵심 설계 결정' 1~7 확정. 다음: types→timeline→commands→edit-command→edl→planner→sidecar→store→UI→tests 순.

### 2026-07-10 — 구현·검증 완료(체인 대기)
- 전 레이어 구현 완료. 동사 16개(addTransition/removeTransition), GBNF 2벌(FULL 15·PLAN 9) 동기화, 렌더 폴드(xfade offset 누적)+afade, EffectPanel+배지.
- ★설계대로 실증: **crossfade 출력 길이 == 원본 길이 정확히 일치**(fixture 8s, 실미디어 15.63s/10.39s — 핸들 정산 정상). dip 경계 YAVG=16 = **limited-range 비디오의 순수 블랙**(테스트 단언은 Y16 바닥 기준으로 작성해야 함 — 0 아님!).
- ★크로스페이드는 소스상 인접한 분할 경계에선 시각적으로 안 보인다(같은 내용 블렌드) — 데모/검증은 **가운데를 잘라내** 다른 장면이 만나게 해야 함(output/b4-transitions/xf-boundary.png에서 유령상 확인).
- .dawn 라운드트립은 timeline 통짜 직렬화로 자동(+validateTimeline TL-INV-5 게이트).
- 단위 +11(transitions.test.ts), 통합 +2(transitions-render), e2e +1(패널 적용→배지→감사). 체인 그린이면 v0.1.13 커밋.