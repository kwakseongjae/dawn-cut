# 세션 저널 (append-only — 최신이 위)

> 형식: `## YYYY-MM-DD — <세션 한 줄>` + 본문 5줄 이내(한 일 / 열린 것 / 다음). **기존 항목 수정 금지.**
> 작업 단위의 미시 기록은 여기가 아니라 각 작업 패킷(`tasks/<ID>-*.md`)의 진행 저널에.

## 2026-07-10 — A1 게이트 철거 완료 (v0.1.18) — 바이브 편집이 기본 노출
- 한 일: DAWN_ADVANCED 폐기 → 인앱 간단↔프로 토글(uiMode, localStorage). 항상=전 패널 레일·NL바·plan-card·자동 하이라이트 / 프로=감사로그·자막 세부·사전·챕터. showcase-gate 스펙 재작성, QA 하네스 pro 전환.
- 열린 것: e2e localStorage 잔존 플레이크는 결정적 토글로 선제 방어(패킷 저널 참조).
- 다음: A2 (어시스턴트 채팅 패널 — 패킷 기작성)

## 2026-07-10 — D7 브랜드 킷 완료 (v0.1.17) — 마케팅 3요소(전환·음악·브랜딩) 완성
- 한 일: brandKit(localStorage 앱 설정) + 워터마크/아웃트로=오버레이 재사용(신규 렌더 코드 0) + 브랜드 색=setSubtitleStyle 버스(감사). EffectPanel 브랜드 섹션. 콤보 데모(워터마크+아웃트로+BGM) output/d7-brand/.
- 열린 것: e2e 플레이크 1회(데모 렌더와 동시 실행 CPU 경합 — 격리 재실행 그린). 로고는 사용자가 실제 브랜드 파일로 교체 가능.
- 다음: A1 (A-트랙 복귀 — 패킷 기작성)

## 2026-07-10 — B7 BGM 트랙 + B6 덕킹 완료 (v0.1.16) — 마케팅 3요소 중 전환·음악 완성
- 한 일: 렌더 BGM 스테이지(볼륨/루프/afade/adelay + sidechaincompress 덕킹 — 발화 구간 76% 감쇠 실증) / BGM 패널(카탈로그·미리듣기·볼륨·덕킹 토글, showcase 노출) / Music 레인(드래그·트림) / .dawn·autosave·아카이브 라운드트립 / 프리뷰 근사 재생.
- 열린 것: bgm은 버스 미경유(오버레이/TTS 관례) — A4에서 addBgm 승격. 덕킹 프리뷰 미지원(내보내기 정확).
- 다음: D7 (브랜드 킷)

## 2026-07-10 — D6 BGM 소스 팩 완료 (v0.1.15)
- 한 일: 절차 생성 음악 6무드(scripts/make-bgm-pack.ts — 순수 PCM 신스 8프리미티브, 시드 고정, 루프 꼬리 접기) → assets/bgm/*.m4a + catalog.json(pairsWithBroll 페어링). 통합 +7. 수치 검수 그린(피크 -2~-3dB 일관).
- 열린 것: **사용자 귀 검수 대기** — 별로인 무드는 시드/진행 수정 후 assets:bgm 재생성. 앱 노출은 B7.
- 다음: B7 (BGM 트랙 — B6 덕킹까지 묶는 것 검토)

## 2026-07-10 — B5 배속(setSpeed) 완료 (v0.1.14) — #9 닫을 수 있음
- 한 일: Clip.speed + 프로그램/소스 이중 좌표계(clipProgramDuration 단일 산식) + sync ceil/floor 반올림 규약(0.5~3× 라운드트립 그린) + setpts/atempo 렌더 + 프리뷰 배속 재생 + EffectPanel/라벨. 동사 17개. 실미디어 2×=7.81s/0.5×=31.21s 정산 정확(output/b5-speed/).
- 열린 것: 배속 램프(가변 속도)는 후속(#9 스코프대로). B8(데모 오토줌)의 dep 해제됨.
- 다음: D6 (BGM 소스 팩)

## 2026-07-10 — B4 전환(crossfade/dip) 완료 (v0.1.13) — #8 닫을 수 있음
- 한 일: Transition 모델(TL-INV-5·reconcile·splitAt 재매핑) + 동사 16개(addTransition/removeTransition, 플래너·GBNF 개방) + 렌더 폴드(소스 핸들 오버랩 xfade — **길이 완전 불변 실증**, dip은 fade+concat) + EffectPanel/배지. 실미디어 데모(output/b4-transitions/).
- 열린 것: 프리뷰에서 전환 재생 안 됨(C1 범위). 오디오는 오버랩 없이 afade(삭제 콘텐츠 부활 방지 — 설계 결정).
- 다음: B5 (배속 setSpeed)

## 2026-07-10 — B2 필름스트립+파형 완료 (v0.1.12)
- 한 일: sidecar extractThumbs(≈1장/s, 상한 120)·extractPeaks(20/s) + media:visuals IPC(mtime 캐시) + Timeline 클립 = 필름스트립+SVG 파형(preserveAspectRatio:none — 줌 무재그리기). unit 470·int 55·e2e 16·QA 8 그린. 실제 1080p 영상 캡쳐 확인(output/b2-timeline/).
- 열린 것: 보이스(TTS) 클립 파형은 미적용(B2 범위 제외 — 후속 후보), GitHub Actions는 과금 문제로 제거됨(로컬 체인만)
- 다음: B4 (전환 crossfade/dip-to-black)

## 2026-07-10 — ChatCut 분석 + B1 타임라인 v2 완료 (v0.1.11)
- 한 일: ChatCut Codex 플러그인 실체 규명(클라우드 웹 NLE + git 리포 플러그인 — A6로 등재, VIBE 문서 1-b절) / 사용자 결정으로 B-트랙 우선 재배열 / **B1 완료**: 시간 눈금(간격 사다리)+줌 1~16×(⌘휠 앵커)+가로 스크롤+sticky 라벨. unit 460·int 52·e2e 15·QA 8 그린, 캡쳐 확인.
- 열린 것: 없음
- 다음: B2 (썸네일 필름스트립 + 파형)

## 2026-07-10 — 바이브 고도화 로드맵 수립 + 연속성 킷 설치
- 한 일: Palmier Pro(YC S24, ⭐10.2k, 에이전트 도구 49개)·CapCut 갭 분석 → `docs/VIBE-EDITING-ROADMAP.md`; 운영 로드맵 A~E 26작업(`docs/roadmap/`), Phase A 패킷 5개, 복원 스크립트+SessionStart 훅, AGENTS.md/CLAUDE.md 배선
- 열린 것: 로드맵 착수는 사용자 승인 대기(우선순위 권고 1번 = A1+A2)
- 다음: A1 (advanced 게이트 철거 → 인앱 모드)
