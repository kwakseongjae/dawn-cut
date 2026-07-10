# B2 — 썸네일 필름스트립 + 오디오 파형

- **이슈**: 신규
- **의존**: B1 (완료 d140b17)

## 목표

Video 트랙 클립을 텍스트 블록에서 **필름스트립(썸네일 띠) + 파형** 블록으로 — CapCut/ChatCut 타임라인의 질감. 추출은 sidecar ffmpeg 1패스, userData 디스크 캐시(원본 mtime 무효화), 렌더는 %-좌표계 유지.

## 왜

B1 이후 남은 타임라인 체감 격차의 절반. "어디에 뭐가 있는지"를 눈으로 탐색하는 기본기(컷 위치 판단, 무음 구간 시각화 — 무음 제거 기능의 신뢰도 체감에도 직결).

## 완료 조건 (AC)

- [ ] sidecar: `extractThumbs`(≈1장/s, 상한 120장 — 롱폼 방어, fps 필터 1패스) + `extractPeaks`(8kHz mono s16le → 20피크/s, 0..1, 무오디오 시 [])
- [ ] main: `media:visuals` IPC — `userData/cache/visuals/<sha1(path:mtime:size)>/` 캐시, meta.json 재사용
- [ ] store: import/열기/복구 시 백그라운드 로드(실패는 조용히 — 시각 보조는 기능 대체가 아님), 미디어 치우면 해제
- [ ] Timeline: 클립 = 필름스트립(소스 시간 매핑, 부분 썸네일은 overflow 크롭) + 하단 SVG 파형(preserveAspectRatio=none → 줌과 무관하게 무재그리기 스케일) + 길이 라벨 오버레이
- [ ] 순수 매핑 모듈 `timeline-visuals.ts`(slices/peakSlice/wavePathD) 단위 테스트
- [ ] 통합: fixture로 썸네일 장수·간격, 피크 길이·범위(발화>0.1, 무음<0.05) 검증
- [ ] e2e: import 후 필름스트립 img·파형 path 렌더 + 캡쳐 아카이브
- [ ] 검증 체인 그린

## 설계 가이드

| 파일 | 역할/변경점 |
|------|-------------|
| `sidecar/ffmpeg/src/index.ts` | makePreviewProxy 아래 extractThumbs/extractPeaks. exec buffer 모드(maxBuffer 256MB=4.4h) |
| `apps/desktop/src/main/index.ts:41` 부근 | media:visuals 핸들러(캐시) |
| `apps/desktop/src/preload/index.ts:33` 부근 | mediaVisuals 브리지 |
| `packages/ui/src/types.ts` | MediaVisuals 인터페이스 + window.dawn 확장 |
| `packages/ui/src/store.ts:800(importPath)·415(restore)·recoverAutosave` | mediaVisuals state + 백그라운드 로드(프록시 로드와 같은 패턴: `get().mediaPath === path` 가드) |
| `packages/ui/src/timeline-visuals.ts` (신규) | 순수 매핑 3함수 + 테스트 |
| `packages/ui/src/index.tsx` Video 트랙 clips.map | 필름스트립+파형 렌더 |
| `packages/ui/src/styles.css .clip` | position:relative/overflow:hidden 재구성 |

**지켜야 할 불변**: 편집·내보내기는 원본 좌표 그대로(시각 전용 — 상태·EDL 불변). 조용한 폴백 금지 원칙은 '기능 대체'에 적용 — 시각 보조 실패는 부재로 처리(대체 아님). e2e testid 보존.

## 검증 방법

```bash
pnpm lint && pnpm test:unit && pnpm test:int && pnpm test:e2e
npx playwright test --config playwright.qa.config.ts
```

## 진행 저널 (append-only)

### 2026-07-10 — 착수
- 실사: probeMedia가 hasAudio 반환(sidecar:51) → 무오디오 스킵 판단에 재사용. importPath의 프록시 백그라운드 로드 패턴(store.ts:841-852, mediaPath 일치 가드)을 visuals에도 그대로 적용하기로.
- 파형은 canvas 대신 **SVG path + preserveAspectRatio:none** — 줌 시 재그리기 없이 CSS 스케일(B1의 %-좌표계 철학과 일치).
- 다음: timeline-visuals.ts 순수 모듈부터.

### 2026-07-10 — 구현 완료, 검증 체인 대기
- 구현 전부 완료: timeline-visuals.ts(순수 3함수, 단위 10) / sidecar extractThumbs·extractPeaks(통합 3) / media:visuals IPC(sha1(path:mtime:size) 캐시) / preload·types(MediaVisuals) / store(loadVisuals 액션 — importPath·openProject·recoverAutosave 3곳, restoreFromProject·clearMedia서 null 초기화) / Timeline 클립 = film+wave+clip-label / e2e timeline-visuals.spec.ts(분할 후 클립별 유지까지).
- ★스크래치 스크립트에서 playwright import는 `createRequire(ROOT/package.json)`로 — 스크래치 경로에선 모듈 해석 안 됨.
- 시각 확인 2종: fixture(파형·무음 구간 뚜렷, artifacts/b2-timeline-visuals.png) + **실제 1080p 영상**(필름스트립 질감 확인, output/b2-timeline/b2-real-media.png — 무음 소스라 파형 없음 = 정상).
- 검증 체인 백그라운드 — 그린이면 v0.1.12 커밋.