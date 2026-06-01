#!/usr/bin/env node
// dawn-cut MCP 서버 stdio 엔트리. 외부 AI(Claude Desktop 등)가 dawn-cut의 편집 명령을 MCP tool로
// 호출해 .dawn 프로젝트를 편집한다. tool 정의/세션 로직은 mcp-server.ts / session.ts에 있다.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './mcp-server.js';

async function main(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e); // 서버 부트 실패는 stderr로 알린다(noConsole 규칙 비활성).
  process.exit(1);
});
