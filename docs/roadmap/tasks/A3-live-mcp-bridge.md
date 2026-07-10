# A3 — 앱↔MCP 라이브 브리지

- **이슈**: 신규 (README.ko.md "앱↔MCP 라이브 브리지" 미완 항목)
- **의존**: A1

## 목표

실행 중인 GUI 앱에 외부 에이전트(Claude Code/Desktop, Cursor 등)가 MCP로 접속해 **열려 있는 프로젝트**를 편집한다. 변경은 GUI 승인 카드를 경유해 실시간 반영된다.

## 왜

Palmier 파리티의 핵심(`localhost:19789/mcp`). 현재 우리 MCP는 .dawn 파일 헤드리스 전용이라 "앱을 보면서 에이전트와 편집"이 불가. 이게 되면 시연 임팩트가 가장 큼.

## 완료 조건 (AC)

- [ ] 앱 실행 시 main 프로세스에 localhost MCP 엔드포인트(Streamable HTTP, 고정 포트 — 예: 19790) — 설정으로 on/off
- [ ] 기존 11툴이 라이브 세션에서 동작: state_summary/plan/dry_run/find_words 등 read-only는 즉시, **apply는 GUI 승인 카드에 제안으로 적재**(사용자 승인 시 적용, 응답으로 승인/거부 반환)
- [ ] 설정에 '자동 승인' 토글(기본 off) — 켜면 apply 즉시 적용(감사로그는 항상)
- [ ] 외부 클라이언트(Claude Code) 접속 → "무음 빼줘" → GUI 카드 승인 → 타임라인 반영 시나리오 캡쳐
- [ ] 렌더러·main 사이 상태 동기화: 세션의 진실은 렌더러 store — main은 IPC로 프록시(상태 이중화 금지)
- [ ] 검증 체인 그린 + 통합 테스트(HTTP로 tools/list, dry_run)

## 설계 가이드

| 파일 | 역할/변경점 |
|------|-------------|
| `apps/mcp/src/mcp-server.ts` | buildServer 재사용 — transport만 stdio→Streamable HTTP 추가 분리 |
| `apps/mcp/src/session.ts` | DawnSession 인터페이스 추출 → `FileSession`(기존) / `LiveSession`(IPC 프록시) 2구현 |
| `apps/desktop/src/main/index.ts` | whenReady에서 HTTP MCP 기동(설정 게이트), 렌더러와 `mcp:proposal`/`mcp:state` IPC 채널 |
| `packages/ui/src/store.ts` | 외부 제안 수신 → 기존 plan-card 큐에 적재(approvePlan 재사용, source: 'mcp' 표기) |

**지켜야 할 불변**: 키 원문 비노출(MCP 응답에 설정 내용 금지). apply 경로는 승인 카드/감사로그 통과. 로컬호스트 바인드만(외부 인터페이스 금지) — 임의 원격 접속 차단.

## 검증 방법

```bash
pnpm lint && pnpm test:unit && pnpm test:int && pnpm test:e2e
# 라이브: 앱 켜고 curl로 tools/list 확인 → Claude Code에 mcp add 후 실시나리오 캡쳐
```

## 진행 저널 (append-only)
