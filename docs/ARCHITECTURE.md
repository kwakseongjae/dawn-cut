# dawn-cut — 기술 아키텍처 설계서 (PRD + Spec)

> 오픈소스 AI 비디오 에디터. "구독·워터마크·계정 없는" Vrew/CapCut 대안.
> Mac 우선 출시 → Windows → 모바일 로드맵. 1차 셸은 Electron.
>
> 문서 버전: v0.1 (2026-05-27) · 상태: 초안 (결정 대기 항목 §12 참조)

---

## 1. 제품 개요 & 포지셔닝

### 1.1 한 줄 정의
> **dawn-cut** — 문서 편집하듯 영상을 편집하는 오픈소스 데스크톱 비디오 에디터.
> 자동 자막 · 텍스트 기반 컷편집 · 자동 무음 제거. 구독 없음, 워터마크 없음, 상업적 사용 자유.

### 1.2 왜 만드는가 (시장 빈틈)
- **OpenCut**(⭐ 52k, MIT)이 "오픈소스 CapCut(범용 타임라인 편집기)" 자리를 이미 선점. 정면 충돌은 불리.
- 반면 **Vrew**가 개척한 *"AI 자막 + 텍스트 기반 편집 + 자동 무음 제거"* 영역은 **오픈소스에 빈자리**.
- 또한 OpenCut은 **네이티브 데스크톱 앱이 아직 없음**(GPUI 재작성 진행 중, 미출시) → "제대로 도는 Mac 앱"이 그 자체로 차별점.
- 벤치마크 플레이북: `siddharthvaddem/openscreen`(Screen Studio 오픈소스화)이 명확한 카피 + 즉시 실행 데스크톱 빌드 + MIT로 바이럴 → 수십 개 포크 생태계 형성.

### 1.3 차별화 wedge
| 축 | dawn-cut | OpenCut | Vrew |
|---|---|---|---|
| 라이선스 | 오픈소스(MIT 예정) | 오픈소스(MIT) | 폐쇄형 |
| 텍스트 기반 편집 | ✅ 핵심 | ❌ | ✅ |
| 자동 자막(로컬 STT) | ✅ whisper.cpp | △ | ✅(클라우드) |
| 자동 무음 제거 | ✅ | ❌ | ✅ |
| 네이티브 데스크톱 | ✅ Mac 우선 | ❌(미출시) | ✅ |
| 프라이버시(로컬 처리) | ✅ | ✅(브라우저) | △ |

---

## 2. 목표 / 비목표

### 2.1 목표 (Goals)
- G1. Mac에서 **설치 후 5분 내 첫 영상 자막 컷편집** 완료 경험.
- G2. 모든 처리 **로컬**(영상이 서버로 안 올라감) — 프라이버시가 곧 마케팅.
- G3. 워터마크·구독·계정 **0** — 바이럴 카피의 신뢰성 확보.
- G4. 편집 코어/AI 로직을 셸에서 **분리** → 추후 Windows·모바일 확장 시 재작성 최소화.

### 2.2 비목표 (Non-Goals, MVP 기준)
- NG1. DaVinci/Premiere급 전문 컬러그레이딩·노드 컴포지팅.
- NG2. 클라우드 협업·실시간 공동편집.
- NG3. 모바일 (1차 범위 밖, 단 아키텍처는 대비).
- NG4. 자체 AI 모델 학습 (기존 OSS 모델 활용).

---

## 3. 타겟 사용자
- **P1. 1인 크리에이터 / 유튜버** — 말하는 영상에서 자막 + 무음 컷이 주작업.
- **P2. 숏폼 제작자** — 빠른 컷 + 자막 스타일링.
- **P3. 오픈소스/프라이버시 선호 개발자** — 구독·클라우드 거부감.

핵심 JTBD: *"말로 찍은 영상을, 대본 읽듯이 빠르게 다듬어서 자막 붙여 내보내고 싶다."*

---

## 4. 기능 스코프

