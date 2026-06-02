# dawn-cut 1차 프로덕션(v0.1) 준비 — 출시 결정 문서

> 작성 기준: 코드 직접 교차검증 + 이전 감사 3종(readiness / publish / honesty) 종합.
> 원칙: 과장 없음. 모든 판정에 코드 근거(`파일:심볼`)를 단다. 숫자가 어긋나면 "어긋난다"고 적는다.

---

## 1. 출시 준비 한눈에 (정직)

**결론: 코어 기능은 "주장대로 실제 동작"하고 테스트로 교차검증된다. 하지만 지금 상태 그대로 GitHub 공개 + .dmg 배포를 하면 안 된다.** 코드의 문제가 아니라 **배포 패키징 1건 + 문서/에셋 정합성 몇 건**이 막혀 있다.

- 기능 자체의 ship-blocker: **없음.** 자동 자막 번인, 색보정 6프리셋, 9:16/1:1 리프레이밍, 스타일 팩, 컷/오버레이/TTS는 앱에서 실제로 동작하고 실 ffmpeg/whisper 픽셀·오디오 검증을 통과한다.
- **배포(.dmg) ship-blocker: 1건 있음.** 패키징된 앱이 vendor 바이너리(whisper/llama/ffmpeg)를 **상대경로/PATH**로 찾는다(`sidecar/stt/src/index.ts:11`, `sidecar/llm/src/chat.ts:6`, `sidecar/ffmpeg/src/index.ts:9`). `apps/desktop`에 `isPackaged`/`process.resourcesPath`/`extraResources` 처리가 **전무**(grep 0건, `apps/desktop/package.json:36` `files`만 존재). → `/Applications`에서 실행하면 `process.cwd()`가 프로젝트 루트가 아니므로 **전사/렌더/LLM이 전부 실패**. .dmg는 빌드되지만 받은 사용자가 첫 실행에서 아무것도 못 한다.
- **공개(GitHub repo) ship-blocker: 2건 있음.** 깨진 히어로 이미지(`README.md:27` → `assets/hero.gif`, `assets/` 비어있음 — 이미 주석 처리로 완화) + 무출처 외부 사진(`make-demo-assets.sh`가 `picsum.photos/seed/dawncut1`·`dawncut2`에서 받음, NOTICE 크레딧 0건; demo-output에 잔존 시 미배포 확인 필요).

**즉, "GitHub 소스만 공개"(빌드는 각자) 시나리오라면 막는 것은 README/에셋 2건뿐이고 30분~1시간. ".dmg까지 배포"한다면 패키징(P0-1)이 추가로 막는다 — 이건 코드 작업.**

---

## 2. ★1차 프로덕션 기능 CHOICE

### 2-1. 기능별 ship-ready 판정 (버킷 제안)

#### v0.1 출시 권장 (ship-ready, 앱 경로에서 실제 동작·검증됨)

| 기능 | 판정 | 근거 |
|---|---|---|
| 자동 자막(STT→cue→번인) | ship-ready | 실 whisper STT(`g2-stt`, `g2-stt-korean`), `transcriptToCues`→`captionFrames`(reveal/karaoke)→`rasterizeSubtitle`→실제 컴포지팅. 픽셀검증 `g18/g27/g28/g29-cjk`. UI `packages/ui/src/index.tsx`의 doBurn 풀 와이어. |
| 단어별 자막 애니(reveal/karaoke) | ship-ready | `core/subtitles.ts:captionFrames` 순수·결정적, `index.tsx:1201` 프레임별 PNG 합성. G28/G29 통과. |
| 색보정 6프리셋(warm/cool/punch/cinematic/flat/vivid) | ship-ready | `core/effects.ts:COLOR_PRESETS`, intensity 선형가중. 실 ffmpeg `g30-effects`. UI `EffectPanel`. |
| 9:16/1:1 리프레이밍 | ship-ready | `ffmpeg/index.ts:cropForAspect/renderEdl(reframe)`, 오버레이 좌표 재계산. `reframe.test.ts` 3/3. UI `data-testid="reframe"`. |
| 스타일 팩 6종(=plan, 1클릭) | ship-ready | `templates.ts`, UI `packages/ui/src/index.tsx`의 applyPackAndBurn(적용+자동 번인). e2e `style-pack.spec.ts`. |
| 컷/말버릇·무음 제거/glossary | ship-ready | `g5-silence`, `detectFillers`, `applyGlossary`. 단위·통합 통과. |
| 오버레이(이미지/gif/스티커/키프레임/블렌드/B-roll) | ship-ready | `g18/g19/g22/g23/g26` 픽셀검증, **출력영상에 실제 합성**. |
| TTS 보이스오버 | ship-ready | 실 macOS `say`+whisper 왕복 `g17/g17b`. |
| command bus 11 verb + 해시체인 감사 + dryRun | ship-ready | `edit-command.ts`(불변식 throw, +applyAutoEnhance·correctWord), `audit.ts`(canonical JSON, R2). property test 포함. |

