import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { MEDIA, runFeature } from './_harness.js';

// ── 작은 헬퍼들 ─────────────────────────────────────────────
const ready = (win: Page, ms = 90_000) =>
  win.waitForFunction(
    () => {
      const s = (window as unknown as { __dawnState?: () => { status: string } }).__dawnState?.();
      return s?.status === 'ready';
    },
    null,
    { timeout: ms },
  );
const settle = (win: Page, ms = 400) => win.waitForTimeout(ms);
// 커스텀 드롭다운(KSelect): 버튼(testId) 열고 옵션 선택. value 지정 또는 인덱스.
const pickOption = async (win: Page, testId: string, opt: { value?: string; index?: number }) => {
  await win
    .getByTestId(testId)
    .click()
    .catch(() => {});
  await win.waitForTimeout(120);
  if (opt.value != null) {
    await win
      .locator(`.kselect-opt[data-value="${opt.value}"]`)
      .first()
      .click()
      .catch(() => {});
  } else {
    await win
      .locator('.kselect-pop .kselect-opt')
      .nth(opt.index ?? 0)
      .click()
      .catch(() => {});
  }
};
// range/color 입력에 값 주입. React 제어 입력은 value를 직접 쓰면 value tracker가 onChange를
// 건너뛰므로, 네이티브 value setter로 세팅 후 input/change를 디스패치해야 React onChange가 발화한다.
const setInput = (loc: Locator, value: string) =>
  loc.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, v as string);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);

// ── F1. 가져오기 / 미리보기 / 프록시 / 무음영상 / 치우기 ──
test('F1 import-preview', async () => {
  await runFeature('f1-import', '가져오기·미리보기·프록시·무음영상·치우기', async (c) => {
    // 네이티브(h264) — 그대로 재생
    await c.editor('importPath', MEDIA.koTalk);
    await ready(c.win);
    await settle(c.win, 700);
    c.note('native-state', JSON.stringify(await c.state()));
    await c.shot('native-imported');
    // 재생/일시정지
    await c.win
      .getByTestId('play')
      .click()
      .catch(() => {});
    await settle(c.win, 500);
    await c.shot('playing');
    // 치우기(✕)
    await c.win
      .getByTestId('clear-media')
      .click()
      .catch(() => {});
    await settle(c.win, 300);
    await c.shot('cleared');

    // AV1 — 프리뷰 프록시 경로
    await c.editor('importPath', MEDIA.koCook);
    await ready(c.win);
    await settle(c.win, 1500);
    c.note('av1-state', JSON.stringify(await c.state()));
    await c.shot('av1-proxy');

    // 무음 + L5.2 세로 — 프록시 + 자막불가 안내
    await c.win
      .getByTestId('clear-media')
      .click()
      .catch(() => {});
    if (existsSync(MEDIA.noAudio)) {
      await c.editor('importPath', MEDIA.noAudio);
      await ready(c.win);
      await settle(c.win, 1200);
      c.note('noaudio-state', JSON.stringify(await c.state()));
      await c.shot('noaudio-imported');

      // 무음 영상에 '직접 자막 입력' — 받아쓰기 안 되는 영상도 캡션을 단다(핵심 시나리오).
      await c.win
        .getByTestId('add-manual-cue')
        .first()
        .click()
        .catch(() => {});
      await settle(c.win, 200);
      await c.win
        .getByTestId('manual-cue-text')
        .first()
        .fill('직접 입력한 자막입니다')
        .catch(() => {});
      await settle(c.win, 200);
      await c.shot('manual-caption-editor');
      // 번인 → 자막 오버레이 생김(무음 영상인데 자막 합성)
      await c.win
        .getByTestId('burn-subtitles')
        .click()
        .catch(() => {});
      await c.win
        .waitForFunction(
          () =>
            ((
              window as unknown as { __dawnState?: () => { subtitleOverlays: number } }
            ).__dawnState?.()?.subtitleOverlays ?? 0) > 0,
          null,
          { timeout: 20_000 },
        )
        .catch(() => {});
      c.note('manual-burn', JSON.stringify(await c.state()));
      await c.shot('manual-burned');
    } else {
      c.note('noaudio-skip', `missing ${MEDIA.noAudio}`);
    }
  });
});

