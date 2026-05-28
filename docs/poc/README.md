# dawn-cut PoC 패키지 — 자율주행 설계 인덱스

> 목적: 자율 개발 에이전트가 **dawn-cut PoC 수직 슬라이스**(영상→자막→텍스트 컷→무음 제거→export)를
> 프레임워크 무관하게 자율 완성하고, 사람이 **자동테스트 게이트**로 검증할 수 있게 한다.
>
> 상위 설계: [../ARCHITECTURE.md](../ARCHITECTURE.md)

> ✅ **최종 검증 완료** — DoD 감사 결과: [FINAL-VERIFICATION.md](FINAL-VERIFICATION.md)

## 읽는 순서
| # | 문서 | 역할 |
|---|---|---|
| 0 | [00-SEED.md](00-SEED.md) | 자율주행 goal/seed (도구 무관). GOAL·CONSTRAINTS·ACCEPTANCE·SAFETY·DONE |
| 1 | [01-POC-DESIGN.md](01-POC-DESIGN.md) | PoC 상세 설계: 가설(H1~H5), 수직 슬라이스, 모듈, 알고리즘 |
| 2 | [02-CHECKLIST.md](02-CHECKLIST.md) | G0~G8 마일스톤 게이트 체크리스트 (작업 순서) |
| 3 | [03-TEST-GATES.md](03-TEST-GATES.md) | 게이트별 자동테스트 명령 + 기계 판정 + DoD |
| 4 | [04-DATA-CONTRACTS.md](04-DATA-CONTRACTS.md) | ★ 단일 진실 원천: 모델·불변식·허용오차 |
| 5 | [05-ENVIRONMENT.md](05-ENVIRONMENT.md) | whisper.cpp/FFmpeg 로컬 셋업 + 결정적 fixture |

## 검증 문서 (체크리스트 항목별)
| 게이트 | 검증 문서 |
|---|---|
| G0 Foundation | [V01 모노레포](verification/V01-monorepo-bootstrap.md) · [V02 Electron 셸](verification/V02-electron-shell.md) |
| G1 Ingest | [V03 import](verification/V03-media-import.md) · [V04 오디오 추출](verification/V04-ffmpeg-audio-extract.md) |
| G2 STT | [V05 whisper 전사](verification/V05-whisper-transcribe.md) |
| G3 Core Models | [V06 전사모델](verification/V06-transcript-model.md) · [V07 타임라인모델](verification/V07-timeline-model.md) · [V08 동기화](verification/V08-transcript-timeline-sync.md) |
| G4 ★텍스트 컷(R2) | [V09 deleteWordRange](verification/V09-text-based-cut.md) |
| G5 Silence | [V10 무음 제거](verification/V10-silence-detect.md) |
| G6 Preview | [V11 프리뷰](verification/V11-preview-playback.md) |
| G7 Export | [V12 FFmpeg export](verification/V12-export-ffmpeg.md) |
| G8 E2E (DoD) | [V13 E2E 슬라이스](verification/V13-e2e-vertical-slice.md) |
| G9 Auto Subtitles | [V14 자막 export](verification/V14-subtitles-export.md) |
| G10 Project Save/Open | [V15 프로젝트 저장](verification/V15-project-save-open.md) |
| G11 Undo/Redo | [V16 undo/redo](verification/V16-undo-redo.md) |

## 자율주행 한 줄 요약
> **00-SEED + 02/03/04/05 + verification/\*** 를 컨텍스트로 주입 → 02-CHECKLIST 순서대로 →
> 판정은 03-TEST-GATES 명령 → `pnpm verify` 종료코드 0 + artifacts 전부 생성 = **PoC 완료**.
> 막히면 00-SEED §SAFETY STOP 규칙. 게이트를 약화시키지 말 것(STOP-4).

## PoC가 끝나면 (North-Star)
R2(텍스트 기반 편집)가 증명되면 = OpenCut에 없는 해자 + 순수 TS 코어로 Windows/모바일 확장 경로 확보.
이후 로드맵은 [../ARCHITECTURE.md](../ARCHITECTURE.md) §4.2 / §11. **자동게이트 문화를 그대로 확장**해 품질로 OpenScreen/OpenCut을 넘는다.
