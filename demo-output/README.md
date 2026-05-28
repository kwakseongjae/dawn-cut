# dawn-cut — 실제 미디어 데모 결과

실제 더미 영상(내레이션 23.6초)과 실제 사진 2장(picsum)으로 전 파이프라인을 돌린 결과물입니다.
재현: `pnpm demo:assets && pnpm demo:run && pnpm demo:ui`

## 입력
- `overlays/photo1.jpg`, `overlays/photo2.jpg` — 실제 사진(이미지 첨부 테스트용)
- 원본 영상: `demo/talk.mp4` (23.6s, 6문장 내레이션 + 무음)

## 처리 (실제 whisper.cpp + FFmpeg)
1. 전사: 49단어 (영어) — `transcript.txt`, `transcript.json`
2. 텍스트 편집: 앞 단어 3개 삭제 (23.60s → 22.57s)
3. 자동 무음 제거: 무음 6곳 검출 → 6.30s 컷 → 최종 **17.30s / 7클립**
4. 내보내기

## 출력
| 파일 | 설명 |
|---|---|
| `edited.mp4` | 편집 결과 영상 (자막 트랙 mux 포함) |
| `edited.gif` | 같은 편집의 애니메이션 GIF |
| `subtitles.srt` | program 타임코드 자막 |
| `project.dawn` | 재편집용 프로젝트 파일 |
| `transcript.txt/.json` | 전사 결과 |
| `summary.json` | 수치 요약 |
| `ui-1-imported.png` | 영상 import 직후 GUI |
| `ui-2-overlays.png` | 사진 2장 첨부된 GUI (오버레이 트랙) |
| `ui-3-edited.png` | 단어 삭제 + 무음 제거 후 GUI |

## 메모
- whisper가 "dawn cut"을 "Don Cut"으로 인식(소형 base 모델 한계, 정상).
- 이미지 오버레이는 첨부·표시·타임라인 칩까지 동작하나 **영상 위 합성은 preview**(로드맵).
