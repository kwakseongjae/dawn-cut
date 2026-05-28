# 00 — 자율주행 Seed (Framework-Agnostic Goal Spec)

> 이 문서는 **자율 개발 에이전트가 그대로 먹고 실행하는 goal**이다. Ouroboros·Ralph·donguri 등 특정 도구에 묶이지 않는다.
> 에이전트는 [02-CHECKLIST](02-CHECKLIST.md)를 순서대로 통과시키고, [03-TEST-GATES](03-TEST-GATES.md)가 전부 green이면 완료를 선언한다. 그 외엔 완료가 아니다.
>
> 형식: GOAL / CONTEXT / SCOPE / CONSTRAINTS / ACCEPTANCE / VERIFICATION / SAFETY / DONE / NORTH-STAR

---

## GOAL
dawn-cut의 **PoC 수직 슬라이스**를 완성한다: 클릭 가능한 macOS Electron 앱에서
**영상 import → whisper.cpp 자동 자막 → 전사 텍스트에서 단어 삭제 시 타임라인 리플 컷 → 자동 무음 제거 → FFmpeg로 MP4 export** 를 끝까지 관통하고, 모든 핵심 불변식을 자동테스트로 증명한다.

가장 중요한 증명 대상(R2): **전사↔타임코드 양방향 동기화**가 어떤 편집 후에도 깨지지 않는다.

## CONTEXT
- 아키텍처: [../ARCHITECTURE.md](../ARCHITECTURE.md) (3-레이어, core는 순수 TS로 격리).
- 데이터 계약: [04-DATA-CONTRACTS.md](04-DATA-CONTRACTS.md) (단일 진실 원천).
- 환경/픽스처: [05-ENVIRONMENT.md](05-ENVIRONMENT.md) (실제 whisper.cpp+FFmpeg 로컬).
- 시장 맥락: OpenCut(오픈소스 CapCut, ⭐52k)이 범용 타임라인을 선점 → dawn-cut은 **Vrew식 텍스트 기반 편집**을 wedge로 차별화. 이 PoC가 그 wedge의 기술 성립성을 증명한다.

## SCOPE
**In**: G0~G8([02-CHECKLIST](02-CHECKLIST.md)) 전부. 단일 비디오 트랙, 단일 소스, 결정적 fixture.
**Out**: 다중 트랙/소스, 이펙트·트랜지션·키프레임, 자막 스타일링 UI, TTS·번역, 배포(서명/notarize), 성능 최적화, 디자인 완성도. (모델은 다중 대비로 설계하되 PoC는 단일만 구현)

## CONSTRAINTS (불변 — 어기면 실패)
1. `packages/core`는 `electron`/`fs`/`child_process`/node-`path` 를 import 금지. 파일·프로세스 접근은 주입. (boundary 테스트로 강제)
2. 시간은 정수 µs. 부동소수 누적 금지. 시간 비교 허용오차는 명시된 곳만 ±1 frame.
3. FFmpeg는 subprocess 호출, `--enable-gpl` 금지(LGPL 유지). GPL 코드(Kdenlive/Shotcut/OpenShot) 차용 금지.
4. 모든 외부 라이선스(whisper.cpp MIT, OpenCut MIT 차용분) NOTICE 표기.
5. 테스트는 `fixtures/` 고정 자산만 사용. 네트워크/랜덤 입력 금지(셋업 단계 제외).
6. 데이터 계약([04])과 코드 불일치는 빌드 실패로 간주.

## TECH (확정)
Electron(electron-vite) · React+TS · Zustand · pnpm workspaces(+Turbo) · Vitest · Playwright · fast-check(property) · zod(런타임 스키마) · dependency-cruiser(boundary). 외부: whisper.cpp(ggml-base) · FFmpeg/ffprobe(brew).

