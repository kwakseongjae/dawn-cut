// dawn-cut MCP 서버 빌더 — DawnSession을 MCP tool로 감싼다(전송 계층 비의존 → 테스트 가능).
// 외부 AI가 GUI와 동일한 command bus + 불변식 + 감사로그 + dry-run 게이트로 .dawn을 편집한다.
// 흐름(권장): open_project → command_manifest → dry_run(미리보기) → apply(적용) → save_project.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DawnSession } from './session.js';

const json = (v: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }],
});
const fail = (e: unknown) => ({
  content: [
    { type: 'text' as const, text: `ERROR: ${e instanceof Error ? e.message : String(e)}` },
  ],
  isError: true,
});

/** DawnSession을 구동하는 MCP 서버를 만든다(stdio/in-memory 어느 전송에도 connect 가능). */
export function buildServer(session: DawnSession = new DawnSession()): McpServer {
  const server = new McpServer({ name: 'dawn-cut', version: '0.1.0' });

  server.registerTool(
    'open_project',
    {
      description: '.dawn 프로젝트 파일을 연다(검증 포함). 상태 요약과 미디어 경로를 반환.',
      inputSchema: { path: z.string().describe('.dawn 파일 절대경로') },
    },
    ({ path }) => {
      try {
        return json(session.open(path));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'state_summary',
    { description: '현재 편집 상태 요약(길이µs/어절수/cue수/필러수/챕터/자막스타일 유무).' },
    () => {
      try {
        return json(session.summary());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'command_manifest',
    {
      description:
        '사용 가능한 편집 명령(verb)과 각 입력 JSON-Schema. apply/dry_run에 넣을 EditCommand[]의 형식을 여기서 확인하라.',
    },
    () => {
      try {
        return json(session.manifest());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'plan',
    {
      description:
        '자연어 편집 지시를 EditCommand[]로 계획한다(로컬 LLM, 없으면 룰 폴백). 상태 불변(미리보기) — 결과 commands를 검토 후 apply하라. 저수준 명령 대신 "말버릇 빼고 시네마틱하게" 같은 자연어를 위임할 때 쓴다.',
      inputSchema: { instruction: z.string().describe('자연어 편집 지시(한국어)') },
    },
    async ({ instruction }) => {
      try {
        return json(await session.plan(instruction));
      } catch (e) {
        return fail(e);
      }
    },
  );

  const commandsShape = {
    commands: z
      .array(z.record(z.string(), z.unknown()))
      .describe('EditCommand[] (command_manifest 참고)'),
  };

  server.registerTool(
    'dry_run',
    {
      description:
        '명령 묶음을 상태 변경 없이 미리 평가(원자적). ok/길이변화/cue변화/에러를 반환. 항상 apply 전에 호출 권장.',
      inputSchema: commandsShape,
    },
    ({ commands }) => {
      try {
        return json(session.dryRun(commands));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'apply',
    {
      description:
        '명령 묶음을 command bus로 적용(유일한 상태 변경 지점). 각 명령은 감사로그(해시체인)에 남는다. 불변식 위반 시 거부(상태 보존).',
      inputSchema: commandsShape,
    },
    ({ commands }) => {
      try {
        return json(session.apply(commands as Parameters<DawnSession['apply']>[0]));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'save_project',
    {
      description: '현재 상태를 .dawn로 저장(경로 생략 시 열었던 경로).',
      inputSchema: { path: z.string().optional().describe('저장 경로(생략 시 원본)') },
    },
    ({ path }) => {
      try {
        return json(session.save(path));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'audit_log',
    { description: '적용된 편집 명령의 해시체인 감사로그와 검증 결과(재생/감사용).' },
    () => {
      try {
        return json(session.auditLog());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'find_words',
    {
      description:
        "NL 셀렉터(read-only): 전사에서 구절을 찾아 wordId 범위 핸들로 반환. µs/ID를 직접 계산하지 말고 이 결과의 fromWordId/toWordId를 deleteWordRange에 그대로 넣을 것. 예: query='인트로 잡담' → ranges[].",
      inputSchema: {
        query: z.string().min(1).describe('찾을 구절(어절 1개 이상, 조사 변형 흡수)'),
        limit: z.number().int().positive().max(200).optional().describe('최대 결과 수(기본 50)'),
      },
    },
    ({ query, limit }) => {
      try {
        return json({ ranges: session.findWords(query, limit) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'find_silences',
    {
      description:
        'NL 셀렉터(read-only): 발화 공백(무음) 구간을 소스 좌표로 반환(전사 타이밍 기반). 결과 intervals를 removeSilences.silences에 그대로 넣을 것.',
      inputSchema: {
        minMs: z.number().positive().optional().describe('무음 최소 길이 ms(기본 500)'),
      },
    },
    ({ minMs }) => {
      try {
        return json({ intervals: session.findSilences(minMs) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'render',
    {
      description:
        '현재 편집(컷+색보정/줌)을 mp4로 렌더(절대경로 outPath). reframe로 세로 9:16/정사각 1:1 중앙 크롭(쇼츠). 외부 AI 파이프라인의 마지막 단계: open→apply→render. 자막 번인 기본 포함(GUI와 동일 룩) — burnSubtitles:false로 끔.',
      inputSchema: {
        outPath: z.string().describe('출력 mp4 절대경로'),
        reframe: z
          .enum(['source', '9:16', '1:1'])
          .optional()
          .describe('익스포트 종횡비(기본 원본)'),
        burnSubtitles: z
          .boolean()
          .optional()
          .describe('자막 번인 여부(기본 true — GUI 번인과 동일 경로)'),
      },
    },
    async ({ outPath, reframe, burnSubtitles }) => {
      try {
        return json(await session.render(outPath, reframe, { burnSubtitles }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