### 4.1 MVP (Phase 1 — Mac)
1. **미디어 import** (mp4/mov/오디오) + 프리뷰 플레이어
2. **멀티트랙 타임라인** — 컷/트림/이동/스플릿/리플 (기본)
3. **자동 자막** — whisper.cpp 로컬 STT, 단어 단위 타임스탬프, 100+ 언어
4. **텍스트 기반 편집** ★ — 전사 텍스트에서 단어/문장 선택 → 해당 영상 구간 컷 (핵심 차별화)
5. **자동 무음 제거** — FFmpeg `silencedetect` → 무음/필러 구간 자동 컷 (임계값 조절)
6. **자막 스타일링** — 폰트/크기/색/위치/배경, 번인 또는 SRT export
7. **Export** — MP4(H.264) / GIF, 해상도·비율 프리셋
8. **프로젝트 저장/열기** — 재인코딩 없이 재편집

### 4.2 Phase 2
- TTS(텍스트→음성), 자막 번역(100+ 언어), 트랜지션/기본 이펙트, 오토 줌(Screen Studio식), B-roll/오버레이.

### 4.3 Phase 3
- Windows 정식 빌드, 플러그인 API, 배치/headless 렌더, 모바일(별도 §11).

---

## 5. 아키텍처 (3-레이어 + 포터빌리티 설계)

> 핵심 원칙: **"비디오·AI·편집 로직은 Electron을 몰라야 한다."**
> Electron은 *창과 OS 통합만* 담당. 이래야 추후 Windows는 무비용, 모바일은 코어 재사용으로 간다.

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 3 — AI / 자동화 서비스 (Node sidecar 또는 네이티브 바이너리)  │
│  · STT: whisper.cpp (단어 타임스탬프)                            │
│  · 무음/필러 검출: FFmpeg silencedetect + 후처리                  │
│  · (Phase2) TTS / 번역                                          │
│  ↕ JSON-RPC / stdio                                            │
├──────────────────────────────────────────────────────────────┤
│  Layer 2 — 편집 코어 (순수 TS, 플랫폼 무관) ★ 자산의 핵심          │
│  · 타임라인 데이터 모델 (트랙·클립·키프레임)                       │
│  · 편집 명령(Command) + Undo/Redo                               │
│  · 전사↔타임코드 매핑 (텍스트 기반 편집 로직)                     │
│  · 프로젝트 직렬화(.dawn)                                        │
│  · 렌더 명령 그래프 → FFmpeg 인자 생성기                          │
├──────────────────────────────────────────────────────────────┤
│  Layer 1 — UI / 셸                                             │
│  · UI: React + 타임라인/프리뷰/전사패널 (웹 기술, 재사용 가능)      │
│  · 셸: Electron (main=Node, renderer=React)                    │
│  · OS 통합: 파일 다이얼로그, 메뉴, 자동업데이트, 코드사이닝         │
└──────────────────────────────────────────────────────────────┘
        프리뷰 렌더: WebGL/WebGPU (renderer 내)
        최종 Export: FFmpeg(subprocess, 별도 프로세스)
