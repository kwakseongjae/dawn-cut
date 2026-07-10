# D7 — 브랜드 킷 (로고 워터마크 · 아웃트로 카드 · 브랜드 색)

- **이슈**: 신규 (마케팅 3요소의 마지막 — 업계 기본 장착 항목)
- **의존**: 없음

## 목표

브랜드 자산(로고/이름/태그라인/강조색)을 한 번 등록하면 ① 코너 로고 워터마크 ② 마지막 2초 아웃트로 카드 ③ 자막 강조색이 원클릭으로 영상에 적용된다.

## 핵심 설계 결정

1. **기존 기계를 재사용해 신규 렌더 코드 0**: 워터마크·아웃트로 = **이미지 오버레이**(프리뷰=익스포트 패리티·저장·아카이브 공짜). 브랜드 색 = **setSubtitleStyle 버스 동사**(감사 체인 경유).
2. **BrandKit은 앱 설정**(프로젝트 아님) — glossary와 같은 localStorage 영속. `{name, tagline, logoPath, accentColor, watermarkCorner, watermarkOpacity}`.
3. **아웃트로 카드** = renderer canvas 래스터(dim 배경+로고+이름/태그라인/강조 라인) → asset:writeImage → 마지막 2s 풀스크린 오버레이(z=90 — 자막 100 아래). 프로그램 길이 불변(덮는 방식 — 타임라인은 소스 기반이라 '덧붙이기'는 불가).
4. 재적용 = 교체: 워터마크/아웃트로 오버레이는 name 'brand-wm'/'brand-outro'로 식별해 기존 제거 후 추가.
5. UI는 EffectPanel 하단 '브랜드 킷' 섹션(레일 과밀 회피). e2e 자동화 표면: `__editor.setBrandKit`.

## 완료 조건 (AC)

- [ ] 브랜드 설정 localStorage 영속(앱 재시작 유지)
- [ ] 워터마크: 코너 4택·투명도, 전체 구간, 재적용=교체
- [ ] 아웃트로: 마지막 2s 카드(로고+이름+태그라인+강조 라인)
- [ ] 브랜드 색 → 자막 emphasisColor(버스+감사 +1)
- [ ] e2e: 설정→워터마크→아웃트로→색 적용 검증
- [ ] 검증 체인 그린 + 실미디어 데모(워터마크+아웃트로 렌더 캡쳐)

## 검증 방법

```bash
pnpm lint && pnpm test:unit && pnpm test:int && pnpm test:e2e
npx playwright test --config playwright.qa.config.ts
```

## 진행 저널 (append-only)

### 2026-07-10 — 착수·설계 확정
- 재사용 지도: rasterizeWith+writeAsset(index.tsx:966~) / addOverlayWith(store:760) / glossary localStorage 패턴(store:280~) / __editor(index.tsx:4279).
- 다음: store(brandKit+3액션) → EffectPanel 섹션 → __editor 훅 → e2e → 데모.

### 2026-07-10 — 구현·검증 완료(체인 대기)
- 설계대로 신규 렌더 코드 0: 워터마크/아웃트로=오버레이(name으로 교체 식별), 브랜드 색=setSubtitleStyle 버스(감사 +1 e2e 검증). brandKit localStorage 영속.
- rasterizeOutroCard(async — 로고 Image 로드) renderer 전용, 데모는 napi-rs 캔버스로 동일 로직 재현.
- e2e +1(설정→워터마크 교체 규칙→아웃트로→색). 실미디어 콤보 데모(워터마크+아웃트로+BGM) output/d7-brand/branded.mp4 — 아웃트로 프레임 시각 확인 완료.
- ★__editor 자동화 표면 확장 시 types.ts 전역 선언도 함께(TS2353).
- 체인 그린이면 v0.1.17 커밋. 이로써 마케팅 3요소(전환·음악·브랜딩) 완성.