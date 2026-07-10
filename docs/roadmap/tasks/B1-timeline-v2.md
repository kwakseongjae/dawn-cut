# B1 — 타임라인 v2: 줌 · 시간 눈금 · 가로 스크롤

- **이슈**: 신규
- **의존**: 없음

## 목표

고정 배율(전체 맞춤)뿐인 타임라인에 줌(버튼/⌘휠)·시간 눈금(ruler)·가로 스크롤을 도입해 CapCut/ChatCut급 타임라인 탐색 체감을 만든다. B2(썸네일·파형)·B3(클립 트림)의 기반.

## 왜

CapCut 체감 격차 1순위(실사: 줌/눈금/스크롤 전무). ChatCut 스크린샷(사용자가 "정확히 원하던 UI")의 타임라인도 눈금+줌 슬라이더가 기본.

## 완료 조건 (AC)

- [ ] 시간 눈금 행(ruler): 줌 레벨에 따라 주눈금 간격 자동 선택(0.1s~10m 단계), 라벨 M:SS, 클릭=seek
- [ ] 줌: 버튼(+/−/맞춤) + ⌘/Ctrl+휠(커서 기준 앵커 유지), 범위 1×~16×
- [ ] 줌>1에서 4트랙+눈금이 한 몸으로 가로 스크롤, 트랙 라벨은 좌측 고정(sticky)
- [ ] 기존 상호작용 무회귀: 트랙 클릭 seek, 오버레이/보이스 드래그·트림이 모든 줌 레벨에서 정확(％ 좌표계 유지로 자동 보장 — 회귀는 e2e로)
- [ ] 순수 헬퍼 `timeline-scale.ts`(눈금 간격 선택·틱 생성) 단위 테스트
- [ ] e2e: 눈금 렌더·줌 인/아웃/맞춤·scrollWidth 증가 검증 + 스크린샷 아카이브
- [ ] 검증 체인 그린

## 설계 가이드

| 파일 | 역할/변경점 |
|------|-------------|
| `packages/ui/src/timeline-scale.ts` (신규) | `chooseTickStep(durationUs, trackPx)` + `rulerTicks()` + `fmtTick()` — 순수 함수 |
| `packages/ui/src/index.tsx:3168-3508` | Timeline: `zoom` 로컬 state, ResizeObserver로 트랙 px 측정, 트랙 width=px×zoom 명시, ruler 행 추가, tl-head에 줌 컨트롤, 네이티브 wheel 리스너({passive:false} — React onWheel은 preventDefault 불가) |
| `packages/ui/src/styles.css:756-, 1437-` | `.tracks` overflow-x:auto, `.trackrow` flex+width:max-content, `.lbl` sticky left(배경 필수), `.ruler`/`.tick` 스타일, 줌 컨트롤 |
| `tests/e2e/timeline-zoom.spec.ts` (신규) | 기존 스펙 셋업 패턴 재사용 |

**지켜야 할 불변**: 블록 좌표는 % 좌표계 유지(드래그 환산이 트랙 rect 기준이라 줌과 무관하게 정확). e2e testid·기존 상호작용 보존. 줌은 뷰 상태 — 프로젝트(.dawn)에 저장하지 않음.

## 검증 방법

```bash
pnpm lint && pnpm test:unit && pnpm test:int && pnpm test:e2e
npx playwright test --config playwright.qa.config.ts
```

## 진행 저널 (append-only)

### 2026-07-10 — 착수
- 실사 완료: Timeline(index.tsx:3168-3508)은 전부 %-좌표, 드래그 환산은 레인 rect 기준 → 트랙 px 폭만 zoom 배율로 키우면 좌표계 무손상. `.tracks`가 이미 세로 스크롤러(styles.css:1437) → 가로 스크롤 추가 + `.lbl` sticky 전환 결정.
- 유닛 글롭 `packages/**/*.test.ts` 확인 → timeline-scale.test.ts는 unit 스위트에 자동 포함.
- 다음: timeline-scale.ts 작성 → Timeline 컴포넌트 개조 → CSS → e2e.

### 2026-07-10 — 구현 완료, 검증 체인 대기
- `timeline-scale.ts`(간격 사다리 0.1s~10m, 주눈금 최소 72px, 보조 step/5는 8px 이상일 때) + 유닛 11개 그린.
- Timeline: zoom state(1~16×)+ResizeObserver 뷰포트 측정 → 트랙 인라인 `flex: 0 0 {px}px`. 줌 앵커 보정은 pendingScroll ref + useLayoutEffect(렌더마다, dep 없음 — biome exhaustiveDeps 회피). ⌘/Ctrl+휠은 **네이티브 리스너 {passive:false}**(React onWheel은 preventDefault 불가). ruler 행 + tl-head 줌 컨트롤(testid: tl-zoom-in/out/fit/val, tl-ruler).
- CSS: `.trackrow` grid→flex(width:max-content, min-width:100%), `.lbl` sticky left + box-shadow 8px로 gap 비침 방지, `.tracks` overflow-x:auto.
- e2e `timeline-zoom.spec.ts` 그린(눈금 라벨/225% 스크롤 폭/줌 상태 시킹/맞춤 복귀). ★함정 2개: 라벨은 서브초 간격에서 "0:00.0"(정규식으로 단언), 사다리 마지막 인덱싱은 noUncheckedIndexedAccess로 `?? 0` 필요.
- 캡쳐 시각 확인 완료(artifacts/b1-timeline-zoom.png → output/b1-timeline/). 전체 체인 백그라운드 실행 중 — 그린이면 v0.1.11 커밋.