```

### 설계 결정의 이유
- **Layer 2(편집 코어)를 순수 TypeScript로 분리** → Electron·Tauri·React Native 어디서든 import 가능. 모바일 전환 시 *이 레이어는 그대로 살아남음* (가장 비싼 자산이라서).
- **AI는 sidecar 프로세스** → Electron renderer를 안 막고, 무거운 네이티브 바이너리(whisper.cpp/FFmpeg)를 격리. 라이선스 전염도 차단(§10).
- **프리뷰와 Export 분리** — 프리뷰는 실시간성 위해 GPU(WebGL/WebGPU), Export는 정확성·품질 위해 FFmpeg.

---

## 6. 기술 스택 결정

| 영역 | 선택 | 근거 |
|---|---|---|
| 데스크톱 셸 | **Electron** | Mac/Win 가장 빠른 출시, 성숙한 자동업데이트·패키징·코드사이닝 |
| UI | **React + TypeScript + Vite** | 웹 기술 재사용 → 추후 모바일(RN/Capacitor)·웹 포팅 용이 |
| 상태관리 | **Zustand** | OpenCut도 사용, 타임라인 상태에 가벼움 |
| 타임라인 렌더 | Canvas/WebGL | 다수 클립 60fps 인터랙션 |
| 프리뷰 합성 | WebGL → (필요시 WebGPU) | GPU 가속 미리보기 |
| STT | **whisper.cpp (MIT)** | 로컬·오프라인·다국어·단어 타임스탬프, 라이선스 자유 |
| 인코딩/디코딩/무음검출 | **FFmpeg (LGPL, subprocess)** | 사실상 표준, subprocess로 라이선스 안전 |
| 패키지/모노레포 | pnpm 또는 Bun + Turbo | 코어/셸/AI 워크스페이스 분리 |
| 빌드/배포 | electron-builder + electron-updater | dmg/notarization/auto-update |

> ⚠️ 의사결정 기록: **모바일 로드맵이 있으나 1차 셸은 Electron 채택**(빠른 검증 우선).
> 트레이드오프 = 모바일은 추후 셸 재작성 필요. Layer 2를 순수 TS로 격리해 그 비용을 최소화함.
> (대안이었던 Tauri 2는 모바일까지 단일 코드였지만, 팀이 Electron 생태계 우선을 택함.)

---

## 7. 모듈 구조 (모노레포안)

```
dawn-cut/
├── apps/
│   └── desktop/          # Electron 셸 (main + preload + renderer 진입점)
├── packages/
│   ├── core/             # ★ Layer 2: 편집 코어 (순수 TS, 플랫폼 무관)
│   │   ├── timeline/     #   데이터 모델·명령·undo
│   │   ├── transcript/   #   전사↔타임코드 매핑 (텍스트 기반 편집)
│   │   ├── project/      #   .dawn 직렬화
│   │   └── render/       #   렌더 그래프 → FFmpeg 인자 빌더
│   ├── ui/               # React 컴포넌트 (타임라인/프리뷰/전사패널)
│   └── ai/               # Layer 3 클라이언트 (sidecar RPC 래퍼)
├── sidecar/
│   ├── stt/              # whisper.cpp 바이너리 + 모델 다운로드/실행
│   └── ffmpeg/           # FFmpeg 바이너리 동봉·호출 래퍼
└── docs/
    └── ARCHITECTURE.md   # (이 문서)
```

원칙: `packages/core`는 Electron/Node API를 **import 금지**(파일 IO·프로세스 호출은 인터페이스로 주입). 이게 포터빌리티의 핵심 계약.

---

## 8. AI 파이프라인 (텍스트 기반 편집의 심장)

```
영상 import
   └─> FFmpeg: 오디오 추출 (16kHz mono wav)
         └─> whisper.cpp: 전사 + 단어 타임스탬프
               └─> core/transcript: 단어 → {start, end, clipId} 매핑
                     ├─> UI 전사 패널 렌더 (단어 = 클릭 가능 토큰)
                     └─> 무음/필러 분석
                           └─> FFmpeg silencedetect 결과와 병합
                                 └─> "자동 컷 제안" 생성
