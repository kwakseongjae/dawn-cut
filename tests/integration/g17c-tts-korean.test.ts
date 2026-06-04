import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import {
  buildInlinePrefix,
  buildSayArgs,
  isPiperAvailable,
  listVoices,
  parseVoices,
  pickVoice,
  synthesizeTts,
} from '@dawn-cut/sidecar-tts';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const KO = '안녕하세요. 던컷으로 만든 한국어 음성입니다.';
const isKo = (l: string) => l.toLowerCase().startsWith('ko');

// ── 순수 로직: parseVoices / pickVoice (바이너리 없이 항상 실행) ──
describe('TTS voice selection (pure)', () => {
  // 실제 `say -v '?'` 출력 형식: 이름 컬럼은 공백으로 정렬되고(이름과 lang 사이 2칸 이상),
  // 이름 안의 공백은 1칸. 긴 이름도 lang 앞엔 항상 2칸 이상 패딩이 붙는다.
  const sample = [
    'Samantha            en_US    # Hello, my name is Samantha.',
    'Yuna                ko_KR    # 안녕하세요. 제 이름은 유나입니다.',
    'Eddy (한국어(한국))      ko_KR    # 안녕하세요. 제 이름은 Eddy입니다.',
    'Daniel              en_GB    # Hello.',
  ].join('\n');
  const voices = parseVoices(sample);

  it('parseVoices reads name + lang, keeping spaces in names', () => {
    expect(voices).toContainEqual({ name: 'Yuna', lang: 'ko_KR' });
    expect(voices.find((v) => v.name === 'Eddy (한국어(한국))')?.lang).toBe('ko_KR');
    expect(voices.find((v) => v.name === 'Samantha')?.lang).toBe('en_US');
  });

  it('Korean text + English voice → auto-switches to a Korean voice (Yuna preferred)', () => {
    expect(pickVoice(KO, 'Samantha', voices)).toBe('Yuna');
  });

  it('English text keeps the requested installed voice', () => {
    expect(pickVoice('hello world', 'Samantha', voices)).toBe('Samantha');
  });

  it('uninstalled requested voice (old fake names) falls back to a real one, not silent default', () => {
    // 'Nova' isn't in the list → must not be returned verbatim (that caused silent fallback).
    expect(pickVoice('hello world', 'Nova', voices)).toBe('Samantha');
  });

  it('empty voice list (non-macOS/test) returns the request or Samantha', () => {
    expect(pickVoice(KO, 'Samantha', [])).toBe('Samantha');
  });
});

// ── 순수 로직: 속도/톤 인자 구성 (say -r + 인라인 [[pbas]]/[[volm]]) ──
describe('TTS speed/tone args (pure)', () => {
  it('buildSayArgs: rate를 -r로 추가, 미지정 시 생략', () => {
    expect(buildSayArgs('Yuna', '/tmp/a.aiff')).toEqual(['-v', 'Yuna', '-o', '/tmp/a.aiff']);
    expect(buildSayArgs('Yuna', '/tmp/a.aiff', 235)).toEqual([
      '-v',
      'Yuna',
      '-r',
      '235',
      '-o',
      '/tmp/a.aiff',
    ]);
  });
  it('buildInlinePrefix: pitch/volume를 인라인 명령으로, 없으면 빈 문자열', () => {
    expect(buildInlinePrefix()).toBe('');
    expect(buildInlinePrefix(38)).toBe('[[pbas 38]] ');
    expect(buildInlinePrefix(64, 0.9)).toBe('[[pbas 64]] [[volm 0.90]] ');
    expect(buildInlinePrefix(200)).toBe('[[pbas 100]] '); // 0~100 클램프
  });

  it('isPiperAvailable: env 미설정/가짜 경로면 available=false(throw 금지, say 폴백)', () => {
    const prevBin = process.env.DAWN_PIPER_BIN;
    const prevModel = process.env.DAWN_PIPER_MODEL;
    // 빈 문자열 = 미설정(falsy)로 취급된다(isPiperAvailable의 !binPath 가드). delete 회피(noDelete).
    process.env.DAWN_PIPER_BIN = '';
    process.env.DAWN_PIPER_MODEL = '';
    const noEnv = isPiperAvailable();
    expect(noEnv.available).toBe(false);
    expect(noEnv.reason).toBeTruthy();
    process.env.DAWN_PIPER_BIN = '/nope/piper';
    process.env.DAWN_PIPER_MODEL = '/nope/model.onnx';
    expect(isPiperAvailable().available).toBe(false); // 파일 없음 → false(throw 안 함)
    // 원복(다른 테스트가 say 폴백을 쓰도록 — 빈 문자열이면 say 분기로 안전).
    process.env.DAWN_PIPER_BIN = prevBin ?? '';
    process.env.DAWN_PIPER_MODEL = prevModel ?? '';
  });
});

