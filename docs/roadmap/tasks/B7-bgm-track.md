# B7 — BGM 트랙 (+B6 오디오 덕킹 포함)

- **이슈**: 신규 (B6 덕킹을 같은 사이클에 묶음 — 렌더 그래프를 한 번에 설계하는 게 싸다)
- **의존**: D6(완료 — 소재)

## 목표

D6 음악을 실제 편집에: BGM 1트랙(파일·시간창·볼륨·루프) 배치 → 익스포트에서 3계층 오디오 믹스(원본+보이스+BGM), **덕킹 = 말소리(원본+보이스)가 나오면 BGM이 자동으로 숙는다**(sidechaincompress). GUI: BGM 패널(카탈로그·미리듣기) + Music 레인 + 저장/복구 라운드트립.

## 핵심 설계 결정

1. **모델(v1) = 단일 BGM 클립** `{src, title, startUs, endUs, volume, loop, duck}` — ttsClips와 같은 store 상태. **버스 미경유(문서화된 편차)**: 오버레이/TTS와 동일한 기존 관례로, A4(동사 확장)에서 addBgm으로 함께 승격한다.
2. **렌더 그래프**: 기존 체인([a]→voice amix→audioLabel)을 건드리지 않고 **그 뒤에** BGM 스테이지 추가 — bgm 없으면 인자 바이트 동일.
   - 입력: `-stream_loop -1(loop시) -t <span> -i bgm.m4a`
   - 가공: `volume=V, afade(in 0.5/out 1.0), adelay=startMs`
   - 덕킹(B6): `audioLabel asplit → [amain][asc]; [bgmv][asc]sidechaincompress(threshold .02, ratio 8, attack 25ms, release 500ms)[bgmd]; [amain][bgmd]amix=normalize=0[afinal]` — **normalize=0**(신규 스테이지만; 기존 voice amix는 그대로 = 무회귀)
   - duck=false면 sidechain 없이 amix만.
3. **IPC**: `assets:bgmCatalog` — motionStickers 패턴(dev=레포 assets/bgm, 패키지=resourcesPath/bgm). catalog.json + 절대경로.
4. **저장**: ProjectExtras.bgm(선택 필드 — v3 하위호환). collectAssetPaths/remapAssetPaths에 bgm.src 포함(아카이브 이동성).
5. **프리뷰**: 별도 `<audio>` 엘리먼트 — playing && 플레이헤드가 창 안이면 재생(loop·volume 반영), 시킹 동기. 덕킹은 프리뷰 미지원(내보내기 정확 — 기존 색보정과 같은 정직 안내).
6. **UI**: 좌레일 5번째 'BGM' 패널(카탈로그 리스트+미리듣기+볼륨+덕킹 토글+추가/제거) + Timeline 'Music' 레인(블록 드래그 이동/양끝 트림 — voice 레인 패턴 복제).

## 완료 조건 (AC)

- [ ] 통합: ①무음 영상+BGM → 출력 오디오 에너지 존재 ②덕킹 on/off 비교 — 발화 구간에서 on의 BGM 레벨이 유의미하게 낮음 ③길이 불변
- [ ] e2e: 패널에서 추가 → Music 레인 블록 → 볼륨/제거
- [ ] 단위: 프로젝트 bgm 라운드트립
- [ ] 저장/자동저장/에셋 아카이브에 bgm 포함
- [ ] 검증 체인 그린 + 실미디어 데모(보이스+BGM 덕킹)

## 검증 방법

```bash
pnpm lint && pnpm test:unit && pnpm test:int && pnpm test:e2e
npx playwright test --config playwright.qa.config.ts
```

## 진행 저널 (append-only)

### 2026-07-10 — 착수·설계 확정
- ProjectExtras가 확장 지점(project.ts:66) — bgm 선택 필드로 하위호환. motionStickers IPC 패턴(main:378) 재사용.
- 렌더는 기존 체인 뒤 스테이지 추가 방식(바이트 동일 게이트 유지). sidechaincompress+amix normalize=0.
- 다음: sidecar 렌더 → IPC → store/타입 → 패널/레인 → 저장 → tests.

### 2026-07-10 — 구현·검증 완료(체인 대기)
- 렌더+덕킹 실증: **발화 구간 BGM 76%로 감쇠**(duck on/off 피크 비교, 통합 로그). 기존 체인 뒤 스테이지 방식이라 bgm 미지정 시 인자 바이트 동일.
- 전 레이어: assets:bgmCatalog IPC(motionStickers 패턴) / store(bgm 상태+setBgm/updateBgm, 직렬화·복원·아카이브·autosave 관심필드) / BgmPanel(카탈로그+미리듣기+볼륨+덕킹 토글, showcase 노출) / Music 레인(드래그 이동·트림) / Preview `<audio>` 근사 동기(덕킹 제외 정직 안내).
- ★autosaveLast 타입 리터럴에 필드 추가 잊지 말 것(TS7053) — 관심 필드 늘릴 때마다.
- ★버스 미경유 편차 기록: bgm은 오버레이/TTS와 같은 store 상태 — A4에서 addBgm 동사로 승격.
- 단위 +2(라운드트립), 통합 +2(에너지·덕킹), e2e +1(패널→레인→토글→제거). 실미디어 데모 output/b7-bgm/. 체인 그린이면 v0.1.16 커밋.