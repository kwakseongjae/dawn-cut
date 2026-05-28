# 01 — PoC 상세 설계 (Vertical Slice)

> 목표: **클릭 가능한 Electron 앱**에서 dawn-cut의 핵심 가설을 끝까지(import→자막→텍스트편집→무음제거→export) 한 번 관통시켜, 가장 비싼 리스크(R2: 전사↔타임라인 동기화)를 실증한다.
> 이 PoC가 통과하면 "OpenCut이 비운 텍스트 기반 편집"이 기술적으로 성립함을 증명한 것.
>
> 관련: [ARCHITECTURE](../ARCHITECTURE.md) · [04-DATA-CONTRACTS](04-DATA-CONTRACTS.md) · [02-CHECKLIST](02-CHECKLIST.md) · [03-TEST-GATES](03-TEST-GATES.md)

---

## 1. PoC가 증명/반증하는 가설

| # | 가설 | 통과 판정 |
|---|---|---|
| H1 (R2) | 전사에서 단어를 지우면 타임라인이 리플 컷되고, 양방향 매핑이 깨지지 않는다 | SYNC-INV/CMD-INV 자동테스트 green + E2E에서 단어삭제→길이감소 |
| H2 | whisper.cpp 로컬 STT가 단어 타임스탬프를 실용 정확도로 낸다 | 결정적 fixture에서 알려진 단어 ≥90% 포함, 타임스탬프 단조 |
| H3 | FFmpeg subprocess로 EDL→MP4 정확 길이로 렌더된다 | EDL-INV-3 (±1 frame) |
| H4 | 무음 자동 검출→컷이 동작한다 | 알려진 무음구간 검출 + 컷 후 길이 일치 |
| H5 | Electron에서 위 전부를 클릭으로 수행 가능 | Playwright E2E green |

**PoC는 H1~H5의 자동 검증이 전부 green이면 완료**(DoD는 [03-TEST-GATES](03-TEST-GATES.md)).

---

## 2. 비범위 (PoC에서 의도적으로 뺀 것)
- 다중 트랙/다중 소스, 트랜지션·이펙트·키프레임, 자막 스타일링 UI, TTS·번역.
- 자동업데이트·코드사이닝·notarization(배포). 성능 최적화(프록시/4K).
- 예쁜 디자인. (UI는 기능 검증용 최소)

> 단, **데이터 계약(04)은 다중 대비로 설계** — PoC는 단일 트랙만 쓰지만 모델은 확장 가능해야 한다.

---

## 3. 수직 슬라이스 사용자 흐름 (클릭 경로)

```
[앱 실행]
  └─ 창 렌더, "Import" 버튼
[Import 클릭 → 파일선택(fixture.mp4)]
  └─ main: FFmpeg 오디오 추출(16k mono wav)
  └─ main: whisper.cpp 전사 → words.json
  └─ renderer: TranscriptModel 구성 + TimelineModel 초기화(통클립 1개)
[전사 패널] 단어 토큰들 표시 / [타임라인] 클립 블록 1개 / [프리뷰] 재생
[전사에서 단어 드래그 선택 → Delete]
  └─ core: deleteWordRange 명령 → 리플 컷
  └─ 타임라인 짧아짐, 삭제 단어 취소선, 프리뷰 컷 반영
["Remove silences" 클릭]
  └─ core: removeSilences 명령(FFmpeg silencedetect 결과 기반)
[Export 클릭 → 저장경로]
  └─ core: TimelineModel → EDL
  └─ main: FFmpeg가 EDL대로 MP4 렌더
  └─ 완료 토스트 + 출력 길이 표시
```

---

## 4. 프로세스/모듈 매핑 (3-레이어 구체화)

```
┌─ Electron renderer (React) ─────────────────────┐
│  packages/ui                                     │
│   · <ImportButton> <TranscriptPanel>             │
│   · <Timeline> <PreviewPlayer> <ExportButton>    │
│  packages/core  (순수 TS, Electron 비의존) ★      │
│   · timeline/  (TimelineModel, 명령, undo)        │
│   · transcript/ (TranscriptModel, SyncMap)        │
│   · render/     (TimelineModel→EDL)               │
│   · project/    (.dawn 직렬화)                    │
└──────────────── IPC (typed, contextBridge) ──────┘
            │ invoke('media:extractAudio')
            │ invoke('stt:transcribe')
            │ invoke('analyze:silence')
            │ invoke('export:render')
┌─ Electron main (Node) ───────────────────────────┐
│  apps/desktop/main                                │
│   · ipc 핸들러 (입력검증 → sidecar 호출)           │
│  sidecar/ffmpeg  (FFmpeg subprocess 래퍼)         │
│  sidecar/stt     (whisper.cpp subprocess 래퍼)    │
└──────────────────────────────────────────────────┘
```

