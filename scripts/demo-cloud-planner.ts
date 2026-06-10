// 클라우드 플래너(#15) 실평가 — 자유 복합 한국어 지시 → EditCommand[] 플랜.
// 같은 buildPlanPrompt/parsePlan/dryRun 게이트를 통과시키고, 룰 플래너와 비교한다.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type Word,
  buildPlanPrompt,
  buildTranscriptModel,
  createInitialTimeline,
  dryRunCommands,
  parsePlan,
  plannerManifest,
  ruleBasedPlan,
  summarizeState,
} from '@dawn-cut/core';

const settings = JSON.parse(
  readFileSync(join(homedir(), 'Library/Application Support/Electron/settings.json'), 'utf8'),
) as { openrouterApiKey?: string };
const MODEL = process.env.DAWN_PLANNER_MODEL ?? 'anthropic/claude-sonnet-4.6';

// 한국어 강의 장면(셀렉터 테스트와 동일 패턴).
function scene() {
  const texts = [
    '안녕하세요.',
    '음',
    '오늘은',
    '던컷을',
    '소개합니다.',
    '어',
    '자막은',
    '자동입니다.',
  ];
  const words: Word[] = texts.map((t, i) => ({
    id: `m:w${i}`,
    text: t,
    sourceStart: i * 500_000,
    sourceEnd: i * 500_000 + 450_000,
    confidence: 1,
    mediaId: 'm',
  }));
  return {
    transcript: buildTranscriptModel(words, 'm', 'ko'),
    timeline: createInitialTimeline('m', 4_000_000, 30),
  };
}

const PROMPTS = [
  '말버릇 빼고 시네마틱한 톤으로 바꿔줘',
  '핵심 단어 노란색으로 강조하고 30초 하이라이트로 만들어줘',
  '이 영상 좀 정리해줘 — 음, 어 같은 추임새는 다 빼고, 쇼츠 느낌 나게 색감도 쨍하게',
  '인트로가 너무 늘어지는데 짧고 임팩트있게 60초로 요약해줘. 자막도 예능처럼 키워드 강조!',
];

async function main() {
  const state = scene();
  for (const nl of PROMPTS) {
    const prompt = buildPlanPrompt(nl, summarizeState(state), plannerManifest());
    const t0 = Date.now();
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.openrouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 1200,
      }),
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? '';
    const { plan, errors } = parsePlan(text);
    const { report } = dryRunCommands(state, plan);
    const rule = ruleBasedPlan(nl, state);
    console.log(`\n■ "${nl}"`);
    console.log(
      `  cloud(${MODEL.split('/')[1]}): ${plan.map((c) => c.type).join(', ') || '(빈 플랜)'} · ${Date.now() - t0}ms · dryRun ok=${report.ok}${errors.length ? ` · zod거부 ${errors.length}` : ''}`,
    );
    console.log(`  rule              : ${rule.map((c) => c.type).join(', ') || '(빈 플랜)'}`);
  }
}
void main();
