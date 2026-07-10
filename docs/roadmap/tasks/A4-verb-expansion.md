# A4 — 동사 확장 1차 (14→22+)

- **이슈**: #2 잔여 + #18 선행
- **의존**: 없음 (A1~A3과 병행 가능)

## 목표

렌더 엔진이 **이미 할 수 있는** 능력(오버레이/보이스오버/수기자막/배경/자막 위치)을 EditCommand 동사로 승격해, 플래너와 MCP가 "말할 수 있는 것"을 넓힌다. 엔진 신기능 없음 — 순수 버스 어휘 작업.

## 왜

Palmier 에이전트 도구 49개 vs 우리 14개(플래너 노출 7개). 에이전트가 오버레이·텍스트·보이스를 못 말하면 바이브 편집이 "컷 전용"에 머묾. 신뢰 구조(dry-run/불변식)를 그대로 태우는 게 조건.

## 완료 조건 (AC)

- [ ] 신규 동사(각각 Zod 스키마 1개 = 단일 진실원천): `addOverlay`(kind/src/배치/타이밍/키프레임), `updateOverlay`, `removeOverlay`, `addVoiceover`(대본/보이스/스타일/시작 — TTS 합성은 사이드카 IO로 분리, 동사는 결과 배치만), `addManualCue`(텍스트/타이밍/앵커), `addBroll`(카탈로그 id → 배경 교체·구간 배치), `setSubtitlePos`
- [ ] EditorState 확장: overlays/ttsClips/manualCues가 커맨드 대상이 되도록(스토어 로직을 코어 reducer로 이전 — 기존 스토어 액션은 dispatch 래퍼화)
- [ ] dry-run diff가 신규 동사를 설명 가능(추가/변경 요약)
- [ ] plannerManifest 노출 확대(7→안전한 만큼) + few-shot 갱신 — 카탈로그 밖 src 거부(에셋은 번들 카탈로그 id 또는 사용자 미디어만)
- [ ] MCP command_manifest에 자동 반영 확인
- [ ] 단위(스키마·reducer·불변식) + 플래너 통합(자연어→신규 동사 계획) 테스트
- [ ] 검증 체인 그린

## 설계 가이드

| 파일 | 역할/변경점 |
|------|-------------|
| `packages/core/src/edit-command.ts` | 스키마 + union + dispatcher case (14→22+). `EditorState`에 overlays 등 편입 |
| `packages/core/src/overlay.ts`, `types.ts` | OverlayClip 모델 재사용 — 검증은 validateOverlays 게이트에 연결 |
| `packages/ui/src/store.ts` | addImageOverlay/updateOverlay/generateVoiceover/addManualCue 등을 applyCommand 디스패치로 전환(사람=에이전트 동일 버스) — ★인터페이스/구현 anchor 중복 주의(구현부는 useEditor 이후 탐색) |
| `packages/core/src/planner.ts:39-57` | PLANNER_VERBS 확대 + few-shot. 에셋 id 카탈로그 주입(모션 스티커 12종 + broll 6종) |

**지켜야 할 불변**: 동사는 결정적(IO 없음 — TTS/파일 복사는 동사 밖 사이드카, 동사는 결과 반영만). 적용 후 validateState 게이트. 스키마→z.infer/manifest 파생 패턴 유지.

## 검증 방법

```bash
pnpm lint && pnpm boundary && pnpm test:unit && pnpm test:int && pnpm test:e2e
npx tsx scripts/demo-cloud-planner.ts   # 신규 동사 플래닝 실측
```

## 진행 저널 (append-only)
