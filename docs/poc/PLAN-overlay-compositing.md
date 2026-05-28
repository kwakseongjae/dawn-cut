# 계획서 — 이미지/스티커 실제 합성 (Overlay Compositing)

> 목표: 현재 "preview"(첨부·표시만)인 이미지/스티커 오버레이를 **실제로 영상에 합성**해 export까지.
> 원칙 유지: 코어는 순수 TS(플랫폼 무관), FFmpeg는 subprocess, 모든 게이트는 자동 테스트.
> 작성: 2026-05-27

## 1. 레퍼런스
- **FFmpeg overlay 필터** — `[ov]scale=w:-1[s];[base][s]overlay=X:Y:enable='between(t,start,end)'`. `t`는 출력(=program) 타임라인 초. 위치 X/Y는 픽셀/표현식, 시간범위는 `between`. ([abyssale](https://www.abyssale.com/blog/ffmpeg-overlay-image-on-video), [bannerbear](https://www.bannerbear.com/blog/how-to-add-a-png-overlay-on-a-video-using-ffmpeg/))
- **에디터 오버레이 모델** — 정규화 좌표 + scale·opacity(%) + 시간범위, 고급은 keyframe(position/scale/rotation/opacity). CapCut/FCP/Motion 공통. ([capcut keyframes](https://www.capcut.com/resource/fcp-keyframes))
- 우리 선택: **정규화 좌표(0..1, top-left 원점) + scale(프레임 폭 대비 비율) + opacity + program 시간범위**. 키프레임/회전은 후속.

## 2. 핵심 설계 — "프리뷰=익스포트 동등성"
오버레이 좌표는 **정규화(0..1)** 단일 소스. 프리뷰(CSS)와 익스포트(FFmpeg)가 **같은 매핑**을 쓴다.
- 픽셀 변환: `xPx = round(x * frameW)`, `yPx = round(y * frameH)`, `wPx = round(scale * frameW)`(높이 비율 유지 `-1`).
- 시간: program µs → `between(t, startUs/1e6, endUs/1e6)`.
- 이래야 "에디터에서 본 위치 == 내보낸 영상의 위치".

## 3. 데이터 계약 (04에 추가 — OverlayClip)
```ts
interface OverlayClip {
  id: string;
  kind: 'image' | 'sticker' | 'gif';
  src: string;            // 파일 경로(이미지/gif) 또는 래스터화된 PNG 경로(스티커)
  x: number; y: number;   // 정규화 top-left, 0..1
  scale: number;          // 0..1 (프레임 폭 대비 오버레이 폭)
  opacity: number;        // 0..1
  startUs: number;        // program 시작
  endUs: number;          // program 끝 (기본 = durationProgram = 전체)
  z: number;              // 스택 순서(작을수록 아래)
}
```
### 불변식 (OVL-INV)
- OVL-INV-1: `x,y ∈ [0,1]`, `scale ∈ (0,1]`, `opacity ∈ [0,1]`.
- OVL-INV-2: `0 ≤ startUs < endUs ≤ durationProgram`.
- OVL-INV-3: 합성 후 출력 영상 길이 == EDL.totalDuration ±1frame (오버레이는 길이 불변).

## 4. 아키텍처 / 모듈
```
core/overlay.ts (순수)
  · buildOverlayFilter(baseLabel, overlays, frameW, frameH): { inputs: string[]; filter: string; out: string }
    - inputs: 오버레이 src 경로 배열(ffmpeg -i 순서)
    - filter: scale + overlay 체인 (z 오름차순), enable=between
    - out: 최종 비디오 라벨([vout])
  · validateOverlays(overlays, durationProgram): string[]  // OVL-INV
sidecar/ffmpeg renderEdl(edl, out, { overlays, frameW, frameH, subtitlesPath, format })
  · concat→[v] 뒤에 buildOverlayFilter로 [v]→[vout], -i 오버레이 추가, map [vout]
ui (preview = CSS 합성)
  · <OverlayLayer>: video-frame 위에 절대배치 <img>, 정규화 좌표·opacity, 플레이헤드 ∈ [start,end]일 때만 표시
  · 선택/이동(드래그)/크기(슬라이더 또는 핸들)/타이밍/opacity 컨트롤
스티커: 렌더러 canvas로 emoji→PNG 래스터화(폰트 의존 회피) → image 오버레이와 동일 취급
```

## 5. 테스트 전략 (게이트)
- **G14.1 core**: `buildOverlayFilter` 필터 문자열 정확성(스케일/위치/enable/z순서) + OVL-INV 단위테스트.
- **G14.2 sidecar(실제 합성 증명)**: 빨강 200×200 PNG를 top-left 전체구간 합성 → 렌더 → **프레임 픽셀 검증**(좌상단 crop→1×1 평균색 추출→R 높고 G/B 낮음). "정말 합성됨"을 기계 검증. 출력 길이 ±1frame.
- **G14.3 preview**: OverlayLayer가 플레이헤드 시간범위에서만 렌더(컴포넌트 테스트, 정규화→px 매핑 일치).
- **G14.4 UI**: 오버레이 선택/위치프리셋/scale/opacity/타이밍 → store 갱신, e2e 스모크.
- **G14.5 스티커**: emoji→PNG 래스터화 후 동일 합성 경로로 검증.
- **G14.6 e2e+demo**: demo 영상에 사진 1장 실제 합성→export, demo-output에 합성된 mp4/프레임 캡처.

## 6. 단계별 체크리스트
- [x] 14.1 `core/overlay.ts` + 단위테스트 (필터 빌더 + OVL-INV) — 6 tests green
- [x] 14.2 `renderEdl` 오버레이 지원 + **픽셀검증 통합테스트** (★실제 합성 증명) — `artifacts/g14-overlay.mp4`, 좌상단 RED 검증
- [x] 14.3 프리뷰 CSS 합성(OverlayLayer) + 시간범위 게이팅 — 정규화 좌표(프리뷰=익스포트 동일)
- [x] 14.3b export 배선: store overlays→OverlayClip, probe width/height, exportTo/exportVideo 합성 (드래그앤드롭/패널 이미지가 실제 export 합성)
- [x] 14.4 UI 수동 배치 — **드래그 이동 + 리사이즈 핸들 + scale/opacity/start/end 슬라이더**. 코어 `placement.ts`(moveOverlay/resizeOverlay/clampRange) 단위테스트 + e2e(드래그→x변경, 핸들→scale변경) `artifacts/g15-placement.png`
- [x] 14.5 스티커 emoji→PNG 래스터화(canvas) → 합성 — IPC `asset:writeImage`, GUI에서 클릭→PNG→이미지 오버레이와 동일 합성. trending GIF는 텍스트 배지 PNG로. 검증: `demo-output/ui-export-frame.png`(🔥·💯 + 사진 2장 실제 export 합성)
- [x] 14.6 demo 합성 결과물 — `edited-overlay.mp4`, `overlay-frame.png`(사진), `ui-export.mp4`/`ui-export-frame.png`(GUI 경로 사진+스티커)

> **이미지+스티커 실제 합성 완료.** 남은 것: 수동 배치 UI(드래그/슬라이더, 14.4), GIF 애니메이션 오버레이.

## 7. 리스크 & 대응
- **GIF 오버레이(애니메이션)**: 정지 이미지보다 복잡(`-ignore_loop 0` + movie 필터). 1차는 이미지/스티커 정지부터, GIF 애니 오버레이는 14.x 후속.
- **emoji 폰트 부재**(libfreetype/drawtext 없음): drawtext 대신 **renderer canvas 래스터화→PNG**로 회피(검증됨한 접근).
- **프리뷰/익스포트 좌표 불일치**: 단일 정규화 계약 + 동일 매핑 함수(core)로 강제, G14.2/G14.3에서 교차검증.
- **성능(다수 오버레이)**: PoC는 소수. overlay 체인은 선형; 문제 시 단일 filtergraph 유지.

## 8. 수용 기준 (Done)
`pnpm verify` green + G14.2 픽셀검증 통과(이미지가 실제 프레임에 존재) + demo-output에 **합성된** edited.mp4 + 프리뷰/익스포트 위치 일치.

## 9. 비범위(후속)
~~키프레임 애니메이션, 회전~~ → **완료**. 블렌드 모드, 추가 베지어 보간만 남음.

## 10. 한계 극복 (G18~G20, 2026-05-28)
| 한계 | 해결 |
|---|---|
| canvas 래스터화가 렌더러 전용(headless 검증 불가) | `@napi-rs/canvas` + 코어 `draw.ts`(DrawCtx 인터페이스로 DOM과 node 공용 프리미티브) → **G18** 픽셀 검증(자막 바 + 🔥 이모지 합성, 영역별 RGB 확인) |
| 키프레임 없음 | `OverlayClip.to`(x/y/scale) + ffmpeg `eval=frame` 표현식 보간 → **G19** 시점별 픽셀 위치 확인(왼→오 이동) |
| 회전 없음 | `OverlayClip.rotation`(deg) + `rotate=rad:c=none:ow=rotw:oh=roth` → **G20** 가로 바 90° → 세로로 픽셀 확인 |
| GIF 무한루프 hang | `-shortest`(GIF overlay 있을 때만, 자막 트랙 길이엔 영향 없음) |
| 자막 번인 (libass/drawtext 부재) | cue → PNG 래스터화 → 동일 오버레이 경로로 합성 (canvas는 G18로 헤드리스화) |
