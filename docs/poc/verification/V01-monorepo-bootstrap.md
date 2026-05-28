# V01 — pnpm 모노레포 부트스트랩 + 빌드/경계/CI 골격

> 검증 대상: 게이트 G0 / 체크리스트 0.1, 0.2, 0.3
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)

## 목적
dawn-cut의 3-레이어 아키텍처를 담을 pnpm 모노레포 골격이 빌드되고, 레이어 경계(`packages/core`의 electron/fs/child_process 비의존)가 정적으로 강제되며, CI가 게이트로 동작함을 증명한다. 이 골격이 없으면 이후 모든 게이트(G1~G8)의 단일 진입점 `pnpm verify`가 성립하지 않으므로 PoC 전체의 토대다.

## 전제조건
- 환경([05-ENVIRONMENT](../05-ENVIRONMENT.md) §1): Node ≥ 20, pnpm ≥ 9, macOS, Xcode CLT.
- 선행 게이트 없음(G0가 최초 게이트).
- 외부 바이너리(whisper.cpp/FFmpeg)는 이 문서 범위 밖(V03~V05). 여기서는 워크스페이스/빌드/lint/boundary/CI 골격만.

## 산출물 (Deliverables)
- 루트 `package.json` + `pnpm-workspace.yaml`: 워크스페이스 글롭 `apps/*`, `packages/*`, `sidecar/*`.
- 워크스페이스 패키지(빈 골격이라도 빌드 통과):
  - `apps/desktop` (electron-vite, main/preload/renderer 자리)
  - `packages/core` (순수 TS, 외부 의존 0)
  - `packages/ui` (React 컴포넌트 자리)
  - `sidecar/ffmpeg`, `sidecar/stt` (subprocess 래퍼 자리)
- 루트 `tsconfig.base.json`: `"strict": true`(+ `noUncheckedIndexedAccess`, `noImplicitOverride` 권장), 각 패키지 `tsconfig.json`이 extends.
- lint/format: ESLint + Prettier(또는 Biome) 설정, 루트 스크립트.
- `dependency-cruiser` 설정 `.dependency-cruiser.cjs`: `packages/core` → `electron|fs|child_process|^path$`(node builtin) import를 `error`로 금지(불변식: [00-SEED](../00-SEED.md) CONSTRAINTS 1, [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) 레이어 경계).
- 루트 `package.json` 스크립트 골격:
  - `build`: `pnpm -r build`
  - `boundary`: `depcruise packages/core --config .dependency-cruiser.cjs`
  - `verify`, `verify:unit`, `verify:int`, `verify:e2e` (이 단계엔 lint+boundary+unit까지만 실연결, int/e2e는 후속 게이트에서 채움)
- CI 워크플로 `.github/workflows/ci.yml`: `pnpm install` → `pnpm -r build` → `pnpm verify`, 실패 시 비0 종료로 red.

## 검증 절차
```bash
# 0) 의존성 설치
pnpm install

# 1) 전 패키지 빌드 (exit 0 필요)
pnpm -r build

# 2) 레이어 경계 검사 (core 위반 0건 필요)
pnpm boundary | tee artifacts/g0-boundary.txt

# 3) TS strict 확인 (각 tsconfig가 strict:true 상속)
pnpm -r exec tsc --noEmit

# 4) lint/format
pnpm lint

# 5) CI red 동작 확인(음성 테스트): core에 의도적 위반(import 'fs')을 임시 추가 → pnpm boundary 비0 종료 확인 후 원복
```

## 자동 테스트 게이트
- 명령: `pnpm -r build && pnpm boundary`
- PASS 조건(기계 판정):
  - `pnpm -r build` 종료코드 == 0 ([03-TEST-GATES](../03-TEST-GATES.md) G0).
  - `pnpm boundary` → `packages/core`의 `electron|fs|child_process|path(node)` import **0건**, 종료코드 == 0 ([03-TEST-GATES](../03-TEST-GATES.md) G3의 boundary 판정과 동일 규칙, [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) 레이어 경계).
  - CI: 위반 주입 시 `pnpm verify` 종료코드 != 0(red), 정상 시 == 0(green) — green/red 양방향 동작.

## 통과 기준 체크
- [x] `pnpm -r build` 종료코드 0 (모든 패키지 빌드 성공) — [03](../03-TEST-GATES.md) G0
- [x] `pnpm boundary` core 위반 0건, 종료코드 0
- [x] 각 패키지 `tsconfig`가 `strict: true` 상속, `tsc --noEmit` 통과
- [x] `pnpm lint` 통과
- [x] CI 워크플로가 정상 커밋에 green, 위반 주입 커밋에 red(종료코드 != 0)

## 증거 (Evidence)
- [x] `artifacts/g0-boundary.txt` 생성됨 (dependency-cruiser 결과, 위반 0건) — [03](../03-TEST-GATES.md) G0 증거와 일치
- [x] CI 실행 로그/배지(green) — `pnpm verify` 종료코드 0 기록

> 주: G0의 스모크 E2E 증거 `artifacts/g0-smoke.png`는 [V02](V02-electron-shell.md)에서 산출한다.

## 실패 시 (STOP)
- 같은 게이트 3회 연속 실패 → **STOP-1**: 중단하고 실패 로그+가설과 함께 사람에게 보고([00-SEED](../00-SEED.md) §SAFETY).
- 빌드/경계를 통과시키려고 판정 기준을 느슨하게 하거나(boundary 규칙 약화) 검사 대상을 줄이는 것 금지 → **STOP-4**.
- 계약([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md)) 변경이 필요하다고 판단되면 임의 변경 금지 → **STOP-3**(사람 승인).