// ── F2. 받아쓰기 + 텍스트편집(컷) + 말버릇 + 검수 + 무음제거 ──
test('F2 transcribe-edit', async () => {
  await runFeature('f2-transcribe-edit', '받아쓰기·텍스트컷·말버릇·검수·무음제거', async (c) => {
    await c.editor('importAndTranscribe', MEDIA.koTalk);
    await c.win
      .waitForFunction(
        () =>
          ((window as unknown as { __dawnState?: () => { words: number } }).__dawnState?.()
            ?.words ?? 0) > 0,
        null,
        { timeout: 120_000 },
      )
      .catch(() => {});
    await settle(c.win, 500);
    c.note('after-transcribe', JSON.stringify(await c.state()));
    await c.shot('transcript');

    const before = (await c.state()).durationProgramUs as number;
    const words = c.win.getByTestId('word');
    const n = await words.count();
    if (n >= 3) {
      for (let i = 0; i < 3; i++) await words.nth(i).click();
      await c.win
        .getByTestId('delete-selection')
        .click()
        .catch(() => {});
      await settle(c.win, 400);
      c.note('text-cut', `words=${n} dur ${before}→${(await c.state()).durationProgramUs}`);
      await c.shot('after-text-cut');
    } else {
      c.note('text-cut-skip', `only ${n} words`);
    }

    // 말버릇 제거(활성일 때만)
    const fillers = c.win.getByTestId('remove-fillers');
    if (await fillers.isEnabled().catch(() => false)) {
      await fillers.click();
      await settle(c.win, 400);
      c.note('remove-fillers', 'clicked');
    } else {
      c.note('remove-fillers', 'disabled (0 fillers detected)');
    }
    await c.shot('after-fillers');

    // 검수 모드
    await c.win
      .getByTestId('review-mode')
      .check()
      .catch(() => {});
    await settle(c.win, 300);
    await c.shot('review-mode');
    const jump = c.win.getByTestId('jump-uncertain');
    if (await jump.isVisible().catch(() => false)) {
      await jump.click();
      c.note('jump-uncertain', 'clicked');
    }

    // 무음 제거
    await c.win
      .getByTestId('remove-silences')
      .click()
      .catch(() => {});
    await ready(c.win, 60_000).catch(() => {});
    await settle(c.win, 300);
    c.note('after-silences', JSON.stringify(await c.state()));
    await c.shot('after-silences');
    // 무음 민감도 메뉴
    await c.win
      .getByTestId('silence-menu')
      .click()
      .catch(() => {});
    await settle(c.win, 300);
    await c.shot('silence-menu');
  });
});

// ── F3. 자막 스타일 카드(앵커·크기·세부스타일·프리셋·색) + 스타일팩 + 번인 ──
test('F3 subtitle-style', async () => {
  await runFeature('f3-subtitle', '자막 스타일카드·스타일팩·번인', async (c) => {
    await c.editor('importAndTranscribe', MEDIA.koTalk);
    await c.win
      .waitForFunction(
        () =>
          ((window as unknown as { __dawnState?: () => { words: number } }).__dawnState?.()
            ?.words ?? 0) > 0,
        null,
        { timeout: 120_000 },
      )
      .catch(() => {});
    await settle(c.win, 500);
    const card = c.win.getByTestId('subtitle-pos');
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await c.shot('card-default', card);

    await c.win
      .getByTestId('sub-anchor-tl')
      .click()
      .catch(() => {});
    await settle(c.win, 250);
    await c.shot('anchor-top-left', card);
    await c.win
      .getByTestId('sub-anchor-br')
      .click()
      .catch(() => {});
    await settle(c.win, 250);
    await c.shot('anchor-bottom-right', card);

    await setInput(c.win.getByTestId('sub-scale'), '45');
    await settle(c.win, 250);
    await c.shot('size-45', card);

    // 프리셋 갤러리(썸네일) — 룩 선택
    await c.shot('preset-gallery', c.win.getByTestId('preset-gallery'));
    await c.win
      .getByTestId('sub-preset-card-youtubeBold')
      .click()
      .catch(() => {});
    await settle(c.win, 300);
    await c.shot('preset-youtubeBold', card);
    // 애니메이션 선택(한 어절씩 등장)
    await pickOption(c.win, 'sub-animation', { value: 'reveal' });
    await settle(c.win, 200);
    c.note('animation', 'reveal');

    // 세부 스타일 펼치기 → 색
    await card
      .getByText('세부 스타일', { exact: false })
      .click()
      .catch(() => {});
    await settle(c.win, 250);
    await setInput(c.win.getByTestId('sub-color'), '#ffcc00');
    await settle(c.win, 300);
    await c.shot('style-details', card);

    // 스타일 팩 1클릭
    await pickOption(c.win, 'style-pack', { index: 1 });
    await ready(c.win, 30_000).catch(() => {});
    await settle(c.win, 400);
    c.note('style-pack', JSON.stringify(await c.state()));
    await c.shot('style-pack');

    // 번인 + 초기화
    await c.win
      .getByTestId('burn-subtitles')
      .click()
      .catch(() => {});
    await c.win
      .waitForFunction(
        () =>
          ((
            window as unknown as { __dawnState?: () => { subtitleOverlays: number } }
          ).__dawnState?.()?.subtitleOverlays ?? 0) > 0,
        null,
        { timeout: 30_000 },
      )
      .catch(() => {});
    c.note('burn', JSON.stringify(await c.state()));
    await c.shot('burned');
    await c.win
      .getByTestId('reset-subtitle-settings')
      .click()
      .catch(() => {});
    await settle(c.win, 300);
    await c.shot('after-reset');
  });
});