```

- **텍스트 기반 컷의 핵심**: 사용자가 전사에서 단어 범위를 삭제하면 → core가 대응 타임코드 구간을 타임라인에서 리플 삭제. 양방향 동기화.
- 모델은 앱 동봉 대신 **최초 실행 시 다운로드**(번들 경량화). 크기/언어별 모델 선택 옵션.

---

## 9. OpenCut 활용 맵 (MIT — 합법적 활용)

| 활용 | 대상 | 방식 | 주의 |
|---|---|---|---|
| 설계 학습 | `docs/effects-renderer.md`, `keyframes.md`, `actions.md` | 렌더 파이프라인·키프레임·액션 모델 참고 | 가장 안전 |
| 코어 라이브러리 | `rust/wasm` (npm 배포됨) | GPU 컴포지터/이펙트를 의존성으로 차용 검토 | 재작성판은 API 불안정(moving target) |
| 모노레포 구조 | Bun+Turbo, core/shell 분리, WASM 빌드 | 구조 모방 (모바일 확장 용이) | — |
| UI/UX 패턴 | 타임라인 인터랙션, 편집기 레이아웃 | 패턴 참고 | 코드 직접 포크 비권장 |
| 포지셔닝 카피 | "no subscriptions, no watermarks, free for commercial use" | 차용 | — |

> **결론: 포크하지 말고, 코어는 라이브러리/직접구현, 설계·UX는 레퍼런스로.**
> 재작성판은 "외부 기여 미수용 + 아키텍처 설계 중"이라 포크 시 계속 추적 비용 발생.

---

## 10. 라이선스 가드레일

| 컴포넌트 | 라이선스 | 규칙 |
|---|---|---|
| dawn-cut 본체 | **MIT** (예정) | 바이럴·포크 생태계 위해 가장 개방적으로 |
| whisper.cpp | MIT | 자유 사용, NOTICE 표기 |
| OpenCut 코드/문서 | MIT | 차용 시 출처 표기 |
| FFmpeg | LGPL v2.1+ | **subprocess로 호출**, `--enable-gpl` 끄기(LGPL 유지), 동적링크/별도배포 |
| Kdenlive/Shotcut/OpenShot | **GPLv3** | **코드 차용 금지** — UI/기능 참고만 |

핵심: MIT 제품을 유지하려면 GPL 코드 비차용 + FFmpeg 프로세스 분리가 절대 원칙.

---

## 11. 플랫폼 롤아웃

| 단계 | 플랫폼 | 셸 | 재사용 | 신규 작업 |
|---|---|---|---|---|
| Phase 1 | **macOS** | Electron | — | 전체 MVP, notarization, dmg |
| Phase 2 | **Windows** | Electron | `core`·`ui`·`ai` 100% | Win FFmpeg/whisper 바이너리, 설치관리자, 서명 |
| Phase 3 | **iOS/Android** | RN/Capacitor 또는 Tauri 2 mobile | **`core`(순수 TS) 재사용** | 모바일 UI, 모바일용 STT(whisper.rn 등), 셸 재작성 |

→ Windows는 사실상 무비용. 모바일은 **Layer 1(셸)+UI 적응만** 새로, **Layer 2 코어는 그대로**. (Layer 2를 순수 TS로 격리한 이유.)

---

## 12. 리스크 & 결정 대기 항목

### 리스크
- **R1. Electron 비디오 성능** — 대용량/4K 멀티트랙에서 프리뷰 버벅임 가능. → 프리뷰 해상도 프록시·GPU 합성으로 완화. 한계 도달 시 Phase 3에서 코어 일부 네이티브화 검토.
- **R2. 텍스트 기반 편집 UX 난이도** — 전사↔타임라인 양방향 동기화가 가장 어려운 부분. MVP 핵심이자 최대 리스크.
- **R3. 모바일 셸 재작성** — Electron 선택의 대가. 코어 격리로 완화하나 0은 아님.
- **R4. OpenCut 추격** — 그들이 AI 자막을 붙이면 차별점 축소. → 텍스트 기반 편집 UX 완성도로 선제.

### 결정 대기 (다음 논의)
- [ ] 패키지 매니저: pnpm vs Bun
- [ ] 프리뷰 합성: WebGL vs WebGPU(브라우저/Electron 버전 의존)
- [ ] whisper 런타임: whisper.cpp 바이너리 직접 vs Node 바인딩(`nodejs-whisper` 등)
- [ ] 제품/저장소 명칭 확정 (dawn-cut?)
- [ ] 모델 동봉 정책 & 최소 디스크 요건

---

## 13. 다음 단계
1. 이 설계서 합의/수정
2. MVP 프로젝트 스캐폴딩 (모노레포 + Electron + `core` 골격)
3. 수직 슬라이스 PoC: *영상 import → whisper 자막 → 전사에서 단어 삭제 → 타임라인 반영* (R2 검증)
4. FFmpeg export 파이프라인
5. 알파 dmg → 피드백

> **PoC 자율주행 설계 패키지 → [poc/README.md](poc/README.md)**
> 위 3~4단계를 자율 개발 에이전트가 자동테스트 게이트로 완주하도록 Seed/체크리스트/검증문서로 정밀화함.