### 레이어 경계 계약 (어기면 실패)
- `packages/core`는 `electron`·`fs`·`child_process`를 **import 금지**. 파일/프로세스 접근은 인터페이스로 주입받음. → 이래야 모바일 재사용 가능(아키텍처 G4 원칙). [V07] 테스트로 강제.
- renderer↔main은 **typed IPC 채널만** 사용(contextBridge, `nodeIntegration: false`, `contextIsolation: true`).

---

## 5. IPC 계약 (renderer ↔ main)

| 채널 | 입력 | 출력 | 비고 |
|---|---|---|---|
| `media:probe` | `{path}` | `{durationUs, fps, hasAudio}` | ffprobe |
| `media:extractAudio` | `{path}` | `{wavPath}` | 16kHz mono PCM wav |
| `stt:transcribe` | `{wavPath, lang?}` | `WhisperWordsJson` | whisper.cpp |
| `analyze:silence` | `{path, noiseDb, minSilenceUs}` | `{silences: [{start,end}]}` | silencedetect |
| `export:render` | `{edl: Edl, outPath}` | `{outPath, actualDurationUs}` | FFmpeg concat/trim |

모든 채널: 입력 경로 화이트리스트 검증, 출력은 zod 등으로 런타임 스키마 검증.

---

## 6. 핵심 알고리즘 — deleteWordRange (R2)

```
입력: fromWordId, toWordId (transcript.order 상 from ≤ to)
1. 범위 단어들의 source 구간 합치기:
   srcCut = union([w.sourceStart, w.sourceEnd) for w in range)  // 보통 연속 → [a, b)
2. 현재 타임라인에서 mediaId 일치하는 클립 c 중 [a,b)를 포함하는 클립 찾기
3. c 를 최대 3조각으로 분할:
     left  = [c.sourceStart, a)
     (gap  = [a, b)  ← 제거 대상)
     right = [b, c.sourceEnd)
4. left, right 만 남기고 right.timelineStart 를 left 끝으로 당김 (ripple)
5. 뒤따르는 모든 클립 timelineStart -= (b-a)
6. durationProgram 재계산, 모든 불변식 재검증(assert)
```
경계: 단어 구간이 클립 경계와 안 맞을 때는 프레임 경계로 스냅(±1 frame). 빈 left/right는 생성 안 함.

---

## 7. 기술 스택 (PoC 확정값)
- Electron + electron-vite, React + TypeScript, Zustand(상태), Vitest(단위/통합), Playwright(Electron E2E).
- 패키지매니저: **pnpm** (workspaces), Turbo 선택.
- 외부 바이너리: **whisper.cpp**(빌드 또는 release 바이너리) + 모델 `ggml-base` , **FFmpeg/ffprobe**. → 셋업 [05-ENVIRONMENT](05-ENVIRONMENT.md).
- 런타임 스키마 검증: zod.

> 결정 근거는 ARCHITECTURE §6/§12. pnpm·whisper.cpp 직접바이너리·WebGL 보류(프리뷰는 HTML5 video + EDL 순차재생으로 PoC 단순화)는 본 PoC에서 확정.

---

## 8. 프리뷰 단순화 (PoC 한정)
실시간 GPU 합성 대신, **HTML5 `<video>` 1개 + EDL 세그먼트 순차 재생**(currentTime 점프)으로 컷 결과를 "재생되는 것처럼" 보여준다. 진짜 합성 렌더는 Export(FFmpeg)가 담당. → 프리뷰 정확도는 "컷 구간을 건너뛰는가"만 검증(H1 보조).

---

## 9. 디렉터리 (PoC 산출 결과물 트리)
```
dawn-cut/
├── apps/desktop/{main,preload,renderer}
├── packages/{core,ui}
├── sidecar/{ffmpeg,stt}
├── fixtures/            # 결정적 테스트 자산 (05 참조)
├── tests/{unit,integration,e2e}
├── scripts/{setup-binaries.sh, make-fixture.sh, verify.sh}
└── docs/poc/...
```

---

## 10. 리스크별 완화가 PoC의 어디서 검증되나
| 리스크(ARCHITECTURE §12) | PoC 검증 위치 |
|---|---|
| R2 전사↔타임라인 동기화 | [V08](verification/V08-transcript-timeline-sync.md), [V09](verification/V09-text-based-cut.md) |
| R1 Electron 비디오 성능 | PoC 범위 밖(통클립 1개). 단 export 시간만 측정·기록 |
| 코어 포터빌리티 | [V07] 경계 테스트(core가 electron 비의존) |
| 결과 신뢰성 | 결정적 fixture(05) + ±1frame 허용오차 |