// ── F4. 자동보정 + 색보정 프리셋 + 리프레임 ──
test('F4 effects', async () => {
  await runFeature('f4-effects', '자동보정·색보정·리프레임', async (c) => {
    await c.editor('importPath', MEDIA.koTalk);
    await ready(c.win);
    await settle(c.win, 700);
    await c.win
      .getByTestId('rail-effect')
      .click()
      .catch(() => {});
    await settle(c.win, 300);
    await c.shot('effect-panel');

    await c.win
      .getByTestId('auto-enhance')
      .click()
      .catch(() => {});
    await c.win
      .waitForSelector('[data-testid="auto-enhance-applied"]', { timeout: 30_000 })
      .catch(() => {});
    await settle(c.win, 400);
    c.note('auto-enhance', JSON.stringify(await c.state()));
    await c.shot('auto-enhanced');

    await pickOption(c.win, 'color-preset', { value: 'vivid' });
    await settle(c.win, 400);
    await c.shot('color-vivid');
    await pickOption(c.win, 'reframe', { value: '9:16' });
    await settle(c.win, 500);
    await c.shot('reframe-916');
  });
});

// ── F5. 스티커 + 이미지 오버레이(겹침 2행·번호·색) + 속성 + 드래그 + 삭제 ──
test('F5 overlays', async () => {
  await runFeature('f5-overlays', '스티커·이미지오버레이·겹침·드래그·속성·삭제', async (c) => {
    await c.editor('importPath', MEDIA.koTalk);
    await ready(c.win);
    await settle(c.win, 600);

    // 스티커(이모지 + 텍스트 배지)
    await c.win
      .getByTestId('rail-sticker')
      .click()
      .catch(() => {});
    await settle(c.win, 300);
    await c.win
      .getByRole('button', { name: '🔥' })
      .click()
      .catch(() => {});
    await c.win
      .getByRole('button', { name: 'LOL' })
      .click()
      .catch(() => {});
    await settle(c.win, 400);
    c.note('stickers', JSON.stringify(await c.state()));
    await c.shot('sticker-panel');

    // 모션 스티커(번들 애니 GIF) — 클릭 시 gif 오버레이 추가
    const motionN = await c.win.locator('[data-testid="motion-grid"] .motion-card').count();
    c.note('motion-count', String(motionN));
    if (motionN > 0) {
      const before = (await c.state()).overlays as number;
      await c.win
        .getByTestId('motion-spinner')
        .click()
        .catch(() => {});
      await settle(c.win, 400);
      c.note('motion-add', `overlays ${before}→${(await c.state()).overlays}`);
      await c.shot('motion-stickers');
    }

    // 이미지 2장 — 같은 시점 → 겹침(2행)
    await c.editor('addImageOverlay', MEDIA.photo1);
    await c.editor('addImageOverlay', MEDIA.photo2);
    await settle(c.win, 400);
    await c.shot('timeline-overlap', c.win.locator('.timeline'));

    // 오버레이 속성(선택된 블록 슬라이더)
    await c.win
      .getByTestId('ov-block')
      .first()
      .click()
      .catch(() => {});
    await settle(c.win, 300);
    await c.shot('overlay-props');

    // 타임라인 블록 드래그(이동)
    await c.dragBlock('ov-block', 0.1, 0.55).catch(() => {});
    await settle(c.win, 300);
    c.note('after-drag', JSON.stringify(await c.state()));
    await c.shot('after-drag', c.win.locator('.timeline'));

    // 선택 후 Delete 삭제
    const before = (await c.state()).overlays as number;
    await c.win
      .getByTestId('ov-block')
      .first()
      .click()
      .catch(() => {});
    await c.win.keyboard.press('Delete');
    await settle(c.win, 300);
    c.note('delete-overlay', `overlays ${before}→${(await c.state()).overlays}`);
    await c.shot('after-delete', c.win.locator('.timeline'));
  });
});

