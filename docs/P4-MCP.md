# P4 — dawn-cut MCP 서버 (`@dawn-cut/mcp`) 설계

> 비전의 종착점: **외부 AI(Claude Desktop 등)가 dawn-cut을 도구로 직접 조작**해 영상을 편집한다.
> P3가 '로컬 LLM → PlanProvider'로 자연어 편집을 닫았다면, P4는 그 어댑터의 전송 계층을
> **MCP(Model Context Protocol)** 로 바꿔, 임의의 MCP 클라이언트가 dawn-cut의 편집 명령을
> tool로 호출하게 연다. 결정적으로, **GUI·로컬LLM·외부MCP가 전부 같은 command bus
> (`applyCommand`) + 불변식 + 감사로그 + dry-run 게이트**를 공유한다.

---

## 1. 무엇을 하나

`@dawn-cut/mcp`는 stdio MCP 서버다. **헤드리스**로 `.dawn` 프로젝트 파일 위에서 동작한다
(Electron 앱 상태에 붙지 않으므로 어떤 MCP 클라이언트와도 독립적으로 돌아간다).

도구(tool) 표면 = dawn-cut의 편집 능력:

| tool | 역할 | 안전 |
|---|---|---|
| `open_project(path)` | `.dawn` 적재(검증 포함) → 상태 요약·미디어 경로 | 손상 프로젝트는 로드 거부 |
| `state_summary()` | 길이µs/어절수/cue수/필러수/챕터/자막스타일 유무 | 읽기 전용 |
| `command_manifest()` | 9개 verb + 각 입력 JSON-Schema(= `commandManifest()`) | 읽기 전용. AI가 명령 형식을 여기서 발견 |
| `dry_run(commands)` | 상태 변경 없이 원자적 미리보기 → ok/길이변화/cue변화/error | **불변** |
| `apply(commands)` | command bus로 적용 + 해시체인 감사로그 | **유일한 상태 변경 지점**. 불변식 위반 시 거부 |
| `save_project(path?)` | 현재 상태를 `.dawn`로 직렬화 저장 | — |
| `audit_log()` | 적용 명령의 해시체인 + 검증 결과 | 읽기 전용. 재생/감사 |

권장 흐름: `open_project → command_manifest → dry_run(미리보기) → apply(적용) → save_project`.

---

## 2. 아키텍처 — 세 입력, 하나의 command bus

```
   GUI(사람)            로컬 LLM(P3)            외부 MCP 클라이언트(P4)
  store.approvePlan   llmPlanProvider          @dawn-cut/mcp tools
        │                  │                          │ (open/dry_run/apply/save)
        └───────────────┬──┴──────────────────────────┘
                        ▼
        @dawn-cut/core  EditCommand[] (Zod 검증, GBNF/manifest로 형식 보장)
                        ▼
        dryRunCommands (미리보기, 불변)  →  applyCommand (적용, 불변식 post-condition)
                        ▼
        appendAudit (해시체인 감사로그)  →  serialize/render
```

핵심 불변식(P1→P4 일관):
- **상태 변경 지점은 단 하나** — `apply`(MCP) / `approvePlan`(GUI). 도구는 *제안/적용 요청*을 하고,
  실제 변경은 command bus가 불변식 검증과 함께 수행한다.
- **dry_run은 절대 변경하지 않는다** — 외부 AI도 적용 전에 결과를 미리 본다(안전 게이트).
- **감사로그(append-only 해시체인)** — 누가(어느 입력이든) 무엇을 적용했는지 변조 불가 기록.
  `audit_log`의 `verified`가 false면 체인이 깨진 것.
- core는 `electron`/`fs`/`child_process`를 import하지 않는다 — MCP 서버(node)가 fs 경계를 격리.

---

## 3. 패키지 구성

```
apps/mcp/
  src/session.ts      DawnSession — 전송 비의존 편집 세션(open/summary/manifest/dryRun/apply/save/auditLog).
                      SDK 없이 직접 테스트 가능. 상태 변경은 apply 하나.
  src/mcp-server.ts   buildServer(session) — DawnSession을 MCP tool로 등록(@modelcontextprotocol/sdk).
                      어느 전송(stdio/in-memory)에도 connect 가능.
  src/index.ts        stdio 엔트리(#!/usr/bin/env node) — buildServer + StdioServerTransport.
```

테스트: `session.test.ts`(세션 로직 — open→dry_run→apply→save, 감사체인 검증) +
`mcp-server.test.ts`(**실제 MCP 프로토콜 왕복** — Client ↔ InMemoryTransport ↔ buildServer로
tools/list·tools/call). 서브프로세스 없이 결정적.

---

## 4. Claude Desktop 등에 연결

MCP 클라이언트 설정(예: Claude Desktop `claude_desktop_config.json`)에 stdio 서버로 등록한다.
현재 엔트리는 TS이므로 TS 런타임으로 띄운다(또는 빌드 후 JS 경로 지정):

```json
{
  "mcpServers": {
    "dawn-cut": {
      "command": "npx",
      "args": ["tsx", "/abs/path/dawn-cut/apps/mcp/src/index.ts"]
    }
  }
}
```

연결되면 클라이언트의 AI가 `open_project`로 `.dawn`을 열고, `command_manifest`로 명령 형식을
파악한 뒤 `dry_run`으로 미리보고 `apply`로 적용한 다음 `save_project`한다 — 전부 GUI와 같은
안전 파이프라인 위에서.

> 주의(MVP 범위): 현재 MCP 서버는 **`.dawn` 프로젝트 파일** 위에서 동작한다(헤드리스). 실행 중인
> Electron 편집기의 라이브 상태를 직접 조작하는 브리지(앱↔MCP)는 후속 작업이다. export(렌더)
> 도구도 후속(ffmpeg 사이드카 연결)으로 둔다 — 지금은 편집→저장까지가 표면.

---

## 5. P3와의 관계 / 다음

- **P3(로컬 LLM)** = '자연어 → PlanProvider → 같은 command bus'를 로컬에서 닫았다.
- **P4(MCP)** = 그 command bus를 외부 지능에 tool로 개방했다. `commandManifest()`(MCP tool 표면과
  1:1)와 `dry_run/apply` 게이트가 P3에서 이미 정돈돼 있었기에, P4는 전송 계층(stdio/in-memory)만
  얹으면 됐다.
- 다음 후보: (a) 앱↔MCP 라이브 상태 브리지(실행 중 편집기를 조작), (b) `render`/`export` tool
  (ffmpeg 사이드카), (c) `plan` tool(서버 측에서 자연어→commands를 P3 LLM으로) — 외부 AI가
  저수준 명령 대신 자연어로 위임.
```