## ACCEPTANCE (게이트 = 합격 기준)
[03-TEST-GATES](03-TEST-GATES.md)의 G0~G8 PASS 조건을 그대로 합격 기준으로 채택. 요약:
- G0 빌드+스모크E2E+boundary green
- G1 fixture 생성 + 오디오추출(16k/mono) green
- G2 whisper 전사 재현율 ≥0.90, 타임스탬프 단조
- G3 T/TL/SYNC 불변식 단위테스트 + 의존성 경계 green
- G4 deleteWordRange property test(≥200 케이스, 0 반례) — 전 불변식+undo왕복+질량보존
- G5 무음 검출 IoU≥0.8 + 컷 후 길이 일치
- G6 프리뷰 컷 경계 seek
- G7 export 길이 == EDL.totalDuration ±1frame
- G8 Playwright E2E 3종 + `pnpm verify` 종료코드 0

## VERIFICATION PROTOCOL (에이전트가 매 단계 수행)
1. 게이트 항목 구현 → 대응 자동테스트 작성/실행.
2. `pnpm verify:<layer>` green 확인 → 증거 산출물 `artifacts/` 생성.
3. 대응 검증 문서 `verification/Vxx`의 Evidence 충족 확인.
4. [02-CHECKLIST]의 해당 `[ ]`→`[x]` 갱신(커밋/PR에 기록).
5. 다음 게이트로(순차 의존 준수).

## SAFETY / STOP (자율주행 안전판)
- **STOP-1**: 같은 게이트 3회 연속 실패 → 중단, 실패 로그+가설과 함께 사람에게 보고.
- **STOP-2**: 환경 셋업(whisper 빌드/모델/ffmpeg) 실패 → 중단 보고(임의 우회 금지).
- **STOP-3**: 계약([04]) 변경이 필요하다고 판단되면 → 임의 변경 금지, 사람 승인 요청(계약은 단일 진실 원천).
- **STOP-4**: 테스트를 통과시키려고 **판정 기준/허용오차를 느슨하게 바꾸거나 fixture를 조작**하는 것 금지. 게이트를 약화시키지 말 것.
- **STOP-5**: 네트워크 호출을 테스트 런타임에 추가하지 말 것(결정성 훼손).
- 파괴적 작업(rm -rf, 강제 push 등) 금지. 커밋/푸시는 명시 요청 시에만.

## DONE (완료의 정의)
[03-TEST-GATES §5] 그대로:
1. `pnpm verify` 종료코드 0 (G0~G8 green)
2. `artifacts/` 게이트 증거 전부 존재
3. V01~V13 Evidence 충족
4. 02-CHECKLIST 전 항목 `[x]`
**위 4개가 동시 충족될 때만 완료.** 부분구현/red/누락은 완료 보고 금지.

## NORTH-STAR (왜 PoC인가 — OpenScreen/OpenCut 이상으로 가는 길)
이 PoC는 끝이 아니라 **차별화 wedge의 기술 증명**이다. 통과 시 다음을 확보한다:
- OpenCut에 없는 **텍스트 기반 편집 코어**(R2 증명됨) — 제품의 해자.
- 순수 TS 코어 → 추후 Windows(무비용)·모바일(코어 재사용) 확장 경로 확보.
- "구독·워터마크·계정 0 + 로컬 처리" 신뢰 기반.
PoC 이후 로드맵(자막 스타일링→TTS→번역→배포)은 ARCHITECTURE §4.2/§11. **PoC의 자동게이트 문화를 그대로 확장**해 품질로 OpenScreen/OpenCut을 넘는다.

## HOW TO RUN (도구 무관 실행 가이드)
- 어떤 자율 엔진이든: 이 Seed + 02/03/04/05 + verification/* 를 컨텍스트로 주입.
- 작업 순서 = 02-CHECKLIST 게이트 순서. 판정 = 03-TEST-GATES 명령.
- 매 게이트 후 `pnpm verify` 부분 실행으로 회귀 확인.
- 막히면 SAFETY STOP 규칙을 따른다.