// ── F6. TTS(한국어 보이스 자동) + 드래그 가능한 보이스 클립 + 삭제 ──
test('F6 tts-voice', async () => {
  await runFeature('f6-tts', 'TTS 한국어·드래그 보이스클립·삭제', async (c) => {
    await c.editor('importPath', MEDIA.koTalk);
    await ready(c.win);
    await settle(c.win, 500);
    await c.win
      .getByTestId('rail-text')
      .click()
      .catch(() => {});
    await settle(c.win, 500);
    // 커스텀 드롭다운 열어 옵션 텍스트 수집(한국어 보이스 포함 여부 확인).
    await c.win
      .getByTestId('tts-voice')
      .click()
      .catch(() => {});
    await settle(c.win, 200);
    const opts = await c.win.locator('.kselect-pop .kselect-opt').allInnerTexts();
    await c.win
      .getByTestId('tts-voice')
      .click()
      .catch(() => {}); // 닫기
    c.note('voice-options', opts.join(' | '));
    await c.shot('tts-panel');

    // 스타일 칩(활기참) + 톤 슬라이더 조작 → 미리듣기 → 생성 (opts가 클립에 실리는지)
    await c.win
      .getByTestId('tts-style-lively')
      .click()
      .catch(() => {});
    await settle(c.win, 200);
    await c.shot('tts-style-lively');
    await c.win
      .getByTestId('tts-preview')
      .click()
      .catch(() => {});
    await settle(c.win, 1500); // 짧은 샘플 합성+재생
    c.note('preview', 'clicked');

    await c.win.locator('#tts-text').fill('안녕하세요. 던컷으로 만든 한국어 음성입니다.');
    await c.win
      .getByTestId('generate-voiceover')
      .click()
      .catch(() => {});
    await c.win
      .waitForFunction(
        () =>
          ((window as unknown as { __dawnState?: () => { ttsClips: number } }).__dawnState?.()
            ?.ttsClips ?? 0) > 0,
        null,
        { timeout: 60_000 },
      )
      .catch(() => {});
    await settle(c.win, 400);
    c.note('voice-generated', JSON.stringify(await c.state()));
    await c.shot('voice-generated');
    await c.shot('timeline-voice', c.win.locator('.timeline'));

    // 보이스 블록 드래그
    await c.dragBlock('voice-block', 0.05, 0.5).catch(() => {});
    await settle(c.win, 300);
    c.note('after-voice-drag', JSON.stringify(await c.state()));
    await c.shot('voice-after-drag', c.win.locator('.timeline'));

    // 패널에서 보이스 클립 삭제(✕)
    await c.win
      .getByTestId('tts-remove')
      .first()
      .click()
      .catch(() => {});
    await settle(c.win, 300);
    c.note('voice-removed', JSON.stringify(await c.state()));
    await c.shot('voice-removed');
  });
});

