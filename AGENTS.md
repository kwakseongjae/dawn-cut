# dawn-cut — 에이전트 작업 프로토콜

어떤 AI 도구(Claude Code, Codex/GPT, Cursor, Gemini …)로 이 리포를 열어도 **이 파일이 진입점**이다.

**프로젝트**: 로컬 우선 AI 비디오 에디터(Electron+React, 순수 TS 편집 코어, ffmpeg/whisper 사이드카, Mac 우선).
**철학**: "신뢰할 수 있는 바이브 편집" — 모든 편집은 EditCommand 버스 → dry-run diff → 승인 → 해시체인 감사. 영상은 기기를 떠나지 않는다.

## 세션 연속성 프로토콜

- **시작**: `bash scripts/context_restore.sh` 실행(또는 `docs/roadmap/STATUS.md` 체크포인트 읽기) → 막힘/대기 항목부터 처리.
- **체크포인트**: 작업 단위 완료·결정 확정마다 `STATUS.md` 체크포인트와 작업 패킷 저널을 **먼저 갱신하고 나서** 보고한다. 채팅에만 있는 맥락은 잃어버린 것으로 간주.
- **종료**: `docs/roadmap/JOURNAL.md` 맨 위에 항목 추가(한 일/열린 것/다음, 5줄 이내).
- **컨텍스트가 요약(compact)된 채 재개되면**: 첫 행동으로 `context_restore.sh`를 실행해 복원한다.

## 로드맵 파이프라인 (정본 위치 — 이중화 금지)

| 무엇 | 어디 | 성격 |
|---|---|---|
| 계획 (작업 ID·AC) | `docs/roadmap/ROADMAP.md` | ID 불변, 상태 없음 |
| 진행 (체크포인트+원장) | `docs/roadmap/STATUS.md` | **유일한 상태 정본** |
| 작업 맥락 (목표/설계/저널) | `docs/roadmap/tasks/<ID>-*.md` | 착수 시 `_TEMPLATE.md`로 생성 |
| 세션 로그 | `docs/roadmap/JOURNAL.md` | append-only |
| 전략 근거 | `docs/VIBE-EDITING-ROADMAP.md` | 경쟁 분석·왜 |

**작업 루프**: 착수(체크포인트+원장 `doing`) → 진행(패킷 저널 append — compact가 언제 와도 안전하게) → 검증(패킷의 명령) → 완료(원장 `done`+커밋 해시, 체크포인트를 다음 작업으로).

## 불변 규약 (위반 금지)

1. **모든 편집 기능은 EditCommand 버스 경유** — verb당 Zod 스키마 1개(단일 진실원천), 적용 후 불변식 게이트. GUI와 에이전트는 같은 버스.
2. **승인 전 상태 불변** — `approvePlan`/`apply`만 상태를 바꾼다. **조용한 폴백 금지** — 실패는 명시적 에러로.
3. **BYOK 키 원문은 main 프로세스 `userData/settings.json`에만.** 렌더러·로그·git·MCP 응답에 절대 노출 금지. 사용자 dotfile/셸 프로파일에서 자격증명 탐색 금지.
4. **미디어 로컬 보장**: 클라우드로 나가는 건 TTS 원고·대본 요약 텍스트뿐. 영상·오디오 업로드 금지(제품 핵심 약속).
5. **검증 체인 그린이 커밋 조건**: `pnpm lint && pnpm test:unit && pnpm test:int && pnpm test:e2e && npx playwright test --config playwright.qa.config.ts`
6. **버전 정책**: 기능 사이클 커밋 시 patch만 증가(minor는 사용자 요청 시). docs-only 커밋은 범프 없음.
7. **실증 원칙**: 실제 외부 미디어로 테스트, 결과는 `output/`에 아카이브, 실행 캡쳐로 시각 검증.
8. **앱 실행**: 이전 인스턴스 `pkill` 후 start.
9. **멀티 '주'트랙 도입 금지**(전사↔타임라인 SYNC-INV = 모트) — 부속 레이어는 오버레이 모델의 연장으로만.

## 도구 함정 (실측 누적 — 시간 아끼기)

- **멀티라인 커밋**: compound 명령 안의 `-m`/heredoc은 조용히 실패 → `printf '%s\n' … > /tmp/cmsg.txt && git commit -F /tmp/cmsg.txt`, 커밋 후 `git log` 확인.
- **biome 포매터**가 객체 리터럴을 개행 분리 → 멀티라인 문자열 치환이 조용히 no-op — 편집 후 반드시 grep으로 적용 확인.
- `packages/ui/src/store.ts`는 인터페이스/구현 양쪽에 같은 anchor 문자열 존재 — 구현부는 `useEditor` 이후에서 탐색.
- CI에서 whisper는 `DAWN_WHISPER_NO_GPU=1` **잡 레벨** 필수(가상화 Metal 오염 — 고신뢰 환각 `*Rain*` 유형).
- core에 이징 추가 시 `packages/ui/src/store.ts`의 Overlay 키프레임 유니언 2곳도 갱신(TS2345).