#### v0.2 (동작하나 폴리시/연결 필요 — "실험적" 라벨로 같이 낼 수는 있음)

| 기능 | 판정 | 근거/사유 |
|---|---|---|
| 자연어 편집(로컬 LLM 플래너) | needs-polish | `planAndPreview`→룰 폴백 graceful. 그러나 CI/e2e는 `DAWN_DISABLE_LLM=1`로 **룰 경로만** 결정적 검증(`nl-command.spec.ts:22`). 실제 LLM 품질·웜업은 자동검증 밖이고 사용자가 `setup-llm.sh`로 모델을 받아야 동작. "AI가 알아서" 체감은 모델 설치+1.5B 품질에 의존. |
| MCP 서버(open/plan/apply/render+reframe) | needs-polish | `apps/mcp/src/session.ts` 전부 구현·테스트(`mcp-render.test.ts`, `session.test.ts`). 단 (a) MCP `render`는 **자막 번인·오버레이 미포함**(`session.ts:164` 주석 명시; 컷+색+줌+reframe만), (b) `private:true`+bin이 미컴파일 `./src/index.ts`라 외부 AI가 `npx`로 못 띄움. 헤드리스 고급 경로로는 OK. |

#### 나중(미구현 — 출시 범위에서 제외, 로드맵으로 정직 공지)

- 적응형 auto-enhance(signalstats), 전환/비트싱크/B-roll 자동, 저신뢰 어절 UX, 앱↔MCP 라이브 브리지, OTIO/멀티트랙. (브리프·README 로드맵과 일치, 전부 미구현.)

### 2-2. 출시 시나리오 (사용자가 고를 것)

| | 시나리오 A — 풀셋 | 시나리오 B — 코어 + 실험적 라벨 ★추천 | 시나리오 C — 소스 공개만(빌드 없이) |
|---|---|---|---|
| 포함 기능 | v0.1 코어 전부 + NL/MCP를 정식 기능으로 | v0.1 코어 전부(정식) + NL/MCP를 "experimental"로 동봉 | v0.1 코어 전부 + NL/MCP 코드 포함, **.dmg 미배포** |
| 배포물 | GitHub repo + 서명/공증 .dmg | GitHub repo + (선택) .dmg | GitHub repo만(`pnpm install` 후 직접 빌드) |
| 패키징 작업(P0-1) | **필수**(+공증) | .dmg 낼 거면 필수 / repo만이면 불필요 | **불필요** |
| 리스크 | 높음 — NL/MCP를 "정식"이라 광고하면 모델 미설치·1.5B 품질·MCP 자막갭에서 기대치 붕괴. 공증까지 추가 부담 | 낮음 — 검증된 코어는 정식, 미성숙부는 정직 라벨. 데모-라이브 갭 최소 | 가장 낮음 — 코드 진실성만 맞추면 됨. 다만 "데스크톱 앱"으로 써보려는 일반 사용자는 진입장벽 |
| 막는 것 | P0-1 패키징 + README/에셋 정합 + 공증 | README/에셋 정합(필수) + (.dmg면) P0-1 | README/에셋 정합 2건만 |
| 추천도 | 비추천 | **추천** | 차선(빠른 첫 공개용) |

**추천: 시나리오 B.** 근거 — 코어는 픽셀/오디오로 검증된 진짜이므로 정식으로 내고, NL/MCP는 동작은 하나 (모델 설치 의존 + MCP 자막갭 + bin 미컴파일) 검증 밖 영역이 있으니 "experimental"로 정직하게 묶는다. 이게 이 프로젝트의 셀링포인트(정직성)와도 맞고 데모-라이브 갭이 가장 작다. **.dmg를 첫 릴리스에 꼭 넣을지는 P0-1 패키징 공수를 보고 결정** — 급하면 "B를 repo-only로 먼저(=C에 가깝게), .dmg는 v0.1.1"도 합리적.