// ── F7. 챕터 + 내 사전(글로서리) + 자동 하이라이트 ──
test('F7 chapters-glossary-highlight', async () => {
  await runFeature('f7-chapters', '챕터·내사전·자동하이라이트', async (c) => {
    await c.editor('importAndTranscribe', MEDIA.koTalk);
    await c.win
      .waitForFunction(
        () =>
          ((window as unknown as { __dawnState?: () => { words: number } }).__dawnState?.()
            ?.words ?? 0) > 0,
        null,
        { timeout: 120_000 },
      )
      .catch(() => {});
    await settle(c.win, 400);

    // 챕터
    await c.win
      .getByText('챕터 / 타임스탬프', { exact: false })
      .click()
      .catch(() => {});
    await c.win
      .getByTestId('gen-chapters')
      .click()
      .catch(() => {});
    await settle(c.win, 800);
    await c.shot('chapters');
    await c.win
      .getByTestId('copy-chapters')
      .click()
      .catch(() => {});
    c.note('chapters', 'generated + copied');

    // 내 사전
    await c.win
      .getByText('내 사전', { exact: false })
      .click()
      .catch(() => {});
    await settle(c.win, 300);
    const inputs = c.win.locator('.glossary-body input');
    if ((await inputs.count()) >= 2) {
      await inputs.nth(0).fill('던컷');
      await inputs.nth(1).fill('dawn-cut');
      await c.win
        .getByText('추가', { exact: false })
        .first()
        .click()
        .catch(() => {});
      await settle(c.win, 300);
    }
    await c.shot('glossary');
    await c.win
      .getByTestId('glossary-remove')
      .first()
      .click()
      .catch(() => {});
    c.note('glossary', 'add + remove');

    // 자동 하이라이트(롱폼→쇼츠)
    const before = (await c.state()).durationProgramUs as number;
    await c.editor('autoHighlight', 30);
    await settle(c.win, 600);
    c.note('auto-highlight', `dur ${before}→${(await c.state()).durationProgramUs}`);
    await c.shot('auto-highlight');
  });
});

// ── F8. 내보내기(MP4/SRT/GIF) + 저장/열기 + 되돌리기/다시 + 치우기 ──
test('F8 export-project', async () => {
  await runFeature('f8-export-project', '내보내기·저장열기·되돌리기·치우기', async (c) => {
    const out = (n: string) => `${c.dir}/${n}`;
    await c.editor('importPath', MEDIA.short);
    await ready(c.win);
    await settle(c.win, 500);

    // 편집 1개(undo/redo 대상) — 이미지 오버레이
    await c.editor('addImageOverlay', MEDIA.photo1);
    await settle(c.win, 300);

    // MP4
    await c.editor('exportTo', out('export.mp4'));
    await c.win
      .waitForFunction(
        () =>
          (window as unknown as { __dawnState?: () => { status: string } }).__dawnState?.()
            ?.status === 'exported',
        null,
        { timeout: 120_000 },
      )
      .catch(() => {});
    c.note('export-mp4', `${out('export.mp4')} exists=${existsSync(out('export.mp4'))}`);
    await c.shot('exported-mp4');

    // SRT
    await c.editor('exportSrt', out('export.srt')).catch(() => {});
    await settle(c.win, 800);
    c.note('export-srt', `exists=${existsSync(out('export.srt'))}`);

    // GIF
    await c.editor('exportGif', out('export.gif')).catch(() => {});
    await c.win
      .waitForFunction(
        () => {
          const s = (
            window as unknown as { __dawnState?: () => { status: string } }
          ).__dawnState?.();
          return s?.status === 'gif exported' || s?.status === 'exported';
        },
        null,
        { timeout: 120_000 },
      )
      .catch(() => {});
    c.note('export-gif', `exists=${existsSync(out('export.gif'))}`);

    // 저장 → 열기
    await c.editor('saveProject', out('project.dawn')).catch(() => {});
    await settle(c.win, 500);
    c.note('save-project', `exists=${existsSync(out('project.dawn'))}`);
    await c.editor('openProject', out('project.dawn')).catch(() => {});
    await ready(c.win, 30_000).catch(() => {});
    await settle(c.win, 400);
    const reopened = await c.state();
    c.note('open-project', JSON.stringify(reopened));
    // 작업 현황 저장(v3, issue #17): 저장 전 올린 오버레이가 열기 후에도 살아 있어야 한다.
    // (v2까지는 timeline/transcript만 저장돼 스티커·이미지가 전부 유실됐다.)
    expect((reopened as { overlays?: number }).overlays ?? 0).toBeGreaterThanOrEqual(1);
    await c.shot('after-open');

    // 되돌리기/다시
    await c.win
      .getByTestId('undo')
      .click()
      .catch(() => {});
    await settle(c.win, 250);
    c.note('after-undo', JSON.stringify(await c.state()));
    await c.win
      .getByTestId('redo')
      .click()
      .catch(() => {});
    await settle(c.win, 250);
    await c.shot('undo-redo');

    // 치우기
    await c.win
      .getByTestId('clear-media')
      .click()
      .catch(() => {});
    await settle(c.win, 300);
    c.note('clear', JSON.stringify(await c.state()));
    await c.shot('cleared');
  });
});
