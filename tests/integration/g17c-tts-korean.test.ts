import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { probeMedia } from '@dawn-cut/sidecar-ffmpeg';
import { listVoices, parseVoices, pickVoice, synthesizeTts } from '@dawn-cut/sidecar-tts';
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
