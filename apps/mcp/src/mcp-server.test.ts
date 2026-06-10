import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Word,
  buildTranscriptModel,
  createInitialTimeline,
  makeProject,
  serializeProject,
} from '@dawn-cut/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './mcp-server.js';
import { DawnSession } from './session.js';

// 실제 MCP 프로토콜 왕복(Client ↔ in-memory transport ↔ buildServer). 서브프로세스 없이 결정적.
function writeProject(): string {
  const words: Word[] = [['안녕하세요', 0, 0.6] as const, ['반갑습니다', 0.6, 1.4] as const].map(
    ([text, s, e], i) => ({
      id: `m:w${i}`,
      text,
      sourceStart: Math.round(s * 1_000_000),
      sourceEnd: Math.round(e * 1_000_000),
      confidence: 1,
      mediaId: 'm',
    }),
  );
  const project = makeProject(
    '/media/clip.mp4',
    buildTranscriptModel(words, 'm', 'ko'),
    createInitialTimeline('m', 2_000_000, 30),
  );
  const path = join(mkdtempSync(join(tmpdir(), 'dawn-mcp-rpc-')), 'p.dawn');
  writeFileSync(path, serializeProject(project), 'utf8');
  return path;
}

// SDK CallToolResult는 content 없는 변형(toolResult)도 포함하는 유니언이라 unknown으로 받는다.
const textOf = (res: unknown) =>
  ((res as { content?: { type: string; text: string }[] }).content ?? [])[0]?.text ?? '';

describe('dawn-cut MCP server — 실제 프로토콜 왕복', () => {
  let client: Client;

  beforeAll(async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer(new DawnSession());
    await server.connect(serverT);
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientT);
  });

  it('tools/list 가 편집 도구를 노출한다', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'open_project',
        'command_manifest',
        'plan',
        'dry_run',
        'apply',
        'save_project',
        'audit_log',
        'render',
      ]),
    );
  });

  it('open → dry_run → apply 를 tools/call 로 수행(감사 1건)', async () => {
    const path = writeProject();
    const opened = await client.callTool({ name: 'open_project', arguments: { path } });
    expect(JSON.parse(textOf(opened)).mediaPath).toBe('/media/clip.mp4');

    const manifest = await client.callTool({ name: 'command_manifest', arguments: {} });
    expect(textOf(manifest)).toContain('applyColorgrade');

    const cmds = [{ type: 'applyColorgrade', preset: 'cinematic' }];
    const dry = await client.callTool({ name: 'dry_run', arguments: { commands: cmds } });
    expect(JSON.parse(textOf(dry)).ok).toBe(true);

    const applied = await client.callTool({ name: 'apply', arguments: { commands: cmds } });
    const res = JSON.parse(textOf(applied));
    expect(res.auditCount).toBe(1);
    expect(res.auditVerified).toBe(true);
  });

  it('잘못된 명령은 dry_run ok:false 로 안전하게 거부', async () => {
    const path = writeProject();
    await client.callTool({ name: 'open_project', arguments: { path } });
    const dry = await client.callTool({
      name: 'dry_run',
      arguments: { commands: [{ type: 'nope' }] },
    });
    expect(JSON.parse(textOf(dry)).ok).toBe(false);
  });
});