---

## 3. 퍼블리시 체크리스트 (우선순위 순)

### P0 — 안 하면 첫인상/기능이 깨짐
1. **(.dmg 배포 시) vendor 바이너리 경로 해석** — `isPackaged`일 때 `process.resourcesPath` 기준 경로 + `extraResources` 번들(ffmpeg static, LGPL NOTICE 갱신) 또는 첫 실행 다운로더. whisper/llama 모델은 다운로더 권장. `apps/desktop/src/main/index.ts`, `apps/desktop/package.json:36`. (repo-only 공개면 이번엔 생략 가능, v0.1.1로.)
2. **히어로 이미지** — `assets/hero.gif` 생성·커밋(`scripts/make-hero-demo.sh`로 만든 뒤 `assets/`로 복사; `output/`은 gitignore라 그대로는 안 됨) **또는** `README.md:26-35`의 이미지 링크/Placeholder 문구 제거. 깨진 `<img>`로 공개되는 것 방지.
3. **데모 에셋 라이선스** — `make-demo-assets.sh`가 `picsum.photos/seed/dawncut1`·`dawncut2`에서 받는 사진이 무출처. (a) CC0/자체생성 컬러카드로 교체(스크립트에 fallback 있음) **또는** (b) NOTICE에 Picsum(Lorem Picsum) 출처·라이선스 명시. "license-clean"을 내세우는 프로젝트엔 중요.

### P1 — 정직성/정합 (이 프로젝트의 핵심 가치)
4. **README 3중 모순 정리** — 한 기준(=실제 구현 상태)으로 통일:
   - `README.md:16-20` 상단 배너 "NL not shipped yet / PoC" ↔ `:132` "command bus + llama 플래너 + MCP all work today" — 충돌. 코드 기준 `:132`가 맞음(배너가 보수적). "PoC → working core + experimental NL/MCP"로 통일 권장.
   - `README.md:136-137` "Still open: MCP render/export, 9:16 auto-reframing" — **둘 다 이미 구현·테스트됨**(`session.ts:166` render, `mcp-render.test.ts`; `renderEdl(reframe)`, `reframe.test.ts`). 과소표기, "Still open"에서 제거.
5. **테스트 수 단일화** — `pnpm verify` 실측 = unit **341** / integration **31** / e2e **7**(=확정). `docs/REVIEW.md`의 339는 stale(그 사이 templates·captionFrames·reframe 테스트 추가). 문서/릴리스노트는 **341**로 통일.
6. **demo-output/README 스테일 갱신** — `demo-output/README.md:30` "base 모델 'Don Cut' 한계"(이미 large-v3-turbo 기본), `:31` "오버레이 영상 위 합성은 preview(로드맵)"(실제론 `g18/g22`로 합성됨). large-v3-turbo 채택 이전 문서 → 갱신 or 데모 재생성.

### P2 — 위생/거버넌스 (블로커 아님)
7. **e2e 플레이크 완화** — `playwright.config.ts:11` `trace: 'on'` + `retries` 미설정 → 트레이스 zip 레이스(ENOENT)로 그린 빌드가 빨강 뒤집힘(whisper 설치된 풀환경에서). `trace: 'on-first-retry'` + `retries: process.env.CI ? 1 : 0`. 5분.
8. **거버넌스 파일** — `CONTRIBUTING.md`/`CODE_OF_CONDUCT.md`/`SECURITY.md`/`.github/ISSUE_TEMPLATE`/`PULL_REQUEST_TEMPLATE.md` 전부 없음(`.github/`엔 workflows만). 공개 협업 받으려면 추가.
9. **개인경로 정리** — ✅ 완료. `packages/core/src/planner.ts:3`의 개인 절대경로 주석 제거(커밋 `9e56baa`) + `docs/REVIEW.md`·`demo-output/project.dawn`의 절대경로를 repo-relative로 치환(공개 위생).
10. **버전 태그** — 루트 `package.json:3` `version: 0.0.0`, git tag 0건. 출시 시 `0.1.0` 세팅 + `v0.1.0` 태그 + 릴리스노트.

