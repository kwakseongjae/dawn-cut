// 클라우드 TTS 실음성 검증 — 실제 자막 스크립트 5종 × '던' 카탈로그 보이스.
// OpenRouter 키(설정 파일)로 Gemini(프론티어)·4o-mini(가성비)를 합성해 output/tts-samples/에
// 아카이브한다. A/B 비교용으로 시그니처 문장은 두 모델 모두 생성.
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  OPENROUTER_FRONTIER_MODEL,
  synthesizeOpenRouterTts,
  synthesizeTts,
} from '@dawn-cut/sidecar-tts';

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'output/tts-samples');
mkdirSync(OUT, { recursive: true });

const settings = JSON.parse(
  readFileSync(join(homedir(), 'Library/Application Support/Electron/settings.json'), 'utf8'),
) as { openrouterApiKey?: string };
const apiKey = settings.openrouterApiKey ?? '';
if (!apiKey) throw new Error('settings.json에 openrouterApiKey가 없습니다');

// 실제 편집 시나리오의 자막/보이스오버 스크립트.
const SAMPLES: { name: string; voice: string; style?: string; text: string; model?: string }[] = [
  {
    name: '01-dawn-intro-gemini',
    voice: 'dawn',
    text: '안녕하세요, 던컷입니다. 오늘은 영상 편집을 자막 한 줄 지우듯 쉽게 만드는 방법을 소개할게요. 무음 구간 제거부터 자막 스타일까지, 단 한 문장이면 충분합니다.',
  },
  {
    name: '02-dawn-intro-local-say', // A/B 비교용 — 같은 문장, 기존 로컬 엔진(현행 기본값)
    voice: 'local',
    text: '안녕하세요, 던컷입니다. 오늘은 영상 편집을 자막 한 줄 지우듯 쉽게 만드는 방법을 소개할게요. 무음 구간 제거부터 자막 스타일까지, 단 한 문장이면 충분합니다.',
  },
  {
    name: '03-haru-shorts',
    voice: 'haru',
    style: 'lively',
    text: '단 삼 초 만에 무음 구간이 전부 사라집니다! 워터마크도 없고, 구독료도 없어요. 영상은 절대 컴퓨터 밖으로 나가지 않습니다. 지금 바로 써보세요!',
  },
  {
    name: '04-seoyeon-docu',
    voice: 'seoyeon',
    style: 'calm',
    text: '새벽 다섯 시. 도시가 깨어나기 전, 편집실의 불은 아직 꺼지지 않았다. 수백 번의 컷과 되감기 — 그 모든 반복을, 이제 인공지능이 대신한다.',
  },
  {
    name: '05-hojin-trailer-en-mix',
    voice: 'hojin',
    text: '올여름, 편집의 기준이 바뀐다. CapCut과 Vrew를 잇는 단 하나의 오픈소스, dawn-cut. 당신의 첫 AI 편집실.',
  },
];

async function main() {
  const report: string[] = [];
  for (const s of SAMPLES) {
    const wav = join(OUT, `${s.name}.wav`);
    const t0 = Date.now();
    try {
      const res =
        s.voice === 'local'
          ? await synthesizeTts(s.text, wav, {})
          : await synthesizeOpenRouterTts(s.text, wav, {
              apiKey,
              voice: s.voice,
              ...(s.style ? { style: s.style } : {}),
              ...(s.model ? { model: s.model } : {}),
            });
      // 듣기 편한 m4a로도 변환(파일 전송용, wav는 파이프라인 검증용 보존).
      const m4a = join(OUT, `${s.name}.m4a`);
      await exec('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        wav,
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        m4a,
      ]);
      const { stdout } = await exec('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        wav,
      ]);
      const line = `${s.name}: OK model=${res.model} dur=${Number(stdout).toFixed(1)}s voice=${'voice' in res ? res.voice : ''} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`;
      console.log(line);
      report.push(line);
    } catch (e) {
      const line = `${s.name}: FAIL ${e instanceof Error ? e.message : e}`;
      console.error(line);
      report.push(line);
    }
  }
  writeFileSync(join(OUT, 'report.txt'), `${report.join('\n')}\n`);
  console.log(`\n샘플 폴더: ${OUT}`);
  console.log(`기본 프론티어 모델: ${OPENROUTER_FRONTIER_MODEL}`);
}
void main();
