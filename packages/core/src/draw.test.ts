import { describe, expect, it } from 'vitest';
import { type DrawCtx, SUBTITLE_PRESETS, drawSubtitle } from './draw.js';

// fillText 호출을 (text, 그 시점 fillStyle)로 기록하는 가짜 캔버스 컨텍스트.
function recordingCtx() {
  const fills: { text: string; color: string }[] = [];
  let fillStyle = '';
  const ctx: DrawCtx = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(v) {
      fillStyle = String(v);
    },
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'middle',
    beginPath() {},
    roundRect() {},
    fill() {},
    fillText(text: string) {
      fills.push({ text, color: fillStyle });
    },
    strokeText() {},
    measureText(text: string) {
      return { width: [...text].length * 10 };
    },
  };
  return { ctx, fills };
}
const NOBOX = { color: '#ffffff', bg: 'transparent', stroke: '' } as const;

describe('SUBTITLE_PRESETS', () => {
  it('exposes the documented preset ids', () => {
    expect(Object.keys(SUBTITLE_PRESETS).sort()).toEqual(
      ['cinematic', 'default', 'highlight', 'korean', 'koreanShorts', 'podcast', 'tiktok'].sort(),
    );
  });

  it('korean preset prefers CJK fonts before falling back to system', () => {
    const p = SUBTITLE_PRESETS.korean!;
    expect(p.fontFamily?.toLowerCase()).toMatch(/apple sd gothic|pretendard|noto|malgun/);
  });

  it('koreanShorts preset: 크고 굵은 CJK + 두꺼운 외곽선 + 키워드 강조(쇼츠 룩)', () => {
    const p = SUBTITLE_PRESETS.koreanShorts!;
    expect(p.fontFamily?.toLowerCase()).toMatch(/apple sd gothic|pretendard|noto|malgun/); // 한글 글리프
    expect(p.fontScale ?? 0).toBeGreaterThan(0.42); // 큰 글씨
    expect(p.strokeWidth ?? 0).toBeGreaterThan(8); // 두꺼운 외곽선
    expect(p.emphasisColor).toBeTruthy(); // 키워드 강조색
    expect(p.fontFamily?.toLowerCase()).not.toContain('impact'); // 한글에 Impact 금지(두부 방지)
  });

  it('tiktok preset is bold, outlined, no bg (the recognizable look)', () => {
    const p = SUBTITLE_PRESETS.tiktok!;
    expect(p.bg).toBe('transparent');
    expect(p.strokeWidth ?? 0).toBeGreaterThan(6);
    expect(p.fontFamily?.toLowerCase()).toContain('impact');
  });

  it('default preset is empty so renderer uses built-in defaults', () => {
    expect(SUBTITLE_PRESETS.default).toEqual({});
  });
});

describe('drawSubtitle — 키워드 강조', () => {
  it('emphasis 어절은 emphasisColor, 나머지는 color로 칠한다', () => {
    const { ctx, fills } = recordingCtx();
    drawSubtitle(
      ctx,
      1000,
      150,
      '오픈소스 영상 편집기',
      { ...NOBOX, emphasisColor: '#ffe14d' },
      new Set(['오픈소스']),
    );
    expect(fills.find((f) => f.text === '오픈소스')?.color).toBe('#ffe14d');
    expect(fills.find((f) => f.text === '영상')?.color).toBe('#ffffff');
  });

  it('구두점 붙은 강조 어절도 코어 비교로 매칭(표면형 보존)', () => {
    const { ctx, fills } = recordingCtx();
    drawSubtitle(
      ctx,
      1000,
      150,
      '자동으로, 됩니다.',
      { ...NOBOX, emphasisColor: '#ff0' },
      new Set(['자동으로']),
    );
    expect(fills.find((f) => f.text === '자동으로,')?.color).toBe('#ff0');
  });

  it('emphasis 없거나 빈 Set이면 줄당 단일 렌더(역호환)', () => {
    const a = recordingCtx();
    drawSubtitle(a.ctx, 1000, 150, '오픈소스 영상', NOBOX);
    expect(a.fills.filter((f) => f.text.trim() !== '')).toHaveLength(1);
    const b = recordingCtx();
    drawSubtitle(b.ctx, 1000, 150, '오픈소스 영상', NOBOX, new Set());
    expect(b.fills.filter((f) => f.text.trim() !== '')).toHaveLength(1);
  });
});
