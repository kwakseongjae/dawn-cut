import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transcribe } from '@dawn-cut/sidecar-stt';
import { describe, expect, it } from 'vitest';

// Cycle-0 한국어 어절 게이트의 실(實)바이너리 증명.
// 픽스처는 `bash scripts/stt-korean-spike.sh`가 생성(artifacts/stt-spike/voice.wav).
// 없으면 self-skip — `pnpm verify`는 어디서나 green 유지(영어 G2가 회귀 가드).
const ROOT = resolve(process.cwd());
const WHISPER_BIN =
  process.env.DAWN_WHISPER_BIN ?? resolve(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const KO_WAV = resolve(ROOT, 'artifacts/stt-spike/voice.wav');
const hasFixture = existsSync(WHISPER_BIN) && existsSync(KO_WAV);

// 레퍼런스 나레이션에서 base 모델이 안정적으로 맞히는 어절(무음→몸 오인 제외).
const EXPECT_EOJEOLS = ['오늘은', '오픈소스', '영상', '자막을', '자동으로', '구간도', '유튜브에'];

describe.skipIf(!hasFixture)('G2-KO STT — 한국어 어절 재조립 (real binary, natural mode)', () => {
  it('어절 무손실(mojibake 0) + 어절 복원 + T-INV-2/3, baseline 기록', async () => {
    const { words, language } = await transcribe(KO_WAV, { mediaId: 'ko-fixture', lang: 'ko' });
    expect(language).toBe('ko');
    expect(words.length).toBeGreaterThan(5);

    // 무손실: 자연모드는 유효 UTF-8 → U+FFFD(�) 0개. (-ml 1 바이트파편 회귀 방지)
    for (const w of words) expect(w.text).not.toContain('�');

    // T-INV-3: 양(+) 길이. T-INV-2: 단조 비감소.
    for (const w of words) expect(w.sourceEnd).toBeGreaterThan(w.sourceStart);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.sourceStart).toBeGreaterThanOrEqual(words[i - 1]!.sourceStart);
    }

    // 어절 단위로 복원됐는가: 합친 텍스트에 기대 어절이 통째로 존재(쪼개진 조각 아님).
    const joined = words.map((w) => w.text).join(' ');
    const found = EXPECT_EOJEOLS.filter((e) => joined.includes(e));
    const recall = found.length / EXPECT_EOJEOLS.length;

    // 모델 업그레이드(base→large-v3-turbo/medium-ko) 회귀추적 baseline.
    writeFileSync(
      resolve(ROOT, 'artifacts/g2-korean-words.json'),
      JSON.stringify({ language, recall, found, words }, null, 2),
    );
    writeFileSync(
      resolve(ROOT, 'artifacts/g2-korean-accuracy.txt'),
      `model=${process.env.DAWN_WHISPER_MODEL_PATH ?? 'ggml-large-v3-turbo.bin (sidecar default)'}\n` +
        `eojeol-recall=${recall.toFixed(3)} found=${found.length}/${EXPECT_EOJEOLS.length}\n` +
        `matched: ${found.join(', ')}\n` +
        `transcript: ${joined}\n`,
    );

    // base 모델 기준 최소 보장(어절 머지가 동작하면 대부분 통째로 잡힘).
    expect(recall).toBeGreaterThanOrEqual(0.7);
  });
});
