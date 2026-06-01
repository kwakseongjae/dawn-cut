import { describe, expect, it } from 'vitest';
import { makeWord } from './_testkit.js';
import { dryRunCommands } from './dryrun.js';
import { type EditorState, safeParseEditCommand } from './edit-command.js';
import { STYLE_PACKS, stylePackById } from './templates.js';
import { createInitialTimeline } from './timeline.js';
import { buildTranscriptModel } from './transcript.js';

// 팩이 안전히 쓸 수 있는 verb(외부 좌표/ID 불필요).
const PACK_SAFE = new Set([
  'replaceSubtitleStyle',
  'setSubtitleStyle',
  'applyColorgrade',
  'removeFillers',
]);

// 최소 상태: 비디오 클립 1개(색보정) + '음' 필러 포함 전사(removeFillers no-op 아님).
function sampleState(): EditorState {
  const words = [
    makeWord('음', 0, 200_000),
    makeWord('안녕하세요', 300_000, 900_000),
    makeWord('반갑습니다', 1_000_000, 1_800_000),
  ];
  return {
    timeline: createInitialTimeline('m', 5_000_000, 30),
    transcript: buildTranscriptModel(words, 'm', 'ko'),
  };
}

describe('STYLE_PACKS — 1클릭 스타일 팩(= plan 묶음)', () => {
  it('비어있지 않고 id가 고유하며 commands가 1개 이상', () => {
    expect(STYLE_PACKS.length).toBeGreaterThanOrEqual(5);
    const ids = STYLE_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of STYLE_PACKS) {
      expect(p.commands.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it.each(STYLE_PACKS)('[$id] 모든 command가 유효 EditCommand + 팩-안전 verb', (pack) => {
    for (const cmd of pack.commands) {
      const parsed = safeParseEditCommand(cmd);
      expect(parsed.success, `${pack.id}: ${JSON.stringify(cmd)}`).toBe(true);
      expect(PACK_SAFE.has((cmd as { type: string }).type)).toBe(true);
    }
  });

  it.each(STYLE_PACKS)('[$id] dryRun이 클린(ok:true — 불변식 안 깨짐, 원자 적용 가능)', (pack) => {
    const { report } = dryRunCommands(sampleState(), pack.commands);
    expect(report.ok, report.error).toBe(true);
  });

  it('stylePackById로 조회(없으면 undefined)', () => {
    expect(stylePackById('viral-punch')?.label).toBe('바이럴 펀치');
    expect(stylePackById('does-not-exist')).toBeUndefined();
  });
});
