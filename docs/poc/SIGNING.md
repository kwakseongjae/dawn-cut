# 코드사이닝 & Notarize 가이드

dawn-cut은 **MIT 오픈소스**로, 누구나 자기 Apple Developer 계정으로 사인해서
배포할 수 있게 설계됐습니다. 본 문서는 (1) 개발용 ad-hoc 사인, (2) 정식 Developer ID
사인, (3) Apple notarize까지 단계별로 정리합니다. (Mac 전용 — Windows 빌드는 다루지 않습니다.)

> 미서명 빌드는 이미 동작합니다: `pnpm --filter @dawn-cut/desktop dist:mac`
> → `apps/desktop/release/dawn-cut-0.1.0-arm64.dmg`. 사용자는 **우클릭 → 열기**로 1회 허용 후 실행.
> 본 문서는 그 1회 허용 없이도 더블클릭으로 열리게 만드는 방법입니다.

---

## 1. macOS — 개발용 ad-hoc 코드사이닝 (무료, 동일 머신 한정)
codesign 으로 *내장* 인증서 없이 ad-hoc 서명만 붙이면, Gatekeeper의 일부 검사를 통과할 수
있습니다(SIP가 켜진 동일 머신 내 실행 한정).
```bash
codesign --force --deep --sign - "apps/desktop/release/mac-arm64/dawn-cut.app"
```
ad-hoc은 외부 배포엔 부적합 — 받은 사용자 머신에서는 여전히 차단됩니다.

## 2. macOS — Developer ID 사인 (정식 배포)
필요한 것
- Apple Developer Program 계정 ($99/년)
- "Developer ID Application" 인증서가 키체인에 설치돼 있어야 함

`.env.signing` 만들기 (gitignore에 추가):
```
APPLE_TEAM_ID=ABCDE12345
CSC_NAME="Developer ID Application: Your Name (ABCDE12345)"
```

`apps/desktop/package.json`의 `build.mac` 수정:
```jsonc
"mac": {
  "target": "dmg",
  "category": "public.app-category.video",
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist"
  // identity는 환경변수 CSC_NAME에서 자동 픽업
}
```

`apps/desktop/build/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
  <key>com.apple.security.files.user-selected.read-write</key><true/>
</dict></plist>
```

빌드:
```bash
source .env.signing
pnpm --filter @dawn-cut/desktop dist:mac
```
electron-builder가 CSC_NAME 인증서로 사인합니다.

## 3. macOS — Notarize (Apple 공증)
사인된 .app/.dmg를 Apple에 보내 공증을 받으면 첫 실행 시 인터넷 검증 후 그냥 열립니다.
electron-builder가 자동 처리하려면 환경변수:
```
APPLE_ID="your@email"
APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # appleid.apple.com 에서 발급
APPLE_TEAM_ID=ABCDE12345
```
`package.json build.mac`에 `"notarize": { "teamId": "ABCDE12345" }` 추가하거나
`afterSign` 훅에서 `@electron/notarize` 직접 호출.

검증:
```bash
xcrun stapler validate apps/desktop/release/dawn-cut-*.dmg
spctl -a -t open --context context:primary-signature -v apps/desktop/release/dawn-cut-*.dmg
```

## 4. CI 권장 구성
- macOS 빌드/사인/notarize: `runs-on: macos-14`. 시크릿: CSC_NAME, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, P12 base64.

## 5. 자동 업데이트
`electron-updater`로 GitHub Releases에서 자동 업데이트 제공 가능 (signed 빌드만 권장).

## 정리
| 단계 | 비용 | 결과 |
|---|---|---|
| 미서명 (현재) | $0 | 우클릭 열기 1회 허용 후 실행 |
| ad-hoc 사인 | $0 | 같은 머신 빌드/실행 (배포 X) |
| Developer ID | $99/년 | Gatekeeper 통과, 첫 실행 시 인터넷 점검 |
| + Notarize | $99/년(동일) | 첫 실행 매끄러움, "Apple-notarized" 표시 |