describe('G17d TTS speed — slower voice is longer (real say)', () => {
  it.skipIf(process.platform !== 'darwin')('rate 130 wav > rate 240 wav', async () => {
    if (koVoices.length === 0) return;
    const v = koVoices[0]!;
    const dir = mkdtempSync(join(tmpdir(), 'dawn-g17d-'));
    const slow = join(dir, 'slow.wav');
    const fast = join(dir, 'fast.wav');
    await synthesizeTts(KO, slow, { voice: v, rate: 130 });
    await synthesizeTts(KO, fast, { voice: v, rate: 240 });
    const ds = (await probeMedia(slow)).durationUs;
    const df = (await probeMedia(fast)).durationUs;
    writeFileSync(
      resolve(ROOT, 'artifacts/g17d-rate.txt'),
      `voice=${v} slow(130)=${ds}us fast(240)=${df}us ratio=${(ds / df).toFixed(2)}\n`,
    );
    expect(ds).toBeGreaterThan(df * 1.25); // 느린 쪽이 확실히 더 길다
  });
});

// ── 실측: macOS `say`에 한국어 보이스가 있으면 실제 한국어 음성이 나오는지 ──
let koVoices: string[] = [];
beforeAll(async () => {
  koVoices = (await listVoices()).filter((v) => isKo(v.lang)).map((v) => v.name);
});

describe('G17c Korean TTS — real say produces real Korean audio (auto-switch)', () => {
  it.skipIf(process.platform !== 'darwin')(
    'Korean text with default English voice yields non-trivial Korean speech',
    async () => {
      if (koVoices.length === 0) {
        // 한국어 보이스 미설치 머신 — 스킵 사유를 아티팩트로 남긴다.
        writeFileSync(
          resolve(ROOT, 'artifacts/g17c-korean.txt'),
          'no ko_KR voice installed; skipped audio assertion\n',
        );
        return;
      }
      const dir = mkdtempSync(join(tmpdir(), 'dawn-g17c-'));
      const wav = join(dir, 'ko.wav');
      // 일부러 영어 보이스를 요청 → 한글이라 자동으로 한국어 보이스로 전환돼야 한다.
      const res = await synthesizeTts(KO, wav, { voice: 'Samantha' });

      expect(res.engine).toBe('say');
      expect(isKoVoiceName(res.voice, koVoices)).toBe(true); // 한국어 보이스로 전환됨
      expect(existsSync(res.wavPath)).toBe(true);

      const probe = await probeMedia(res.wavPath);
      expect(probe.hasAudio).toBe(true);
      expect(probe.durationUs).toBeGreaterThan(1_000_000); // 1초 이상 실제 발화
      const bytes = statSync(res.wavPath).size;
      writeFileSync(
        resolve(ROOT, 'artifacts/g17c-korean.txt'),
        `voice=${res.voice} (auto from Samantha) dur=${probe.durationUs}us bytes=${bytes}\n`,
      );
      expect(bytes).toBeGreaterThan(20_000); // Samantha-on-Korean = ~4.6KB 무음. 한국어 발화는 훨씬 큼.
    },
  );
});

function isKoVoiceName(name: string, koVoices: string[]): boolean {
  return koVoices.includes(name);
}
