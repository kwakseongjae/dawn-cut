# V02 — Electron 셸 부팅 + typed IPC 브리지

> 검증 대상: 게이트 G0 / 체크리스트 0.4, 0.5
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [01-POC-DESIGN](../01-POC-DESIGN.md) §4~§5

## 목적
클릭 가능한 Electron 앱이 실제로 부팅되어 창 1개를 렌더하고(타이틀 == `dawn-cut`), renderer↔main이 보안 격리된 typed IPC 채널로 통신함을 증명한다. 이는 H5(Electron에서 전 흐름을 클릭으로 수행)의 토대이며, 이후 모든 IPC 채널([01](../01-POC-DESIGN.md) §5)이 올라탈 보안 브리지를 확립한다.

## 전제조건
- G0의 V01 green: `pnpm -r build` exit 0, `pnpm boundary` 위반 0건.
- `apps/desktop`에 electron-vite(main/preload/renderer) 골격 존재.
- Playwright(Electron) 설치 완료.

## 산출물 (Deliverables)
- `apps/desktop/main`: BrowserWindow 생성. `webPreferences`에 **`contextIsolation: true`, `nodeIntegration: false`**([01](../01-POC-DESIGN.md) §4 레이어 경계 계약), preload 스크립트 연결. 문서 타이틀 `dawn-cut`.
- `apps/desktop/preload`: `contextBridge.exposeInMainWorld`로 typed API 노출. PoC ping/pong 채널 `app:ping`(입력 `{ nonce: string }` → 출력 `{ pong: string }`).
- `apps/desktop/main` IPC 핸들러: `ipcMain.handle('app:ping', ...)` → 입력 검증(zod) 후 `{ pong: nonce }` 반환.
- 타입 정의: 노출 API의 TS 타입(renderer에서 `window.dawn.ping()` 타입 안전).
- 스모크 E2E `tests/e2e/smoke.spec.ts`(Playwright Electron):
  - 앱 실행 → 창 타이틀 `dawn-cut` 단언,
  - ping/pong 왕복(`nonce` == `pong`) 단언,
  - 스크린샷 저장 `artifacts/g0-smoke.png`.

## 검증 절차
```bash
# 1) 빌드
pnpm -r build

# 2) 스모크 E2E만 실행 (Playwright -g "smoke")
pnpm verify:e2e -g "smoke"

# 산출: artifacts/g0-smoke.png

# 3) (보안 격리 정적 확인) main의 webPreferences 검사
grep -n "contextIsolation" apps/desktop/main/*.ts   # true 확인용 참고
grep -n "nodeIntegration"  apps/desktop/main/*.ts    # false 확인용 참고
```

## 자동 테스트 게이트
- 명령: `pnpm verify:e2e -g "smoke"`
- PASS 조건(기계 판정):
  - Electron 창이 뜨고 **타이틀 == `"dawn-cut"`**([03-TEST-GATES](../03-TEST-GATES.md) G0).
  - ping/pong 왕복: 보낸 `nonce` == 받은 `pong` (typed IPC 동작 확인).
  - 보안 격리: 스모크 테스트가 `webPreferences.contextIsolation === true` 및 `nodeIntegration === false`를 단언(런타임 또는 메인 프로세스 노출값 검사).
  - 증거 파일 `artifacts/g0-smoke.png`가 생성됨.

## 통과 기준 체크
- [x] Electron 창 1개 렌더, 타이틀 == `"dawn-cut"` — [03](../03-TEST-GATES.md) G0
- [x] `contextIsolation: true`, `nodeIntegration: false`
- [x] `app:ping` 채널 ping/pong 왕복 성공(`nonce`==`pong`)
- [x] `pnpm verify:e2e -g "smoke"` 종료코드 0

## 증거 (Evidence)
- [x] `artifacts/g0-smoke.png` 생성됨 (창 렌더 스크린샷) — [03](../03-TEST-GATES.md) G0 증거와 일치

## 실패 시 (STOP)
- 같은 게이트 3회 연속 실패 → **STOP-1**(중단·보고).
- 스모크 통과를 위해 타이틀 단언/격리 단언을 약화시키는 것 금지 → **STOP-4**.
- 테스트 런타임에 네트워크 호출 추가 금지(결정성) → **STOP-5**.
