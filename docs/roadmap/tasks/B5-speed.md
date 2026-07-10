# B5 — 배속: setSpeed (#9)

- **이슈**: #9 (일정 배속 우선, 램프는 후속)
- **의존**: 없음 (B4 전환과 상호작용 있음 — 핸들 환산)

## 목표

클립 단위 일정 배속(0.5×~3×). **프로그램 길이 ≠ 소스 길이가 되는 첫 변경** — 프로그램/소스 이중 좌표계를 헬퍼로 분리하고 sync/EDL/렌더/프리뷰에 전파. SYNC-INV 유지가 관건.

## 핵심 설계 결정

1. **모델**: `Clip.speed?: number`(생략=1). `clipDuration`은 **소스 길이로 유지**(기존 의미), 신규 `clipProgramDuration(c) = round(srcLen / speed)` — 프로그램 측 사용처(clipTimelineEnd/rebuild cursor/EDL total/전환 maxD/SYNC-INV-3)만 교체. 사용처 전수: commands.ts:19, edl.ts:55, sync.ts:32·76, timeline.ts(24/74/78/109/135).
2. **sync 반올림 규약**: wordToProgram은 start=**ceil**(Δ/speed)·end=**floor**, programToWord는 src=**round**(Δ×speed) — 라운드트립(SYNC-INV-1)이 어떤 speed에서도 어절 구간 안에 떨어지게(경계 1µs 이탈 방지).
3. **EDL**: `EdlSegment.speed?` + programStart는 프로그램 길이로 누적, totalDuration=Σ프로그램 길이(EDL-INV-1 재정의).
4. **렌더**: v=`setpts=(PTS-STARTPTS)/speed`, a=`atempo=speed`(동봉 ffmpeg는 0.5–100 단일 인스턴스). atempo 이후 오디오는 프로그램 속도 → afade st는 프로그램 길이 기준. **B4 상호작용**: crossfade 소스 핸들 = round(D/2×speed), xfade duration/offset은 프로그램 초.
5. **줌+배속 동일 클립**: effectFilter는 setpts 뒤 체인이라 줌 on/t가 자동으로 프로그램-로컬 — 추가 작업 불필요(의미 변화 문서화만).
6. **동사 17개째**: `setSpeed{clipId?, speed: 0.5~3}` — clipId 생략=전 클립(플래너 안전). 적용=클립 speed 갱신+rebuildGapless 재적층(전환 reconcile 자동). speed=1이면 필드 제거.
7. **프리뷰**: preview.ts 매핑 speed-aware + `<video>.playbackRate = JKL셔틀 × 현재 클립 speed`.
8. **UI**: EffectPanel 배속 select+적용(버스), 클립 라벨에 `2×` 표기.

## 완료 조건 (AC)

- [ ] 단위: 프로그램 길이 산식, sync 라운드트립(0.5/1.5/2/3×), splitAt(배속 클립), EDL 적층, 전환 reconcile(프로그램 길이 기준)
- [ ] 통합: 2× 렌더 길이 == 원본/2 ±1frame, 0.5× == ×2, **배속+전환 동시** 길이 정확
- [ ] e2e: 패널 적용 → durationProgramUs 절반 + 감사 +1 + 라벨 2×
- [ ] 플래너: "2배속으로 해줘" 유효(few-shot+GBNF 2벌)
- [ ] 검증 체인 그린 + 실미디어 데모 아카이브

## 검증 방법

```bash
pnpm lint && pnpm boundary && pnpm test:unit && pnpm test:int && pnpm test:e2e
npx playwright test --config playwright.qa.config.ts
```

## 진행 저널 (append-only)

### 2026-07-10 — 착수·설계 확정
- 사용처 전수 조사 완료(위 §1) — 프로그램/소스 이원화가 timeline.ts 헬퍼에 잘 수렴해 있어 국소 변경 가능.
- sync 라운드트립의 반올림 함정(§2)을 선제 설계 — ceil/floor/round 비대칭이 핵심.
- 다음: types→timeline→sync→preview→commands→edl→edit-command→grammar/planner→renderEdl→store/UI→tests.

### 2026-07-10 — 구현·검증 완료(체인 대기)
- 전 레이어 완료. 동사 17개(setSpeed), 프로그램/소스 이원화가 설계대로 국소 수렴(clipProgramDuration/segmentProgramDuration 단일 산식).
- sync 반올림 규약(ceil/floor/round 비대칭)로 SYNC-INV-1 라운드트립이 0.5/0.75/1.5/2/3× 전부 그린 — 설계 선제가 적중.
- ★프레임 스냅 함정 재발: splitAt(4s)의 소스 분할점은 3,999,960µs — 배속 테스트 기대값은 실측 클립값에서 파생시킬 것(±1frame).
- ★UI 프로그램 좌표 전환 3곳: 클립 폭·라벨(2× 표기), 전환 배지 위치, 프리뷰 rAF 소스→프로그램/시킹(programToSource·programToSpeed 사용) + playbackRate = 셔틀×클립speed.
- 렌더 실증: 2×=7.81s/0.5×=31.21s(원본 15.63s — 정확), 부분 배속+crossfade 동시 길이 정산 그린(통합 3).
- 단위 +13(speed.test.ts), 통합 +3, e2e +1. 체인 그린이면 v0.1.14 커밋.