---

## 4. 사용자(너)가 직접 검수할 것 — 코드 말고 "눈으로/실행으로"

> 코드 진실성은 이미 교차검증됨. 아래는 **네 판단·실행이 필요한 5가지**다.

1. **앱 실행 1회 풀 플로우** — `import → 한국어 영상 transcribe → 자막 번인(reveal/karaoke) → 색보정 vivid 1탭 → 9:16 reframe → export`. 픽셀테스트는 통과하나 **체감 품질(자막 가독성·색감·세로 크롭 구도)은 네 눈**으로 봐야 함. (코드상 동작은 보증, 미감은 사람 판단.)
2. **NL/MCP를 정식으로 낼지 결정** — `setup-llm.sh`로 1.5B 모델 받아 자연어 편집 몇 개 돌려보고 **"AI가 알아서" 체감이 마케팅에 부합하는지** 판단. 부족하면 시나리오 B의 "experimental" 라벨로 가는 게 안전.
3. **시나리오 A/B/C 중 택1 + .dmg를 첫 릴리스에 넣을지** — P0-1 패키징 공수를 감당할지가 갈림길. (추천: B, .dmg는 공수 보고 v0.1 또는 v0.1.1.)
4. **데모 에셋 처리 방식 택1** — Picsum 사진을 교체할지 NOTICE 크레딧을 달지. 히어로 GIF를 만들지 링크를 뺄지. (둘 다 P0, 네 취향·시간에 달림.)
5. **공개 산출물 최종 시청** — `output/{reframe,mcp,showcase,korean}`의 실제 mp4를 재생해 **릴리스에 붙일 데모로 쓸 만한지** 확인. (output은 gitignore라 배포 안 되지만, 릴리스 페이지/README GIF 소재로 쓸지는 네가 골라야 함.)

---

## 5. 알려진 한계 (출시 시 README/릴리스노트에 정직 공지)

- **자연어 편집은 모델 설치 의존 + 1.5B 한계.** Qwen2.5-1.5B는 번들하지 않음(`setup-llm.sh`로 사용자가 받음). 미설치 시 룰 기반 폴백으로 동작. 자동검증은 룰 경로만(LLM 품질은 검증 밖).
- **MCP `render`는 자막·오버레이를 굽지 않음.** 외부 AI가 `open→plan→apply→render`로 만든 mp4엔 **자막이 안 들어간다**(앱 export 경로엔 들어감). `session.ts:164`에 정직하게 주석화됨. 이 이중성을 릴리스노트에 명시.
- **앱↔MCP 라이브 브리지 없음.** MCP는 `.dawn` 파일 단위 헤드리스. 실행 중인 앱을 조작하지 못함.
- **MCP는 `npx` 미지원** — `private:true` + bin이 미컴파일 소스. 고급 사용자가 소스에서 띄워야 함.
- **미구현(로드맵):** 적응형 auto-enhance, 전환/비트싱크, 저신뢰 어절 UX, OTIO/멀티트랙.
- **해시체인 감사는 보안 서명이 아님** — `audit.ts:11`에 명시(cyrb53, tamper-evident이지 암호서명 아님). 과대포장 금지.
- **플랫폼:** Mac 우선. TTS 기본값이 macOS `say`라 타 OS는 별도 경로 필요.
- **e2e 1건 플레이크(인프라):** Playwright 트레이스 zip 레이스. 제품 결함 아님, P2 설정으로 완화 가능.

---

### 부록: 검증 사실(이 환경 실측 기준)
- `pnpm verify` 6게이트 종료코드 0(green). lint 통과(경고 ~15, 에러 0), boundary 0위반(core 순수성), build 클린.
- unit **341**(실측 확정), integration 31/25파일(실 ffmpeg/whisper/say), e2e 7(1건 인프라 플레이크, 재실행 시 클린).
- vendor(whisper.cpp/llama.cpp/모델/bin)·output·artifacts·fixtures 중간물 전부 gitignore 확인. `.DS_Store`/`.env`/시크릿 미추적. LICENSE(MIT)+NOTICE 존재. 공개 데모 미디어 총 ~5.0MB(demo 328K + demo-output 4.7M).
