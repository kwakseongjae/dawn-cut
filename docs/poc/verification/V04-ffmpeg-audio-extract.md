# V04 — FFmpeg 오디오 추출 (16kHz mono PCM s16le)

> 검증 대상: 게이트 G1 / 체크리스트 1.3
> 관련: [02-CHECKLIST](../02-CHECKLIST.md) · [03-TEST-GATES](../03-TEST-GATES.md) · [04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) · [01-POC-DESIGN](../01-POC-DESIGN.md) §5

## 목적
`media:extractAudio`가 소스 MP4에서 whisper.cpp가 요구하는 정확한 오디오 포맷(16kHz, mono, PCM s16le wav)을 추출하고, 추출 길이가 소스와 ±1 frame 이내로 일치함을 증명한다. 잘못된 샘플레이트/채널은 G2 전사 정확도를 직접 훼손하므로 이 게이트가 STT의 전제 품질을 고정한다.

## 전제조건
- G0 green, 그리고 `fixtures/sample.mp4` 존재(V03 / [05](../05-ENVIRONMENT.md) §4).
- `scripts/setup-binaries.sh` 완료: FFmpeg/ffprobe 설치([05](../05-ENVIRONMENT.md) §2).

## 산출물 (Deliverables)
- `sidecar/ffmpeg`의 extractAudio 래퍼: subprocess로 FFmpeg 호출
  - 출력 포맷 고정: `-ar 16000 -ac 1 -c:a pcm_s16le`(wav).
  - `--enable-gpl` 미사용(LGPL 유지, [00-SEED](../00-SEED.md) CONSTRAINTS 3).
- main IPC 핸들러 `media:extractAudio`([01](../01-POC-DESIGN.md) §5): 입력 `{ path }`(경로 화이트리스트 검증) → 출력 `{ wavPath }`.
- 통합테스트 `tests/integration/extractAudio.spec.ts`:
  - `fixtures/sample.mp4` → wav 추출,
  - 출력 wav를 ffprobe로 검사하여 포맷/길이 단언,
  - probe 결과를 `artifacts/g1-audio-probe.json`에 기록.

## 검증 절차
```bash
# 1) 추출 통합테스트 실행
pnpm verify:int -g "extractAudio"

# 2) 산출 wav를 직접 ffprobe로 검증 (게이트 판정 근거)
ffprobe -v error -show_streams -show_format -of json <추출된 wav> | tee artifacts/g1-audio-probe.json
#   기대: sample_rate=16000, channels=1, codec_name=pcm_s16le

# 3) 소스 길이와 비교
ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 fixtures/sample.mp4
ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 <추출된 wav>
```

## 자동 테스트 게이트
- 명령: `pnpm verify:int -g "extractAudio"`
- PASS 조건(기계 판정):
  - 출력 wav: **sample_rate == 16000**, **channels == 1(mono)**, **codec == PCM s16le** ([03-TEST-GATES](../03-TEST-GATES.md) G1).
  - 길이: `|durationUs(wav) - durationUs(source)| ≤ ±1 frame`. **PoC fps=30 → 1 frame = 33,333µs** ([04-DATA-CONTRACTS](../04-DATA-CONTRACTS.md) §0 허용오차).
  - `artifacts/g1-audio-probe.json` 생성됨.

## 통과 기준 체크
- [x] 출력 wav sample_rate == 16000 Hz
- [x] 출력 wav channels == 1 (mono)
- [x] 출력 wav codec == PCM s16le
- [x] `|durationUs(wav) - durationUs(source)| ≤ 33,333µs` (±1 frame, fps=30) — [04](../04-DATA-CONTRACTS.md) §0
- [x] `pnpm verify:int -g "extractAudio"` 종료코드 0

## 증거 (Evidence)
- [x] `artifacts/g1-audio-probe.json` 생성됨 (출력 wav의 ffprobe 스트림/포맷/길이) — [03](../03-TEST-GATES.md) G1 증거와 일치

## 실패 시 (STOP)
- 환경(ffmpeg) 셋업 실패 → **STOP-2**(임의 우회 금지, 사람 보고).
- 길이 허용오차 ±1 frame(33,333µs)을 느슨하게 바꾸는 것 금지 → **STOP-4**([00-SEED](../00-SEED.md) §SAFETY).
- 같은 게이트 3회 연속 실패 → **STOP-1**.
- 계약([04]) 변경 필요 판단 시 임의 변경 금지 → **STOP-3**.
