import {
  STYLE_PACKS,
  SUBTITLE_PRESETS,
  captionFrames,
  clampRange,
  detectFillers,
  drawBadge,
  drawEmoji,
  drawSubtitle,
  dryRunCommands,
  extractChapters,
  formatChapters,
  lowConfidenceWords,
  moveOverlay,
  pickKeywords,
  programToWord,
  resizeOverlay,
  timelineToEdl,
  transcriptToCues,
  videoClips,
  wordToProgram,
  wrapCaption,
} from '@dawn-cut/core';
import type { Chapter, ColorEq, Edl, SubtitleStyle } from '@dawn-cut/core';
import {
  ArrowUpToLine,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  CornerDownRight,
  Eraser,
  Film,
  ListTree,
  Lock,
  type LucideIcon,
  Mic,
  NotebookText,
  Palette,
  Pause,
  Pencil,
  Play,
  Redo2,
  RotateCcw,
  Scissors,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Volume2,
  Wand2,
} from 'lucide-react';
import {
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './styles.css';
import { deadSet, useEditor } from './store.js';
import type { ColorPreset, Overlay, PanelId, TtsClip } from './store.js';

export * from './types.js';
export { useEditor } from './store.js';

const US = 1_000_000;
function fmt(us: number): string {
  const s = Math.max(0, us) / US;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}
const pickOpen = async () => (await window.dawn?.openFile()) ?? null;
const pickSave = async () => (await window.dawn?.saveFile()) ?? null;
// 오버레이별 고유 색(타임라인 블록·목록·미리보기에서 같은 색으로 매칭). id 해시 → 팔레트.
const OV_COLORS = ['#7c5cff', '#ff6b6b', '#34d399', '#f59e0b', '#22d3ee', '#ec4899', '#a3e635'];
const OV_ROW_H = 22; // OVERLAY 레인 행 높이(px) — 겹치는 블록을 여러 행으로 쌓을 때 사용
const ovColor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return OV_COLORS[h % OV_COLORS.length]!;
};
// 비-자막 오버레이 중 몇 번째인지(1-base). 타임라인 블록 번호 ↔ 좌측 목록 번호를 일치시킨다.
const laneNumber = (overlays: Overlay[], id: string) =>
  overlays.filter((o) => o.kind !== 'subtitle').findIndex((o) => o.id === id) + 1;
// 오버레이 번호 배지(타임라인 블록과 같은 색·번호) — 같은 스티커 2개를 구분하기 위함.
function OvBadge({ n, id }: { n: number; id: string }) {
  return (
    <span className="ov-num" style={{ background: ovColor(id) }}>
      {n}
    </span>
  );
}
const isVideo = (n: string) => /\.(mp4|mov|m4v|webm|mkv|avi|flv|ts|mpe?g|wmv|3gp)$/i.test(n);
const isImage = (n: string) => /\.(png|jpe?g|webp|avif|bmp)$/i.test(n);
const isGif = (n: string) => /\.gif$/i.test(n);
// 드래그앤드롭 경로: Electron 32+는 File.path를 제거 → preload의 webUtils.getPathForFile 사용.
// (구버전/비-Electron 폴백으로 File.path도 본다.)
const filePath = (f: File) =>
  window.dawn?.pathForFile?.(f) || (f as File & { path?: string }).path || '';

// ── Toolbar ──────────────────────────────────────────────────────────
function Toolbar() {
  const s = useEditor();
  const [menu, setMenu] = useState(false);
  const exportAs = async (fn: (p: string) => Promise<void>) => {
    setMenu(false);
    const p = await pickSave();
    if (p) await fn(p);
  };
  return (
    <div className="toolbar">
      <div className="brand">
        <PingDot />
        <span data-testid="app-title">dawn-cut</span>
      </div>
      <span
        className="privacy-badge"
        data-testid="privacy-badge"
        title="모든 처리(자막 생성·인코딩)가 이 기기 안에서만 일어납니다. 영상은 업로드되지 않습니다."
      >
        <Lock size={12} strokeWidth={2} /> 로컬 전용
      </span>
      <div className="sep" />
      <div className="group">
        <button
          type="button"
          className="btn"
          data-testid="import-button"
          onClick={async () => {
            const p = await pickOpen();
            if (p) await s.importPath(p);
          }}
        >
          가져오기
        </button>
        <button
          type="button"
          className="btn"
          data-testid="open-project"
          onClick={async () => {
            const p = await pickOpen();
            if (p) await s.openProject(p);
          }}
        >
          열기
        </button>
        <button
          type="button"
          className="btn"
          data-testid="save-project"
          disabled={!s.timeline}
          onClick={async () => {
            const p = await pickSave();
            if (p) await s.saveProject(p);
          }}
        >
          저장
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        <button
          type="button"
          className="btn ghost"
          data-testid="undo"
          disabled={!s.canUndo}
          onClick={() => s.undo()}
        >
          <Undo2 size={14} /> 되돌리기
        </button>
        <button
          type="button"
          className="btn ghost"
          data-testid="redo"
          disabled={!s.canRedo}
          onClick={() => s.redo()}
        >
          <Redo2 size={14} /> 다시하기
        </button>
      </div>
      <div className="spacer" />
      <div className="group">
        <button
          type="button"
          className="btn"
          data-testid="remove-silences"
          disabled={!s.timeline}
          onClick={() => s.removeSilencesAction()}
        >
          <Scissors size={14} /> 무음 제거
        </button>
        <SilenceMenu />
        <button
          type="button"
          className="btn"
          data-testid="delete-selection"
          disabled={s.selected.length === 0}
          onClick={() => s.deleteSelection()}
        >
          삭제 ({s.selected.length})
        </button>
        <div className="sep" />
        <div className="menu-wrap">
          <button
            type="button"
            className="btn primary"
            disabled={!s.timeline}
            onClick={() => setMenu((v) => !v)}
          >
            내보내기 <ChevronDown size={14} />
          </button>
          {menu && (
            <div className="menu">
              <button
                type="button"
                data-testid="export-button"
                onClick={() => exportAs(s.exportTo)}
              >
                <span>영상 — MP4 (자막 트랙 포함)</span>
                <span className="k badge live">바로</span>
              </button>
              <button
                type="button"
                data-testid="export-gif"
                onClick={() => exportAs((p) => s.exportVideo(p, 'gif'))}
              >
                <span>움짤 GIF</span>
                <span className="k badge live">바로</span>
              </button>
              <button type="button" data-testid="export-srt" onClick={() => exportAs(s.exportSrt)}>
                <span>자막 — .srt</span>
                <span className="k badge live">바로</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PingDot() {
  const [ok, setOk] = useState(false);
  return (
    <>
      <button
        type="button"
        className="dot"
        data-testid="ping-button"
        data-ok={ok ? 'true' : 'false'}
        title="bridge health"
        onClick={async () => setOk((await window.dawn?.ping()) === 'pong')}
      />
      <output
        data-testid="pong"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}
      >
        {ok ? 'pong' : ''}
      </output>
    </>
  );
}

// ── Left rail + dock panels ──────────────────────────────────────────
const RAIL: { id: PanelId; ico: LucideIcon; label: string; short: string }[] = [
  { id: 'media', ico: Film, label: '미디어', short: '미디어' },
  { id: 'text', ico: Mic, label: '음성 · TTS', short: '음성' },
  { id: 'sticker', ico: Sparkles, label: '스티커 · GIF', short: '스티커' },
  { id: 'effect', ico: SlidersHorizontal, label: '효과 · 색보정', short: '효과' },
];

function Rail() {
  const { panel, setPanel, advanced } = useEditor();
  // 단순(쇼케이스) 모드는 미디어 + 효과만 — 오버레이/스티커·TTS 패널은 고급에서.
  const items = advanced ? RAIL : RAIL.filter((r) => r.id === 'media' || r.id === 'effect');
  return (
    <div className="rail">
      {items.map((r) => (
        <button
          key={r.id}
          type="button"
          data-testid={`rail-${r.id}`}
          className={panel === r.id ? 'on' : ''}
          onClick={() => setPanel(r.id)}
          title={r.label}
        >
          <span className="ico">
            <r.ico size={19} strokeWidth={1.75} />
          </span>
          {r.short}
        </button>
      ))}
    </div>
  );
}

function Dropzone({ onFiles, hint }: { onFiles: (f: File[]) => void; hint: string }) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFiles(Array.from(e.dataTransfer.files));
  };
  return (
    <>
      <div
        className={`dropzone${over ? ' over' : ''}`}
        data-testid="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        onClick={() => ref.current?.click()}
      >
        <span className="dz-icon">
          <ArrowUpToLine size={22} strokeWidth={1.75} />
        </span>
        {hint}
      </div>
      <input
        ref={ref}
        type="file"
        hidden
        onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
      />
    </>
  );
}

function MediaPanel() {
  const {
    mediaPath,
    previewPath,
    proxyBusy,
    transcript,
    status,
    importPath,
    clearMedia,
    overlays,
    addImageOverlay,
    addOverlaySrc,
    removeOverlay,
    clearOverlaysByKind,
    selectedOverlayId,
    selectOverlay,
  } = useEditor();
  const imageOverlays = overlays.filter((o) => o.kind === 'image' || o.kind === 'gif');
  const handle = (files: File[]) => {
    for (const f of files) {
      const p = filePath(f);
      if (!p) continue;
      if (isVideo(f.name)) importPath(p);
      else if (isGif(f.name)) addOverlaySrc('gif', f.name, p);
      else if (isImage(f.name)) addImageOverlay(p);
    }
  };
  return (
    <div className="dock-body">
      <Dropzone
        onFiles={handle}
        hint="영상이나 이미지를 끌어다 놓거나 클릭해서 선택하세요. 영상은 바로 불러오고(자막은 '자막 생성' 버튼), 이미지는 오버레이로 붙습니다."
      />
      {mediaPath && (
        <div className="asset-card">
          <div className="thumb">🎬</div>
          <div className="meta">
            <div className="name">{mediaPath.split('/').pop()}</div>
            <div className="sub">
              {transcript
                ? `자막 어절 ${transcript.order.length}개`
                : status === 'transcribing' || status === 'extracting'
                  ? '자막 생성 중…'
                  : "자막 없음 — '자막 생성' 버튼"}
            </div>
          </div>
          <span className="badge live" data-testid="media-badge">
            {proxyBusy ? '변환 중' : previewPath && previewPath !== mediaPath ? '프록시' : '원본'}
          </span>
          <button
            type="button"
            className="x"
            data-testid="clear-media"
            onClick={clearMedia}
            title="이 영상 치우기 (편집 초기화)"
            aria-label="영상 제거"
          >
            ✕
          </button>
        </div>
      )}
      {imageOverlays.map((o) => (
        <div
          className={`asset-card ov-row${selectedOverlayId === o.id ? ' on' : ''}`}
          key={o.id}
          onClick={() => selectOverlay(o.id)}
        >
          <OvBadge n={laneNumber(overlays, o.id)} id={o.id} />
          <div className="thumb">{o.kind === 'gif' ? 'GIF' : '🖼'}</div>
          <div className="meta">
            <div className="name">{o.name}</div>
            <div className="sub">
              {o.kind} · {fmt(o.startUs)}~{fmt(o.endUs)} (타임라인 #{laneNumber(overlays, o.id)})
            </div>
          </div>
          <button
            type="button"
            className="x"
            onClick={(e) => {
              e.stopPropagation();
              removeOverlay(o.id);
            }}
            title="삭제 (Delete/Backspace로도 가능)"
          >
            ✕
          </button>
        </div>
      ))}
      {imageOverlays.length > 1 && (
        <button
          type="button"
          className="btn ghost"
          data-testid="clear-image-overlays"
          onClick={() => {
            clearOverlaysByKind('image');
            clearOverlaysByKind('gif');
          }}
          style={{ marginTop: 8, fontSize: 11 }}
        >
          ✕ clear all ({imageOverlays.length})
        </button>
      )}
      <p className="muted-note">
        이미지·GIF를 끌어다 놓으면 오버레이로 합성됩니다. 움직이는 GIF는 자연스럽게 반복됩니다.
      </p>
    </div>
  );
}

// 비-macOS/테스트 등 보이스 목록을 못 받을 때의 폴백(한국어 우선).
const FALLBACK_VOICES = [
  { name: 'Yuna', lang: 'ko_KR' },
  { name: 'Samantha', lang: 'en_US' },
];
const VOICE_LANG_KO: Record<string, string> = {
  ko: '한국어',
  en: '영어',
  ja: '일본어',
  zh: '중국어',
  es: '스페인어',
  fr: '프랑스어',
  de: '독일어',
  it: '이탈리아어',
  pt: '포르투갈어',
  ru: '러시아어',
};
const isKoLang = (lang: string) => lang.toLowerCase().startsWith('ko');
const langLabel = (lang: string) => VOICE_LANG_KO[lang.slice(0, 2).toLowerCase()] ?? lang;

function TextPanel() {
  const { ttsClips, generateVoiceover, selectedVoiceId, selectVoice, removeTts } = useEditor();
  const [voices, setVoices] = useState<{ name: string; lang: string }[]>([]);
  const [voice, setVoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  // 설치된 보이스를 동적으로 채운다(이전엔 Aria/Nova 같은 미설치 가짜 이름이라 무음이었음).
  // 한국어 보이스를 맨 위 + 기본 선택으로 둬서 한국어가 바로 된다.
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = (await window.dawn?.listTtsVoices?.()) ?? [];
      const vs = (list.length ? list : FALLBACK_VOICES)
        .slice()
        .sort(
          (a, b) =>
            (isKoLang(b.lang) ? 1 : 0) - (isKoLang(a.lang) ? 1 : 0) || a.name.localeCompare(b.name),
        );
      if (!alive) return;
      setVoices(vs);
      setVoice((vs.find((v) => isKoLang(v.lang)) ?? vs[0])?.name ?? '');
    })();
    return () => {
      alive = false;
    };
  }, []);
  const koAvailable = voices.some((v) => isKoLang(v.lang));
  return (
    <div className="dock-body">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>AI 보이스 (TTS)</strong>
        <span className="badge live">내보낼 때 합쳐짐</span>
      </div>
      <label className="field" htmlFor="tts-voice">
        보이스
      </label>
      <select
        id="tts-voice"
        className="select"
        value={voice}
        onChange={(e) => setVoice(e.target.value)}
      >
        {voices.map((v) => (
          <option key={v.name} value={v.name}>
            {v.name} · {langLabel(v.lang)}
          </option>
        ))}
      </select>
      <label className="field" htmlFor="tts-text">
        대본
      </label>
      <textarea
        id="tts-text"
        className="textarea"
        placeholder="AI 보이스가 읽을 내용을 입력하세요 — 한국어 지원"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        className="btn primary full"
        data-testid="generate-voiceover"
        disabled={!text.trim() || busy}
        style={{ justifyContent: 'center' }}
        onClick={async () => {
          setBusy(true);
          try {
            await generateVoiceover(voice, text.trim());
            setText('');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          '… 합성 중'
        ) : (
          <>
            <Mic size={14} /> 보이스 생성
          </>
        )}
      </button>
      {!koAvailable && (
        <p className="muted-note" data-testid="tts-no-korean" style={{ color: '#ffb86b' }}>
          한국어 보이스가 설치돼 있지 않아요. 시스템 설정 ▸ 손쉬운 사용 ▸ 음성 콘텐츠 ▸ 시스템 음성
          ▸ 음성 관리에서 <b>한국어(유나)</b>를 받으면 한국어 음성이 됩니다.
        </p>
      )}
      {ttsClips.map((c) => (
        <div
          className={`list-row ov-row${selectedVoiceId === c.id ? ' on' : ''}`}
          key={c.id}
          onClick={() => selectVoice(c.id)}
        >
          <Volume2 size={15} style={{ flex: '0 0 auto', color: 'var(--ok)' }} />
          <div className="t">
            {c.voice}
            <small>
              {fmt(c.startUs)} · {c.text.slice(0, 34)}
              {c.text.length > 34 ? '…' : ''}
            </small>
          </div>
          <button
            type="button"
            className="x"
            data-testid="tts-remove"
            onClick={(e) => {
              e.stopPropagation();
              removeTts(c.id);
            }}
            title="삭제 (Delete/Backspace로도 가능)"
          >
            ✕
          </button>
        </div>
      ))}
      <p className="muted-note">
        텍스트를 실제 음성으로 합성해 <b>내보낼 때 영상에 믹스</b>합니다. 한글이면 한국어 보이스로
        자동 전환돼요. 타임라인에서 위치·길이를 드래그로 맞출 수 있습니다.
      </p>
    </div>
  );
}

const STICKERS = ['🔥', '🎉', '⭐', '😂', '👍', '💯', '🎬', '📸', '😍', '👀', '✅', '❗'];

/** Rasterize via a DOM canvas using a shared core primitive (same code path as headless tests). */
function rasterizeWith(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  return c.toDataURL('image/png');
}
const rasterizeEmoji = (emoji: string) =>
  rasterizeWith(256, 256, (ctx, w, h) => drawEmoji(ctx, w, h, emoji));
const rasterizeBadge = (text: string) =>
  rasterizeWith(420, 160, (ctx, w, h) => drawBadge(ctx, w, h, text));

function StickerPanel() {
  const { overlays, addOverlaySrc, removeOverlay, selectedOverlayId, selectOverlay } = useEditor();
  const add = async (kind: 'sticker' | 'gif', name: string, dataUrl: string) => {
    const res = await window.dawn?.writeAsset(dataUrl);
    if (res) addOverlaySrc(kind, name, res.path);
  };
  return (
    <div className="dock-body">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Stickers & GIF</strong>
        <span className="badge live">composites</span>
      </div>
      <div className="field">Stickers</div>
      <div className="sticker-grid">
        {STICKERS.map((e) => (
          <button key={e} type="button" onClick={() => add('sticker', e, rasterizeEmoji(e))}>
            {e}
          </button>
        ))}
      </div>
      <div className="field">Trending GIF (text badge)</div>
      <div className="sticker-grid">
        {['LOL', 'WOW', 'OMG', 'YES', 'NICE', 'WTF', 'BRB', 'GG'].map((g) => (
          <button
            key={g}
            type="button"
            style={{ fontSize: 11, fontWeight: 700 }}
            onClick={() => add('gif', g, rasterizeBadge(g))}
          >
            {g}
          </button>
        ))}
      </div>
      {overlays
        .filter((o) => o.kind !== 'image')
        .map((o) => (
          <div
            className={`list-row ov-row${selectedOverlayId === o.id ? ' on' : ''}`}
            key={o.id}
            onClick={() => selectOverlay(o.id)}
          >
            <OvBadge n={laneNumber(overlays, o.id)} id={o.id} />
            <div className="t">
              {o.kind === 'sticker' ? o.name : `GIF · ${o.name}`}
              <small>
                {o.kind} · {fmt(o.startUs)}~{fmt(o.endUs)} (타임라인 #{laneNumber(overlays, o.id)})
              </small>
            </div>
            <button
              type="button"
              className="x"
              onClick={(e) => {
                e.stopPropagation();
                removeOverlay(o.id);
              }}
              title="삭제 (Delete/Backspace로도 가능)"
            >
              ✕
            </button>
          </div>
        ))}
      <p className="muted-note">
        Stickers & text badges rasterize to PNG and composite onto the video for real (preview +
        export). Animated GIF overlays are still on the roadmap.
      </p>
    </div>
  );
}

const COLOR_PRESET_OPTS: { id: ColorPreset; label: string }[] = [
  { id: 'none', label: '없음' },
  { id: 'vivid', label: '화사하게 (vivid · 1탭)' },
  { id: 'warm', label: '따뜻하게 (warm)' },
  { id: 'cool', label: '차갑게 (cool)' },
  { id: 'punch', label: '선명하게 (punch)' },
  { id: 'cinematic', label: '시네마틱 (cinematic)' },
  { id: 'flat', label: '플랫 (flat)' },
];
// 프리뷰용 CSS 근사(익스포트는 ffmpeg eq/curves로 정확히 적용). 1:1 아님, 분위기 미리보기.
const CSS_COLOR_APPROX: Record<ColorPreset, string> = {
  none: 'none',
  vivid: 'saturate(1.6) contrast(1.15) brightness(1.03) sepia(0.08)',
  warm: 'saturate(1.05) sepia(0.16)',
  cool: 'saturate(1.02) hue-rotate(-12deg) brightness(1.0)',
  punch: 'contrast(1.3) saturate(1.4) brightness(1.02)',
  cinematic: 'contrast(1.3) saturate(0.7) brightness(0.98)',
  flat: 'contrast(0.82) saturate(0.78)',
};

// 자동 보정 eq → 프리뷰용 CSS 필터 근사(익스포트는 ffmpeg eq로 정확). 분위기 미리보기.
function cssFromEq(eq: ColorEq | null): string | null {
  if (!eq) return null;
  const parts: string[] = [];
  if (eq.brightness != null) parts.push(`brightness(${(1 + eq.brightness).toFixed(3)})`);
  if (eq.contrast != null) parts.push(`contrast(${eq.contrast.toFixed(3)})`);
  if (eq.saturation != null) parts.push(`saturate(${eq.saturation.toFixed(3)})`);
  return parts.length ? parts.join(' ') : null;
}

const REFRAME_OPTS: { id: 'source' | '9:16' | '1:1'; label: string }[] = [
  { id: 'source', label: '원본 비율' },
  { id: '9:16', label: '세로 9:16 (쇼츠/릴스)' },
  { id: '1:1', label: '정사각 1:1' },
];

function EffectPanel() {
  const {
    colorPreset,
    setColorPreset,
    reframe,
    setReframe,
    timeline,
    mediaPath,
    autoEnhance,
    autoEnhanceEq,
  } = useEditor();
  return (
    <div className="dock-body">
      <strong style={{ fontSize: 13 }}>자동 보정 (Auto)</strong>
      <button
        type="button"
        className="btn primary"
        data-testid="auto-enhance"
        disabled={!timeline || !mediaPath}
        onClick={() => void autoEnhance()}
        title="영상을 분석해 밝기·대비·채도를 자동으로 보정합니다 (1탭)"
        style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
      >
        <Wand2 size={14} /> 자동 보정 (1탭)
      </button>
      {autoEnhanceEq && (
        <p className="muted-note" data-testid="auto-enhance-applied" style={{ marginTop: 6 }}>
          적용됨 · 채도 ×{autoEnhanceEq.saturation?.toFixed(2)} · 대비 ×
          {autoEnhanceEq.contrast?.toFixed(2)} · 밝기 {autoEnhanceEq.brightness! >= 0 ? '+' : ''}
          {autoEnhanceEq.brightness?.toFixed(2)} (⌘Z로 되돌리기)
        </p>
      )}
      <strong style={{ fontSize: 13, marginTop: 12, display: 'block' }}>색보정 (Color)</strong>
      <label className="ov-field" style={{ marginTop: 8 }}>
        프리셋
        <select
          className="select"
          data-testid="color-preset"
          value={colorPreset}
          disabled={!timeline}
          onChange={(e) => setColorPreset(e.target.value as ColorPreset)}
        >
          {COLOR_PRESET_OPTS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <strong style={{ fontSize: 13, marginTop: 12, display: 'block' }}>비율 (Reframe)</strong>
      <label className="ov-field" style={{ marginTop: 8 }}>
        익스포트 비율
        <select
          className="select"
          data-testid="reframe"
          value={reframe}
          disabled={!timeline}
          onChange={(e) => setReframe(e.target.value as 'source' | '9:16' | '1:1')}
        >
          {REFRAME_OPTS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted-note">
        프리뷰는 <b>CSS 근사</b>, 익스포트는 FFmpeg(eq/curves)로 정확히 적용됩니다. 9:16/1:1은
        익스포트 시 중앙 크롭됩니다.
      </p>
    </div>
  );
}

function Dock() {
  const { panel } = useEditor();
  const titles: Record<PanelId, string> = {
    media: 'Media',
    text: 'Text · TTS',
    sticker: 'Sticker · GIF',
    effect: 'Effects',
  };
  return (
    <div className="dock">
      <div className="dock-head">{titles[panel]}</div>
      {panel === 'media' && <MediaPanel />}
      {panel === 'text' && <TextPanel />}
      {panel === 'sticker' && <StickerPanel />}
      {panel === 'effect' && <EffectPanel />}
    </div>
  );
}

// ── Preview ──────────────────────────────────────────────────────────
function Preview() {
  const {
    timeline,
    mediaPath,
    previewPath,
    proxyBusy,
    playheadUs,
    playing,
    setPlayhead,
    setPlaying,
    durationProgramUs,
    importPath,
    addImageOverlay,
    addOverlaySrc,
    overlays,
    selectedOverlayId,
    selectOverlay,
    updateOverlay,
    removeOverlay,
    colorPreset,
    autoEnhanceEq,
  } = useEditor();
  const selectedOverlay = overlays.find((o) => o.id === selectedOverlayId) ?? null;
  // 프리뷰 필터 = 색보정 프리셋 근사 + 자동 보정 eq 근사(둘 다 CSS, 익스포트는 ffmpeg 정확).
  const previewFilter =
    [colorPreset !== 'none' ? CSS_COLOR_APPROX[colorPreset] : null, cssFromEq(autoEnhanceEq)]
      .filter(Boolean)
      .join(' ') || undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // 미리보기 디코드 실패 표시. 새 소스(원본→프록시 교체 포함)가 바뀌면 리셋.
  const [videoErr, setVideoErr] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the preview source changes
  useEffect(() => setVideoErr(false), [previewPath]);
  const drag = useRef<{
    id: string;
    mode: 'move' | 'resize';
    px: number;
    py: number;
    ox: number;
    oy: number;
    oscale: number;
  } | null>(null);
  const visibleOverlays = overlays.filter((o) => playheadUs >= o.startUs && playheadUs < o.endUs);

  const onOvPointerDown = (e: PointerEvent<HTMLElement>, id: string, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    const o = overlays.find((x) => x.id === id);
    if (!o) return;
    selectOverlay(id);
    drag.current = { id, mode, px: e.clientX, py: e.clientY, ox: o.x, oy: o.y, oscale: o.scale };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onOvPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const dx = (e.clientX - d.px) / rect.width;
    const dy = (e.clientY - d.py) / rect.height;
    if (d.mode === 'move') {
      const m = moveOverlay({ x: d.ox, y: d.oy, scale: d.oscale }, dx, dy);
      updateOverlay(d.id, { x: m.x, y: m.y });
    } else {
      const r = resizeOverlay({ x: d.ox, scale: d.oscale }, dx);
      updateOverlay(d.id, { scale: r.scale, x: r.x });
    }
  };
  const onOvPointerUp = (e: PointerEvent<HTMLElement>) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  const edl: Edl | null = useMemo(
    () => (timeline && mediaPath ? timelineToEdl(timeline, mediaPath) : null),
    [timeline, mediaPath],
  );

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !edl) return;
    let raf = 0;
    const tick = () => {
      const tUs = v.currentTime * US;
      const seg = edl.segments.find((g) => tUs >= g.sourceStart && tUs < g.sourceEnd);
      if (seg) setPlayhead(seg.programStart + (tUs - seg.sourceStart));
      else {
        const next = edl.segments.find((g) => g.sourceStart > tUs);
        if (next) v.currentTime = next.sourceStart / US;
        else if (playing) {
          v.pause();
          setPlaying(false);
          setPlayhead(edl.totalDuration);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [edl, playing, setPlayhead, setPlaying]);

  // Sync video element play/pause to store `playing` state — lets Space key /
  // external triggers control playback without going through the toolbar button.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !edl) return;
    if (playing) {
      if (playheadUs >= edl.totalDuration - 1)
        v.currentTime = (edl.segments[0]?.sourceStart ?? 0) / US;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [playing, edl, playheadUs]);

  // Seek the video element when playhead changes externally (arrow keys / scrub).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !edl || playing) return;
    const seg =
      edl.segments.find(
        (g) =>
          playheadUs >= g.programStart &&
          playheadUs < g.programStart + (g.sourceEnd - g.sourceStart),
      ) ?? edl.segments.at(-1);
    if (seg) {
      const target = (seg.sourceStart + (playheadUs - seg.programStart)) / US;
      if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
    }
  }, [playheadUs, edl, playing]);

  const toggle = () => {
    if (!edl) return;
    setPlaying(!playing);
  };
  const seek = (e: MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !edl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const prog = ratio * edl.totalDuration;
    const seg =
      edl.segments.find(
        (g) => prog >= g.programStart && prog < g.programStart + (g.sourceEnd - g.sourceStart),
      ) ?? edl.segments.at(-1);
    if (seg) v.currentTime = (seg.sourceStart + (prog - seg.programStart)) / US;
    setPlayhead(prog);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    for (const f of Array.from(e.dataTransfer.files)) {
      const p = filePath(f);
      if (!p) continue;
      if (isVideo(f.name)) importPath(p);
      else if (isGif(f.name)) addOverlaySrc('gif', f.name, p);
      else if (isImage(f.name)) addImageOverlay(p);
    }
  };
  const ratio = durationProgramUs > 0 ? playheadUs / durationProgramUs : 0;
  return (
    <div className="preview">
      <div
        className="stage"
        onDragOver={(e) => e.preventDefault()}
        onDrop={drop}
        onClick={(e) => {
          if (e.target === e.currentTarget) selectOverlay(null);
        }}
      >
        {mediaPath ? (
          <div className="video-frame" ref={frameRef}>
            {previewPath ? (
              <video
                ref={videoRef}
                // 한글/공백 경로도 열리도록 인코딩. 미리보기는 previewPath(원본 또는 변환된 프록시).
                src={`file://${encodeURI(previewPath)}`}
                preload="auto"
                onEnded={() => setPlaying(false)}
                onError={() => setVideoErr(true)}
                onLoadedData={() => setVideoErr(false)}
                style={previewFilter ? { filter: previewFilter } : undefined}
              />
            ) : (
              <div className="video-err" data-testid="proxy-busy">
                <div className="big">미리보기 준비 중…</div>
                <div className="sub">
                  큰/고레벨 영상을 미리보기용으로 변환하고 있어요(몇 초).
                  <br />
                  편집·자막·내보내기는 지금도 됩니다.
                </div>
              </div>
            )}
            {previewPath && videoErr && (
              <div className="video-err" data-testid="video-error">
                <div className="big">미리보기를 재생할 수 없어요</div>
                <div className="sub">
                  이 영상은 미리보기 플레이어가 디코드하지 못합니다.
                  <br />
                  편집·자막·내보내기는 그대로 동작합니다.
                </div>
              </div>
            )}
            {visibleOverlays.map((o) => (
              <div
                key={o.id}
                className={`ov editable${selectedOverlayId === o.id ? ' selected' : ''}`}
                data-testid="overlay"
                data-id={o.id}
                data-x={o.x.toFixed(4)}
                data-y={o.y.toFixed(4)}
                data-scale={o.scale.toFixed(4)}
                style={{
                  left: `${o.x * 100}%`,
                  top: `${o.y * 100}%`,
                  width: `${o.scale * 100}%`,
                  opacity: o.opacity,
                }}
                onPointerDown={(e) => onOvPointerDown(e, o.id, 'move')}
                onPointerMove={onOvPointerMove}
                onPointerUp={onOvPointerUp}
              >
                {o.src ? (
                  <img src={`file://${o.src}`} alt={o.name} draggable={false} />
                ) : (
                  <span className="ov-emoji">{o.name}</span>
                )}
                {selectedOverlayId === o.id && (
                  <span
                    className="ov-handle"
                    data-testid="overlay-resize"
                    onPointerDown={(e) => onOvPointerDown(e, o.id, 'resize')}
                    onPointerMove={onOvPointerMove}
                    onPointerUp={onOvPointerUp}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-stage">
            <div className="big">Drop a video here</div>
            <div>or click “Import” — dawn-cut transcribes it automatically.</div>
          </div>
        )}
      </div>
      {mediaPath && (
        <div className="controls">
          <button type="button" className="play-btn" data-testid="play" onClick={toggle}>
            {playing ? (
              <Pause size={17} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={17} fill="currentColor" strokeWidth={0} style={{ marginLeft: 2 }} />
            )}
          </button>
          <span className="time">
            {fmt(playheadUs)} / {fmt(durationProgramUs)}
          </span>
          <div className="scrub" onClick={seek}>
            <div className="fill" style={{ width: `${ratio * 100}%` }} />
          </div>
        </div>
      )}
      {selectedOverlay && (
        <div className="ov-props" data-testid="overlay-props">
          <span className="ov-props-title">
            {selectedOverlay.kind !== 'subtitle' && (
              <OvBadge n={laneNumber(overlays, selectedOverlay.id)} id={selectedOverlay.id} />
            )}
            {selectedOverlay.name}
          </span>
          <span className="ov-props-hint">
            드래그=위치 · {fmt(selectedOverlay.startUs)}~{fmt(selectedOverlay.endUs)} (
            {fmt(selectedOverlay.endUs - selectedOverlay.startUs)} 동안 표시)
          </span>
          <label className="ov-field">
            크기 {Math.round(selectedOverlay.scale * 100)}%
            <input
              type="range"
              min={3}
              max={100}
              value={Math.round(selectedOverlay.scale * 100)}
              onChange={(e) =>
                updateOverlay(selectedOverlay.id, { scale: Number(e.target.value) / 100 })
              }
            />
          </label>
          <label className="ov-field">
            투명도 {Math.round(selectedOverlay.opacity * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(selectedOverlay.opacity * 100)}
              onChange={(e) =>
                updateOverlay(selectedOverlay.id, { opacity: Number(e.target.value) / 100 })
              }
            />
          </label>
          <label className="ov-field">
            시작 {fmt(selectedOverlay.startUs)}
            <input
              type="range"
              min={0}
              max={durationProgramUs}
              value={selectedOverlay.startUs}
              onChange={(e) =>
                updateOverlay(
                  selectedOverlay.id,
                  clampRange(Number(e.target.value), selectedOverlay.endUs, durationProgramUs),
                )
              }
            />
          </label>
          <label className="ov-field">
            끝 {fmt(selectedOverlay.endUs)}
            <input
              type="range"
              min={0}
              max={durationProgramUs}
              value={selectedOverlay.endUs}
              onChange={(e) =>
                updateOverlay(
                  selectedOverlay.id,
                  clampRange(selectedOverlay.startUs, Number(e.target.value), durationProgramUs),
                )
              }
            />
          </label>
          <label className="ov-field">
            이동 x(끝위치)
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((selectedOverlay.to?.x ?? selectedOverlay.x) * 100)}
              onChange={(e) =>
                updateOverlay(selectedOverlay.id, {
                  to: { ...selectedOverlay.to, x: Number(e.target.value) / 100 },
                })
              }
            />
          </label>
          <label className="ov-field">
            이동 y(끝위치)
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((selectedOverlay.to?.y ?? selectedOverlay.y) * 100)}
              onChange={(e) =>
                updateOverlay(selectedOverlay.id, {
                  to: { ...selectedOverlay.to, y: Number(e.target.value) / 100 },
                })
              }
            />
          </label>
          <label className="ov-field">
            회전 {selectedOverlay.rotation ?? 0}°
            <input
              type="range"
              min={-180}
              max={180}
              value={selectedOverlay.rotation ?? 0}
              onChange={(e) =>
                updateOverlay(selectedOverlay.id, { rotation: Number(e.target.value) })
              }
            />
          </label>
          <button
            type="button"
            className="btn ghost"
            data-testid="overlay-clear-anim"
            onClick={() =>
              updateOverlay(selectedOverlay.id, { to: undefined, rotation: undefined })
            }
          >
            <RotateCcw size={13} /> 애니 초기화
          </button>
          {selectedOverlay.kind === 'subtitle' && selectedOverlay.text && (
            <CueEditor overlay={selectedOverlay} onUpdate={updateOverlay} />
          )}
          <button
            type="button"
            className="btn ghost"
            data-testid="overlay-remove"
            onClick={() => removeOverlay(selectedOverlay.id)}
          >
            ✕ 이 오버레이 제거
          </button>
          <span className="ov-props-hint">키보드 Delete / Backspace 로도 삭제됩니다.</span>
        </div>
      )}
    </div>
  );
}

function CueEditor({
  overlay,
  onUpdate,
}: {
  overlay: { id: string; text?: string; cueStyle?: SubtitleStyle };
  onUpdate: (id: string, patch: { text?: string; cueStyle?: SubtitleStyle; src?: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const emphasizeKeywords = useEditor((s) => s.subtitleStyle.emphasizeKeywords ?? false);
  const reRasterize = async (text: string, style: SubtitleStyle) => {
    setBusy(true);
    try {
      const res = await window.dawn?.writeAsset(
        rasterizeSubtitle(
          wrapCaption(text, { maxCharsPerLine: 16, maxLines: 2 }),
          style,
          emphasisFor(text, emphasizeKeywords),
        ),
      );
      if (res) onUpdate(overlay.id, { text, cueStyle: style, src: res.path });
    } finally {
      setBusy(false);
    }
  };
  const style = overlay.cueStyle ?? {};
  return (
    <>
      <label className="ov-field" style={{ flexBasis: '100%' }}>
        caption
        <input
          className="input"
          data-testid="cue-text"
          defaultValue={overlay.text}
          disabled={busy}
          onBlur={(e) => {
            const t = e.target.value.trim();
            if (t && t !== overlay.text) reRasterize(t, style);
          }}
          style={{ flex: 1 }}
        />
      </label>
      <label className="ov-field">
        cue color
        <input
          type="color"
          data-testid="cue-color"
          value={style.color ?? '#ffffff'}
          disabled={busy}
          onChange={(e) => reRasterize(overlay.text ?? '', { ...style, color: e.target.value })}
        />
      </label>
    </>
  );
}

// ── Transcript (hero) ────────────────────────────────────────────────
const rasterizeSubtitle = (
  text: string,
  style: SubtitleStyle = {},
  emphasis?: ReadonlySet<string>,
) => rasterizeWith(1000, 150, (ctx, w, h) => drawSubtitle(ctx, w, h, text, style, emphasis));

// 키워드 강조 집합. drawSubtitle은 어절의 구두점을 떼고 비교하므로(STRIP_PUNCT_RE),
// pickKeywords의 표면형도 동일하게 코어로 정규화해 넣어야 매칭된다.
const EMPH_STRIP = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
const emphasisFor = (cueText: string, on: boolean): ReadonlySet<string> | undefined =>
  on ? new Set(pickKeywords(cueText).map((w) => w.replace(EMPH_STRIP, ''))) : undefined;

// 자막 미리보기 = 실제 영상 프레임(16:9 무대) 위에 '내보내기와 동일한' 자막 밴드를 놓은 것.
// 밴드는 export 래스터(1000×150, 20:3)와 같은 비율·위치(subtitlePos)로 그려져 WYSIWYG다.
// 위치(x/y)·크기(scale)가 무대 위 밴드에 그대로 반영돼 앵커 그리드가 직관적으로 연결된다.
function SubtitlePreview({
  style,
  text,
  emphasis,
  pos,
}: {
  style: SubtitleStyle;
  text?: string;
  emphasis?: ReadonlySet<string>;
  pos: { x: number; y: number; scale: number };
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const stage = stageRef.current;
    const c = ref.current;
    if (!stage || !c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    // 무대 실측치로 그린다. 최초 마운트 땐 레이아웃(aspect-ratio)이 잡히기 전이라 clientW/H가
    // 0일 수 있으므로 ResizeObserver로 크기 확정 후 다시 그린다(밴드 위치가 어긋나지 않게).
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const stageW = stage.clientWidth;
      const stageH = stage.clientHeight;
      if (stageW < 8 || stageH < 8) return; // 레이아웃 전 — observer가 다시 부른다
      const bandW = Math.max(48, Math.round(stageW * pos.scale));
      const bandH = Math.max(14, Math.round(bandW * 0.15)); // export raster 1000:150 비율
      // 레티나 선명도: 백킹 캔버스를 dpr배로, CSS 크기는 논리 픽셀로.
      c.width = Math.round(bandW * dpr);
      c.height = Math.round(bandH * dpr);
      c.style.width = `${bandW}px`;
      c.style.height = `${bandH}px`;
      c.style.left = `${Math.round(Math.min(Math.max(0, pos.x), Math.max(0, 1 - pos.scale)) * stageW)}px`;
      c.style.top = `${Math.round(Math.min(Math.max(0, pos.y), 1) * Math.max(0, stageH - bandH))}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, bandW, bandH);
      drawSubtitle(ctx, bandW, bandH, text?.trim() ? text : '자막 미리보기', style, emphasis);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [style, text, emphasis, pos.x, pos.y, pos.scale]);
  return (
    <div className="sub-stage" ref={stageRef}>
      <span className="sub-stage-tag">미리보기</span>
      <canvas className="sub-band" ref={ref} data-testid="sub-preview" />
    </div>
  );
}

const ANCHORS: { id: string; label: string; x: number; y: number }[] = [
  { id: 'tl', label: '↖', x: 0.02, y: 0.02 },
  { id: 'tc', label: '↑', x: 0.1, y: 0.02 },
  { id: 'tr', label: '↗', x: 0.18, y: 0.02 },
  { id: 'ml', label: '←', x: 0.02, y: 0.45 },
  { id: 'mc', label: '·', x: 0.1, y: 0.45 },
  { id: 'mr', label: '→', x: 0.18, y: 0.45 },
  { id: 'bl', label: '↙', x: 0.02, y: 0.85 },
  { id: 'bc', label: '↓', x: 0.1, y: 0.85 },
  { id: 'br', label: '↘', x: 0.18, y: 0.85 },
];
// x is the left edge of the rasterized subtitle (scale = width fraction).
// horizontal anchors assume scale=0.8: L=0.02, C=(1-0.8)/2=0.1, R=1-0.8-0.02=0.18
function anchorXForScale(anchorX: number, scale: number): number {
  if (anchorX < 0.05) return 0.02;
  if (anchorX > 0.15) return Math.max(0, 1 - scale - 0.02);
  return (1 - scale) / 2;
}

// EditCommand verb → 사람친화 라벨(자연어 제안 카드용).
const CMD_LABEL: Record<string, string> = {
  removeFillers: '말버릇 제거',
  deleteWordRange: '단어 컷',
  removeSilences: '무음 제거',
  cutSourceRange: '구간 컷',
  applyGlossary: '사전 치환',
  setSubtitleStyle: '자막 스타일',
  replaceSubtitleStyle: '자막 프리셋',
  applyColorgrade: '색보정',
  applyZoom: '펀치인 줌',
};

// 내 사전(고유명사 교정쌍) 추가 입력.
function GlossaryAdd({ onAdd }: { onAdd: (from: string, to: string) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const submit = () => {
    if (!from.trim()) return;
    onAdd(from, to);
    setFrom('');
    setTo('');
  };
  return (
    <div className="glossary-add">
      <input
        className="input"
        data-testid="glossary-from"
        placeholder="잘못 인식 (예: 던컷)"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <span className="arrow">→</span>
      <input
        className="input"
        data-testid="glossary-to"
        placeholder="교정 (예: dawn-cut)"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <button type="button" className="btn ghost" data-testid="glossary-add" onClick={submit}>
        추가
      </button>
    </div>
  );
}

function Transcript() {
  const {
    transcript,
    timeline,
    mediaPath,
    transcribeMedia,
    hasAudio,
    transcribeError,
    status,
    selected,
    playheadUs,
    toggleWord,
    setPlayhead,
    addOverlayWith,
    clearOverlaysByKind,
    overlays,
    subtitlePos,
    setSubtitlePos,
    subtitleStyle,
    setSubtitleStyle,
    replaceSubtitleStyle,
    removeFillers,
    correctWord,
    autoHighlight,
    glossary,
    addGlossaryPair,
    removeGlossaryPair,
    planAndPreview,
    approvePlan,
    rejectPlan,
    applyStylePack,
    pendingPlan,
    planReport,
    nlBusy,
    nlError,
    llmReady,
    advanced,
  } = useEditor();
  const dead = useMemo(() => deadSet(timeline, transcript), [timeline, transcript]);
  const activeId = useMemo(
    () => (timeline && transcript ? programToWord(timeline, transcript, playheadUs) : null),
    [timeline, transcript, playheadUs],
  );
  // 말버릇(음/어…) 어절 — 살아있는 것만 하이라이트/제거 대상.
  const fillerIds = useMemo(
    () => new Set(transcript ? detectFillers(transcript).filter((id) => !dead.has(id)) : []),
    [transcript, dead],
  );
  // dryRun(비파괴 미리보기): 말버릇 제거 시 줄어들 프로그램 길이를 사전에 보여준다.
  const fillerSavedUs = useMemo(() => {
    if (!transcript || !timeline || fillerIds.size === 0) return 0;
    const { report } = dryRunCommands({ timeline, transcript }, [{ type: 'removeFillers' }]);
    return report.ok ? report.removedProgramUs : 0;
  }, [transcript, timeline, fillerIds]);
  // 자막 정확도 검수: STT 신뢰도가 낮은(오인식 의심) 어절을 표시(opt-in '검수 모드').
  const [reviewMode, setReviewMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const uncertainIds = useMemo(
    () =>
      new Set(
        transcript
          ? lowConfidenceWords(transcript)
              .map((w) => w.id)
              .filter((id) => !dead.has(id))
          : [],
      ),
    [transcript, dead],
  );
  // 현재 재생 위치의 cue(원문) — 프리뷰 자막/키워드강조의 단일 출처.
  const currentCue = useMemo(() => {
    if (!transcript || !timeline) return null;
    const cues = transcriptToCues(transcript, timeline);
    return cues.find((c) => playheadUs >= c.startUs && playheadUs < c.endUs) ?? cues[0] ?? null;
  }, [transcript, timeline, playheadUs]);
  const currentCaption = useMemo(
    () => (currentCue ? wrapCaption(currentCue.text, { maxCharsPerLine: 16, maxLines: 2 }) : ''),
    [currentCue],
  );
  // 키워드 강조 on/off는 이제 subtitleStyle.emphasizeKeywords(EditorState, command bus·MCP 구동)에서.
  const emphasizeKeywords = subtitleStyle.emphasizeKeywords ?? false;
  // emphasis Set은 메모이즈(안정 참조)해야 SubtitlePreview useEffect 무한재그림 방지.
  const currentEmphasis = useMemo(
    () => emphasisFor(currentCue?.text ?? '', emphasizeKeywords),
    [currentCue, emphasizeKeywords],
  );
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const genChapters = () => {
    if (transcript && timeline) setChapters(extractChapters(transcript, timeline));
  };
  const copyChapters = () => {
    if (chapters.length) navigator.clipboard?.writeText(formatChapters(chapters));
  };
  const burnt = overlays.some((o) => o.kind === 'subtitle');
  const doBurn = async (
    pos: { x: number; y: number; scale: number },
    style: SubtitleStyle,
    emphOn: boolean = emphasizeKeywords,
  ) => {
    // fresh state를 읽는다 — 스타일 팩처럼 직전에 transcript/timeline을 바꾼(말버릇 컷) 핸들러가
    // 호출해도 stale 클로저로 옛 어절을 번인하지 않게.
    const { transcript: tr, timeline: tl } = useEditor.getState();
    if (!tr || !tl) return;
    // 애니메이션(reveal/karaoke)이면 짧은 쇼츠형 cue로 끊어 단어가 또박또박 등장하게 한다.
    // animation 'none'(또는 미설정)이면 기존 동작 그대로(기본 cue, cue당 1오버레이) — e2e 보존.
    const anim = style.animation ?? 'none';
    const cueOpts =
      anim === 'none' ? {} : { maxWordsPerCue: 4, maxCharsPerCue: 13, maxGapUs: 400_000 };
    for (const c of transcriptToCues(tr, tl, cueOpts)) {
      // 키워드 강조는 줄바꿈 전 원문 c.text로 계산해야 표면형 코어가 일치한다.
      const cueKeys = emphasisFor(c.text, emphOn);
      // cue를 애니 서브프레임으로 펼친다('none'이면 cue 전체 1프레임 → 기존과 동일).
      for (const fr of captionFrames(c, anim)) {
        const emph = anim === 'karaoke' && fr.activeWord ? new Set([fr.activeWord]) : cueKeys;
        const wrapped = wrapCaption(fr.text, { maxCharsPerLine: 16, maxLines: 2 });
        const res = await window.dawn?.writeAsset(rasterizeSubtitle(wrapped, style, emph));
        if (res)
          addOverlayWith({
            kind: 'subtitle',
            name: c.text.slice(0, 24),
            text: fr.text,
            src: res.path,
            x: pos.x,
            y: pos.y,
            scale: pos.scale,
            opacity: 1,
            startUs: fr.startUs,
            endUs: fr.endUs,
            z: 100,
          });
      }
    }
  };
  // Debounced re-burn — slider drags (every onChange tick) used to fire one
  // full re-burn per tick (N cues × IPC writeAsset). Coalesce to the last value.
  const burnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReburn = (pos: { x: number; y: number; scale: number }, style: SubtitleStyle) => {
    if (!burnt) return;
    if (burnTimer.current) clearTimeout(burnTimer.current);
    burnTimer.current = setTimeout(async () => {
      clearOverlaysByKind('subtitle');
      await doBurn(pos, style);
    }, 180);
  };
  const burnSubtitles = async () => {
    if (!transcript || !timeline) return;
    if (burnt) {
      clearOverlaysByKind('subtitle');
      return;
    }
    await doBurn(subtitlePos, subtitleStyle);
  };
  const applyAnchor = async (ax: number, ay: number) => {
    const x = anchorXForScale(ax, subtitlePos.scale);
    const next = { ...subtitlePos, x, y: ay };
    setSubtitlePos({ x, y: ay });
    if (burnt) {
      clearOverlaysByKind('subtitle');
      await doBurn(next, subtitleStyle);
    }
  };
  const applyStyle = (patch: SubtitleStyle) => {
    const next = { ...subtitleStyle, ...patch };
    setSubtitleStyle(patch);
    scheduleReburn(subtitlePos, next);
  };
  const applyEmphasis = async (on: boolean) => {
    // 키워드 강조 = subtitleStyle.emphasizeKeywords (command bus 경유 = highlightKeyword verb와 동일 효과).
    setSubtitleStyle({ emphasizeKeywords: on });
    if (burnt) {
      clearOverlaysByKind('subtitle');
      // 새 토글값으로 재버닝(상태 비동기 회피) — style에도 명시 반영.
      await doBurn(subtitlePos, { ...subtitleStyle, emphasizeKeywords: on }, on);
    }
  };
  const applyPreset = async (presetId: string) => {
    const next = SUBTITLE_PRESETS[presetId] ?? {};
    replaceSubtitleStyle(next);
    if (burnt) {
      clearOverlaysByKind('subtitle');
      await doBurn(subtitlePos, next);
    }
  };
  // 스타일 팩 '진짜 1클릭': command bus로 팩 적용(색+자막스타일/애니+말버릇) 후, 적용된 자막
  // 스타일/애니로 자막을 즉시 (재)번인한다 — 팩을 고르면 화면에 reveal/karaoke가 바로 뜨도록.
  const applyPackAndBurn = async (id: string) => {
    applyStylePack(id);
    const st = useEditor.getState(); // 팩 적용 후 fresh(자막스타일·말버릇 컷 반영).
    if (!st.transcript) return; // 전사 전이면 색/말버릇만 적용(자막은 추후 '자막 입히기').
    clearOverlaysByKind('subtitle');
    await doBurn(subtitlePos, st.subtitleStyle);
  };
  const resetSubtitleSettings = async () => {
    const defaultPos = { x: 0.1, y: 0.8, scale: 0.8 };
    setSubtitlePos(defaultPos);
    replaceSubtitleStyle({});
    if (burnt) {
      clearOverlaysByKind('subtitle');
      await doBurn(defaultPos, {});
    }
  };
  // 검수 교정: 어절 텍스트를 command bus로 고치고(타임스탬프 보존), 번인돼 있으면 재번인.
  const commitWordEdit = async (id: string, text: string) => {
    setEditingId(null);
    const t = text.trim();
    const w = transcript?.words[id];
    if (!t || !w || w.text === t) return;
    correctWord(id, t);
    if (burnt) {
      clearOverlaysByKind('subtitle');
      await doBurn(subtitlePos, subtitleStyle); // doBurn은 fresh getState()로 교정 텍스트 반영
    }
  };
  // 다음 저신뢰 어절로 플레이헤드 이동(검수 동선).
  const jumpNextUncertain = () => {
    if (!timeline || !transcript || uncertainIds.size === 0) return;
    const withProg = [...uncertainIds]
      .map((id) => ({ id, p: wordToProgram(timeline, transcript.words[id]!) }))
      .filter((x) => x.p)
      .sort((a, b) => a.p!.start - b.p!.start);
    const next = withProg.find((x) => x.p!.start > playheadUs + 1) ?? withProg[0];
    if (next?.p) setPlayhead(next.p.start);
  };
  return (
    <div className="transcript">
      <div className="panel-head">
        <h2>자막 · 대본</h2>
        <button
          type="button"
          className="btn ghost"
          data-testid="burn-subtitles"
          disabled={!transcript}
          onClick={burnSubtitles}
          style={{ fontSize: 11, padding: '4px 8px' }}
        >
          {burnt ? (
            <>
              <Check size={13} /> 자막 입힘
            </>
          ) : (
            '자막 입히기'
          )}
        </button>
        <button
          type="button"
          className="btn ghost"
          data-testid="reset-subtitle-settings"
          onClick={resetSubtitleSettings}
          title="Reset subtitle position + style to defaults"
          style={{ fontSize: 11, padding: '4px 8px' }}
        >
          <RotateCcw size={13} /> 초기화
        </button>
      </div>
      {advanced && transcript && (
        <div className="nl-bar" data-testid="nl-bar">
          <span className="nl-ico">
            <Bot size={15} />
          </span>
          <input
            className="input"
            data-testid="nl-input"
            placeholder={'예: "말버릇 빼줘" · "시네마틱하게" · "따뜻한 색감"'}
            disabled={nlBusy}
            onKeyDown={(e) => {
              const v = e.currentTarget.value.trim();
              if (e.key === 'Enter' && v) {
                planAndPreview(v);
                e.currentTarget.value = '';
              }
            }}
          />
          <span className="nl-hint" data-testid="nl-engine">
            {nlBusy ? '생각 중…' : llmReady ? 'AI · Enter' : 'Enter'}
          </span>
        </div>
      )}
      {advanced && transcript && (
        <button
          type="button"
          className="btn ghost"
          data-testid="auto-highlight"
          onClick={() => autoHighlight(60)}
          title="핵심만 남겨 ~60초 하이라이트로 컷합니다 (롱폼→쇼츠)"
          style={{ fontSize: 11, padding: '4px 8px', margin: '0 8px 8px' }}
        >
          <Scissors size={13} /> 자동 하이라이트 (60초)
        </button>
      )}
      {transcript && (
        <div className="nl-bar" data-testid="style-pack-bar">
          <span className="nl-ico">
            <Palette size={15} />
          </span>
          <select
            className="select"
            data-testid="style-pack"
            defaultValue=""
            style={{ flex: 1, height: 26, fontSize: 12 }}
            onChange={(e) => {
              const id = e.target.value;
              if (id) {
                e.target.value = '';
                void applyPackAndBurn(id);
              }
            }}
          >
            <option value="" disabled>
              스타일 팩 1클릭 — 색·자막·말버릇 한 번에
            </option>
            {STYLE_PACKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.genre}
              </option>
            ))}
          </select>
        </div>
      )}
      {pendingPlan && (
        <div className="plan-card" data-testid="plan-card">
          <div className="plan-head">
            <span>제안: “{pendingPlan.input}”</span>
            <span className="plan-engine" data-testid="plan-engine">
              {pendingPlan.engine === 'llm' ? (
                <>
                  <Bot size={12} /> AI
                </>
              ) : (
                <>
                  <Settings size={12} /> 룰
                </>
              )}
            </span>
          </div>
          {pendingPlan.commands.length > 0 ? (
            <ul className="plan-cmds">
              {pendingPlan.commands.map((c, i) => (
                <li key={`${c.type}-${i}`}>
                  {CMD_LABEL[c.type] ?? c.type}
                  {c.type === 'applyColorgrade' ? ` · ${c.preset}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <div className="plan-empty">{nlError ?? '제안할 편집이 없습니다.'}</div>
          )}
          {planReport && pendingPlan.commands.length > 0 && (
            <div className="plan-diff" data-testid="plan-diff">
              {planReport.removedProgramUs > 0
                ? `예상: −${fmt(planReport.removedProgramUs)}  (${fmt(planReport.beforeDurationUs)} → ${fmt(planReport.afterDurationUs)})`
                : '예상: 길이 변화 없음 (룩/자막만 변경 — 미리보기는 근사)'}
              {!planReport.ok && <span className="plan-bad"> · 적용 불가: {planReport.error}</span>}
            </div>
          )}
          <div className="plan-actions">
            <button
              type="button"
              className="btn primary"
              data-testid="plan-approve"
              disabled={!planReport?.ok || pendingPlan.commands.length === 0}
              onClick={() => approvePlan()}
            >
              승인
            </button>
            <button
              type="button"
              className="btn ghost"
              data-testid="plan-reject"
              onClick={() => rejectPlan()}
            >
              취소
            </button>
          </div>
        </div>
      )}
      {advanced && (
        <div className="sub-pos card" data-testid="subtitle-pos">
          <div className="sub-pos-head">
            <span className="sub-pos-title">자막 미리보기</span>
            <span className="sub-pos-sub">영상에서 보일 모습 그대로</span>
          </div>
          <SubtitlePreview
            style={subtitleStyle}
            text={currentCaption}
            emphasis={currentEmphasis}
            pos={subtitlePos}
          />
          <div className="sub-group">
            <span className="sub-group-label">위치</span>
            <div className="sub-pos-grid">
              {ANCHORS.map((a) => {
                const sel =
                  Math.abs(subtitlePos.y - a.y) < 0.05 &&
                  Math.abs(anchorXForScale(a.x, subtitlePos.scale) - subtitlePos.x) < 0.05;
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={sel ? 'on' : ''}
                    data-testid={`sub-anchor-${a.id}`}
                    title={`anchor ${a.id}`}
                    onClick={() => applyAnchor(a.x, a.y)}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
            <label className="sub-slider">
              <span>크기 {Math.round(subtitlePos.scale * 100)}%</span>
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(subtitlePos.scale * 100)}
                data-testid="sub-scale"
                onChange={async (e) => {
                  const scale = Number(e.target.value) / 100;
                  setSubtitlePos({ scale });
                  scheduleReburn({ ...subtitlePos, scale }, subtitleStyle);
                }}
              />
            </label>
          </div>
          <details className="sub-style-adv">
            <summary>세부 스타일 (색·외곽선·배경·폰트·강조)</summary>
            <div className="sub-style-body">
              <label className="sub-ctl">
                <span>프리셋</span>
                <select
                  className="select"
                  data-testid="sub-preset"
                  defaultValue="default"
                  onChange={(e) => applyPreset(e.target.value)}
                >
                  {Object.keys(SUBTITLE_PRESETS).map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sub-ctl">
                <span>글자색</span>
                <input
                  type="color"
                  className="swatch"
                  value={subtitleStyle.color ?? '#ffffff'}
                  data-testid="sub-color"
                  onChange={(e) => applyStyle({ color: e.target.value })}
                />
              </label>
              <label className="sub-ctl">
                <span>외곽선</span>
                <input
                  type="color"
                  className="swatch"
                  value={(subtitleStyle.stroke as string) || '#000000'}
                  data-testid="sub-stroke"
                  onChange={(e) => applyStyle({ stroke: e.target.value })}
                />
              </label>
              <label className="sub-ctl">
                <span>배경</span>
                <select
                  className="select"
                  value={subtitleStyle.bg ?? 'rgba(0,0,0,0.55)'}
                  data-testid="sub-bg"
                  onChange={(e) => applyStyle({ bg: e.target.value })}
                >
                  <option value="rgba(0,0,0,0.55)">어둡게 55%</option>
                  <option value="rgba(0,0,0,0.85)">어둡게 85%</option>
                  <option value="rgba(255,255,255,0.7)">밝게</option>
                  <option value="transparent">없음</option>
                </select>
              </label>
              <label className="sub-ctl">
                <span>폰트</span>
                <select
                  className="select"
                  value={subtitleStyle.fontFamily ?? 'system-ui, sans-serif'}
                  data-testid="sub-font"
                  onChange={(e) => applyStyle({ fontFamily: e.target.value })}
                >
                  <option value="system-ui, sans-serif">시스템</option>
                  <option value="Georgia, serif">세리프</option>
                  <option value="'Courier New', monospace">고정폭</option>
                  <option value="Impact, sans-serif">임팩트</option>
                  <option
                    value={
                      '"Apple SD Gothic Neo", "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif'
                    }
                  >
                    한글(CJK)
                  </option>
                </select>
              </label>
              <label className="sub-ctl checkbox">
                <span>키워드 강조</span>
                <input
                  type="checkbox"
                  data-testid="sub-emphasis"
                  checked={emphasizeKeywords}
                  onChange={(e) => applyEmphasis(e.target.checked)}
                />
              </label>
              <label className="sub-ctl">
                <span>강조색</span>
                <input
                  type="color"
                  className="swatch"
                  data-testid="sub-emphasis-color"
                  value={subtitleStyle.emphasisColor ?? '#ffd54f'}
                  disabled={!emphasizeKeywords}
                  onChange={(e) => applyStyle({ emphasisColor: e.target.value })}
                />
              </label>
              <div className="sub-xy">
                <label className="sub-slider">
                  <span>가로 {Math.round(subtitlePos.x * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(subtitlePos.x * 100)}
                    data-testid="sub-x"
                    onChange={async (e) => {
                      const x = Number(e.target.value) / 100;
                      setSubtitlePos({ x });
                      scheduleReburn({ ...subtitlePos, x }, subtitleStyle);
                    }}
                  />
                </label>
                <label className="sub-slider">
                  <span>세로 {Math.round(subtitlePos.y * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(subtitlePos.y * 100)}
                    data-testid="sub-y"
                    onChange={async (e) => {
                      const y = Number(e.target.value) / 100;
                      setSubtitlePos({ y });
                      scheduleReburn({ ...subtitlePos, y }, subtitleStyle);
                    }}
                  />
                </label>
              </div>
            </div>
          </details>
        </div>
      )}
      <div className="review-tools" data-testid="review-tools">
        <button
          type="button"
          className="btn ghost"
          data-testid="remove-fillers"
          disabled={!transcript || fillerIds.size === 0}
          onClick={() => removeFillers()}
          title="음/어/흠 같은 말버릇 어절을 한 번에 컷합니다"
        >
          <Eraser size={13} /> 말버릇 {fillerIds.size}개 제거
          {fillerSavedUs > 0 ? ` · −${fmt(fillerSavedUs)}` : ''}
        </button>
        <label
          className="ov-field"
          data-testid="review-mode-field"
          title="STT 신뢰도가 낮은 어절을 빨갛게 표시합니다. 더블클릭으로 고칠 수 있어요."
        >
          <input
            type="checkbox"
            data-testid="review-mode"
            checked={reviewMode}
            disabled={!transcript}
            onChange={(e) => setReviewMode(e.target.checked)}
          />
          <Search size={13} /> 검수{' '}
          {reviewMode && uncertainIds.size > 0 ? `(${uncertainIds.size})` : ''}
        </label>
        {reviewMode && uncertainIds.size > 0 && (
          <button
            type="button"
            className="btn ghost"
            data-testid="jump-uncertain"
            onClick={jumpNextUncertain}
            title="다음 검수 대상 어절로 이동"
          >
            <CornerDownRight size={13} /> 다음 의심 어절
          </button>
        )}
        {advanced && (
          <>
            <details className="glossary">
              <summary>
                <NotebookText size={13} /> 내 사전 ({glossary.length})
              </summary>
              <div className="glossary-body">
                {glossary.length === 0 && (
                  <div className="glossary-hint">
                    자주 틀리는 고유명사를 등록하면 전사 후 자동 교정됩니다.
                  </div>
                )}
                {glossary.map((p, i) => (
                  <div className="glossary-row" key={`${p.from}-${i}`} data-testid="glossary-row">
                    <span>
                      {p.from} → {p.to || '(삭제)'}
                    </span>
                    <button
                      type="button"
                      className="x"
                      data-testid="glossary-remove"
                      onClick={() => removeGlossaryPair(i)}
                      aria-label="사전 항목 삭제"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <GlossaryAdd onAdd={addGlossaryPair} />
              </div>
            </details>
            <details className="chapters">
              <summary>
                <ListTree size={13} /> 챕터 / 타임스탬프
              </summary>
              <div className="chapters-body">
                <div className="chapters-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    data-testid="gen-chapters"
                    disabled={!transcript}
                    onClick={genChapters}
                    title="무음·문장 경계로 챕터를 추출합니다"
                  >
                    추출
                  </button>
                  {chapters.length > 0 && (
                    <button
                      type="button"
                      className="btn ghost"
                      data-testid="copy-chapters"
                      onClick={copyChapters}
                    >
                      <Clipboard size={13} /> 복사
                    </button>
                  )}
                </div>
                {chapters.length > 0 && (
                  <pre className="chapters-out" data-testid="chapters-out">
                    {formatChapters(chapters)}
                  </pre>
                )}
              </div>
            </details>
          </>
        )}
      </div>
      <div className="transcript-body" data-testid="transcript-panel">
        {!transcript && !mediaPath && (
          <div className="empty-transcript">
            먼저 영상을 가져오세요.
            <br />
            그다음 "자막 생성"을 누르면 받아쓰기가 시작됩니다.
          </div>
        )}
        {!transcript && mediaPath && (
          <div className="empty-transcript">
            <button
              type="button"
              className="btn primary"
              data-testid="transcribe"
              disabled={!hasAudio || status === 'extracting' || status === 'transcribing'}
              onClick={() => void transcribeMedia()}
            >
              <Mic size={14} /> 자막 생성 (받아쓰기)
            </button>
            {transcribeError ? (
              <div
                data-testid="transcribe-error"
                style={{ marginTop: 10, fontSize: 12, color: '#ff8a8a' }}
              >
                {transcribeError}
              </div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                {hasAudio
                  ? '오디오를 추출해 한국어 자막을 만듭니다. 영상은 이 Mac을 떠나지 않습니다. 자막을 만들면 텍스트 편집·검수·하이라이트를 쓸 수 있어요.'
                  : '이 영상에는 오디오가 없어 자막을 만들 수 없어요. (색보정·하이라이트·오버레이·내보내기는 그대로 됩니다.)'}
              </div>
            )}
          </div>
        )}
        {transcript?.segments.map((seg) => (
          <div className="seg" key={seg.id}>
            {seg.words.map((id) => {
              const w = transcript.words[id];
              if (!w) return null;
              const isDead = dead.has(id);
              const isUncertain = reviewMode && uncertainIds.has(id);
              if (editingId === id) {
                // 인라인 교정 입력 — Enter/blur 커밋, Esc 취소.
                return (
                  <input
                    key={id}
                    className="word-edit"
                    data-testid="word-edit"
                    defaultValue={w.text}
                    // biome-ignore lint/a11y/noAutofocus: inline correction focuses the edited word
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitWordEdit(id, e.currentTarget.value);
                      else if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={(e) => void commitWordEdit(id, e.currentTarget.value)}
                  />
                );
              }
              const cls = [
                'word',
                isDead ? 'dead' : '',
                selected.includes(id) ? 'sel' : '',
                id === activeId ? 'active' : '',
                fillerIds.has(id) ? 'filler' : '',
                isUncertain ? 'uncertain' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <span
                  key={id}
                  className={cls}
                  data-testid="word"
                  data-dead={isDead ? 'true' : 'false'}
                  data-uncertain={isUncertain ? 'true' : 'false'}
                  onClick={(e) => {
                    if (isDead) return;
                    if (e.metaKey || e.ctrlKey) {
                      if (timeline) {
                        const p = wordToProgram(timeline, w);
                        if (p) setPlayhead(p.start);
                      }
                      return;
                    }
                    toggleWord(id);
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    if (!isDead) setEditingId(id); // 더블클릭 → 텍스트 교정
                  }}
                  onKeyDown={() => {}}
                  title={
                    isUncertain
                      ? `신뢰도 ${(w.confidence * 100).toFixed(0)}% · 더블클릭으로 교정`
                      : timeline
                        ? '⌘/Ctrl+click 위치 이동 · 더블클릭 교정'
                        : undefined
                  }
                >
                  {w.text}{' '}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Multi-track timeline ─────────────────────────────────────────────
function Timeline() {
  const {
    timeline,
    durationProgramUs,
    playheadUs,
    overlays,
    ttsClips,
    seekTo,
    selectOverlay,
    selectedOverlayId,
    updateOverlay,
    selectVoice,
    selectedVoiceId,
    updateTts,
  } = useEditor();
  const clips = timeline ? videoClips(timeline) : [];
  const ratio = durationProgramUs > 0 ? playheadUs / durationProgramUs : 0;
  // 트랙을 클릭하면 그 시점으로 플레이헤드 이동(+일시정지). 클립 자식 클릭도 트랙으로 버블링됨.
  const seekFromTrack = (e: MouseEvent<HTMLDivElement>) => {
    if (!timeline || durationProgramUs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekTo(r * durationProgramUs);
  };
  // OVERLAY 레인: 시간 블록을 드래그(이동)/가장자리(길이) 조절. 시간대 겹침 허용(여러 스티커 동시).
  const ovLaneRef = useRef<HTMLDivElement>(null);
  const ovDrag = useRef<{
    id: string;
    mode: 'move' | 'l' | 'r';
    px: number;
    start: number;
    end: number;
  } | null>(null);
  const OV_MIN = 300_000; // 최소 길이 0.3s
  const ovClamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const onOvDown = (e: PointerEvent<HTMLElement>, o: Overlay, mode: 'move' | 'l' | 'r') => {
    e.stopPropagation();
    e.preventDefault();
    selectOverlay(o.id);
    ovDrag.current = { id: o.id, mode, px: e.clientX, start: o.startUs, end: o.endUs };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onOvMove = (e: PointerEvent<HTMLElement>) => {
    const d = ovDrag.current;
    const rect = ovLaneRef.current?.getBoundingClientRect();
    if (!d || !rect || durationProgramUs <= 0) return;
    const deltaUs = ((e.clientX - d.px) / rect.width) * durationProgramUs;
    const len = d.end - d.start;
    if (d.mode === 'move') {
      const s = Math.round(ovClamp(d.start + deltaUs, 0, durationProgramUs - len));
      updateOverlay(d.id, { startUs: s, endUs: s + len });
    } else if (d.mode === 'l') {
      updateOverlay(d.id, { startUs: Math.round(ovClamp(d.start + deltaUs, 0, d.end - OV_MIN)) });
    } else {
      updateOverlay(d.id, {
        endUs: Math.round(ovClamp(d.end + deltaUs, d.start + OV_MIN, durationProgramUs)),
      });
    }
  };
  const onOvUp = (e: PointerEvent<HTMLElement>) => {
    ovDrag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  // VOICE 레인: 오버레이와 동일한 드래그(이동)/가장자리(길이) 로직. 보이스 클립을 시간 위에 배치.
  const voiceLaneRef = useRef<HTMLDivElement>(null);
  const voiceDrag = useRef<{
    id: string;
    mode: 'move' | 'l' | 'r';
    px: number;
    start: number;
    end: number;
  } | null>(null);
  const onVoiceDown = (e: PointerEvent<HTMLElement>, c: TtsClip, mode: 'move' | 'l' | 'r') => {
    e.stopPropagation();
    e.preventDefault();
    selectVoice(c.id);
    voiceDrag.current = { id: c.id, mode, px: e.clientX, start: c.startUs, end: c.endUs };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onVoiceMove = (e: PointerEvent<HTMLElement>) => {
    const d = voiceDrag.current;
    const rect = voiceLaneRef.current?.getBoundingClientRect();
    if (!d || !rect || durationProgramUs <= 0) return;
    const deltaUs = ((e.clientX - d.px) / rect.width) * durationProgramUs;
    const len = d.end - d.start;
    if (d.mode === 'move') {
      const s = Math.round(ovClamp(d.start + deltaUs, 0, durationProgramUs - len));
      updateTts(d.id, { startUs: s, endUs: s + len });
    } else if (d.mode === 'l') {
      updateTts(d.id, { startUs: Math.round(ovClamp(d.start + deltaUs, 0, d.end - OV_MIN)) });
    } else {
      updateTts(d.id, {
        endUs: Math.round(ovClamp(d.end + deltaUs, d.start + OV_MIN, durationProgramUs)),
      });
    }
  };
  const onVoiceUp = (e: PointerEvent<HTMLElement>) => {
    voiceDrag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  // OVERLAY 레인: 자막 제외. 시간대가 겹치는 블록은 서로 다른 행(서브레인)에 배치해 둘 다 보이게
  // 한다(그리디 인터벌 분할). 번호(추가 순서)·색(id 해시)으로 같은 스티커도 구분된다.
  const laneOverlays = overlays.filter((o) => o.kind !== 'subtitle');
  const ovRowOf = new Map<string, number>();
  let ovRows = 1;
  {
    const rowEnds: number[] = [];
    for (const o of [...laneOverlays].sort((a, b) => a.startUs - b.startUs)) {
      let r = rowEnds.findIndex((end) => end <= o.startUs);
      if (r === -1) {
        r = rowEnds.length;
        rowEnds.push(0);
      }
      rowEnds[r] = o.endUs;
      ovRowOf.set(o.id, r);
    }
    ovRows = Math.max(1, rowEnds.length);
  }
  return (
    <div className="timeline">
      <div className="tl-head">
        <span>Timeline</span>
        <span>
          {clips.length} clips · {fmt(durationProgramUs)}
        </span>
      </div>
      <div className="tracks">
        <div className="trackrow">
          <span className="lbl">Video</span>
          <div
            className="track"
            data-testid="tl-video-track"
            onClick={seekFromTrack}
            style={{ cursor: timeline ? 'pointer' : 'default' }}
          >
            {clips.map((c) => {
              const len = c.sourceEnd - c.sourceStart;
              const pct = durationProgramUs > 0 ? (len / durationProgramUs) * 100 : 0;
              return (
                <div className="clip" key={c.id} style={{ width: `${pct}%` }}>
                  {fmt(len)}
                </div>
              );
            })}
            {timeline && <div className="playhead" style={{ left: `${ratio * 100}%` }} />}
          </div>
        </div>
        <div className="trackrow">
          <span className="lbl">Overlay</span>
          <div
            className="track thin ov-lane"
            ref={ovLaneRef}
            style={{ height: `${ovRows * OV_ROW_H + 4}px` }}
          >
            {laneOverlays.length === 0 ? (
              <span className="track empty-track">
                스티커·이미지를 추가하면 시간 블록으로 표시 — 드래그=이동 · 양끝=길이 · Delete=삭제
              </span>
            ) : (
              laneOverlays.map((o, idx) => {
                const left = durationProgramUs > 0 ? (o.startUs / durationProgramUs) * 100 : 0;
                const width =
                  durationProgramUs > 0
                    ? Math.max(2, ((o.endUs - o.startUs) / durationProgramUs) * 100)
                    : 0;
                const icon =
                  o.kind === 'image'
                    ? '🖼'
                    : o.kind === 'gif'
                      ? 'GIF'
                      : o.kind === 'video'
                        ? '🎞'
                        : o.name;
                const row = ovRowOf.get(o.id) ?? 0;
                const sel = selectedOverlayId === o.id;
                return (
                  <div
                    key={o.id}
                    className={`ov-block${sel ? ' on' : ''}`}
                    data-testid="ov-block"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      top: `${row * OV_ROW_H + 2}px`,
                      height: `${OV_ROW_H - 4}px`,
                      background: ovColor(o.id),
                      borderColor: sel ? 'var(--text)' : ovColor(o.id),
                    }}
                    onPointerDown={(e) => onOvDown(e, o, 'move')}
                    onPointerMove={onOvMove}
                    onPointerUp={onOvUp}
                    title={`#${idx + 1} · ${fmt(o.startUs)}~${fmt(o.endUs)} · 드래그=이동 · 양끝=길이 · Delete=삭제`}
                  >
                    <span
                      className="ov-block-h l"
                      onPointerDown={(e) => onOvDown(e, o, 'l')}
                      onPointerMove={onOvMove}
                      onPointerUp={onOvUp}
                    />
                    <span className="ov-block-label">
                      {idx + 1} {icon}
                    </span>
                    <span
                      className="ov-block-h r"
                      onPointerDown={(e) => onOvDown(e, o, 'r')}
                      onPointerMove={onOvMove}
                      onPointerUp={onOvUp}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="trackrow">
          <span className="lbl">Voice</span>
          <div className="track thin ov-lane voice-lane" ref={voiceLaneRef}>
            {ttsClips.length === 0 ? (
              <span className="track empty-track">
                AI 보이스를 만들면 시간 블록으로 표시 — 드래그=이동 · 양끝=길이 · Delete=삭제
              </span>
            ) : (
              ttsClips.map((c) => {
                const left = durationProgramUs > 0 ? (c.startUs / durationProgramUs) * 100 : 0;
                const width =
                  durationProgramUs > 0
                    ? Math.max(2, ((c.endUs - c.startUs) / durationProgramUs) * 100)
                    : 0;
                const sel = selectedVoiceId === c.id;
                return (
                  <div
                    key={c.id}
                    className={`ov-block voice-block${sel ? ' on' : ''}`}
                    data-testid="voice-block"
                    style={{ left: `${left}%`, width: `${width}%` }}
                    onPointerDown={(e) => onVoiceDown(e, c, 'move')}
                    onPointerMove={onVoiceMove}
                    onPointerUp={onVoiceUp}
                    title={`${c.voice} · ${fmt(c.startUs)}~${fmt(c.endUs)} · 드래그=이동 · 양끝=길이 · Delete=삭제`}
                  >
                    <span
                      className="ov-block-h l"
                      onPointerDown={(e) => onVoiceDown(e, c, 'l')}
                      onPointerMove={onVoiceMove}
                      onPointerUp={onVoiceUp}
                    />
                    <span className="ov-block-label">
                      <Volume2 size={11} /> {c.voice}
                    </span>
                    <span
                      className="ov-block-h r"
                      onPointerDown={(e) => onVoiceDown(e, c, 'r')}
                      onPointerMove={onVoiceMove}
                      onPointerUp={onVoiceUp}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  const {
    status,
    clipCount,
    durationProgramUs,
    lastExport,
    revealExport,
    dismissExport,
    auditLog,
  } = useEditor();
  return (
    <div className="statusbar">
      <span className="pill">
        <span className="led" />
        <span data-testid="status">{status}</span>
      </span>
      <span>
        clips <b data-testid="clip-count">{clipCount}</b>
      </span>
      <span>
        program <b data-testid="duration">{durationProgramUs}</b>µs · {fmt(durationProgramUs)}
      </span>
      <span title="기록된 편집 명령 수 (결정적 replay/검증 토대)" className="audit">
        <Pencil size={12} /> <b data-testid="audit-count">{auditLog.length}</b>
      </span>
      <span className="spacer" />
      {lastExport ? (
        <span className="export-done" data-testid="export-done">
          <CheckCircle2 size={13} /> 내보냄 · 원본 {fmt(lastExport.originalUs)} →{' '}
          {lastExport.format === 'srt' ? '자막(.srt)' : fmt(lastExport.finalUs)}
          <button
            type="button"
            className="link"
            data-testid="reveal-export"
            onClick={() => revealExport()}
          >
            폴더에서 보기
          </button>
          <button type="button" className="x" onClick={() => dismissExport()} aria-label="닫기">
            ✕
          </button>
        </span>
      ) : (
        <code>MIT · whisper.cpp · FFmpeg · local-only</code>
      )}
    </div>
  );
}

// 작업 중(probe/추출/전사/무음/내보내기) 표시되는 풀스크린 오버레이.
// ETA는 부정확해 신뢰를 깎으므로 표기하지 않고, 경과시간 + 단계만 보여준다.
const BUSY_LABEL: Record<string, string> = {
  probing: '미디어 분석 중',
  extracting: '오디오 추출 중',
  transcribing: '한국어 자막 생성 중',
  'detecting silence': '무음 구간 스캔 중',
  analyzing: '영상 분석 중 (자동 보정)',
  'synthesizing voice': '음성 합성 중',
  exporting: '내보내는 중',
  'exporting gif': 'GIF 내보내는 중',
  'exporting srt': '자막 파일 저장 중',
};
function ProgressOverlay() {
  const status = useEditor((s) => s.status);
  const label = BUSY_LABEL[status];
  const busy = Boolean(label);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  useEffect(() => {
    if (!busy) return;
    startRef.current = performance.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed((performance.now() - startRef.current) / 1000), 100);
    return () => clearInterval(t);
  }, [busy]);
  if (!label) return null;
  const importStep =
    status === 'transcribing' ? 1 : status === 'extracting' || status === 'probing' ? 0 : -1;
  return (
    <div className="progress-overlay" data-testid="progress-overlay">
      <div className="progress-card">
        <div className="spinner" />
        <div className="progress-label">{label}</div>
        {importStep >= 0 && (
          <div className="progress-steps">
            <span className={importStep >= 0 ? 'on' : ''}>오디오 추출</span>
            <span className="arrow">→</span>
            <span className={importStep >= 1 ? 'on' : ''}>한국어 자막 생성</span>
          </div>
        )}
        <div className="progress-elapsed">{elapsed.toFixed(1)}초 경과</div>
        <div className="progress-hint">🔒 영상이 이 Mac을 떠나지 않습니다</div>
      </div>
    </div>
  );
}

// 무음 감지 민감도 팝오버 — 슬라이더로 임계값 조절 + 절약 미터 미리보기.
function SilenceMenu() {
  const {
    silenceParams,
    silencePreview,
    setSilenceParams,
    refreshSilencePreview,
    removeSilencesAction,
    timeline,
  } = useEditor();
  const [open, setOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh once when opened
  useEffect(() => {
    if (open) refreshSilencePreview();
  }, [open]);
  return (
    <div className="menu-wrap">
      <button
        type="button"
        className="btn ghost"
        data-testid="silence-menu"
        disabled={!timeline}
        title="무음 감지 민감도"
        onClick={() => setOpen((v) => !v)}
      >
        <Settings size={15} />
      </button>
      {open && (
        <div className="menu silence-pop">
          <label className="ov-field">
            민감도 {silenceParams.noiseDb}dB
            <input
              type="range"
              min={-45}
              max={-20}
              value={silenceParams.noiseDb}
              data-testid="silence-db"
              onChange={(e) => setSilenceParams({ noiseDb: Number(e.target.value) })}
              onMouseUp={() => refreshSilencePreview()}
            />
          </label>
          <label className="ov-field">
            최소 무음 {silenceParams.minSilenceMs}ms
            <input
              type="range"
              min={200}
              max={1500}
              step={50}
              value={silenceParams.minSilenceMs}
              data-testid="silence-ms"
              onChange={(e) => setSilenceParams({ minSilenceMs: Number(e.target.value) })}
              onMouseUp={() => refreshSilencePreview()}
            />
          </label>
          <div className="silence-preview" data-testid="silence-preview">
            {silencePreview
              ? `감지 ${silencePreview.count}곳 · −${fmt(silencePreview.savedUs)}`
              : '감지 중…'}
          </div>
          <button
            type="button"
            className="btn primary"
            data-testid="silence-apply"
            onClick={async () => {
              setOpen(false);
              await removeSilencesAction();
            }}
          >
            이 설정으로 무음 제거
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const s = useEditor();
  useEffect(() => {
    window.__editor = {
      importPath: (p: string) => useEditor.getState().importPath(p),
      transcribe: () => useEditor.getState().transcribeMedia(),
      // e2e 편의: 가져오기(프로브) + 자막 생성(받아쓰기)을 한 번에. UI 플로우는 둘이 분리돼 있다.
      importAndTranscribe: async (p: string) => {
        await useEditor.getState().importPath(p);
        await useEditor.getState().transcribeMedia();
      },
      exportTo: (p: string) => useEditor.getState().exportTo(p),
      exportSrt: (p: string) => useEditor.getState().exportSrt(p),
      saveProject: (p: string) => useEditor.getState().saveProject(p),
      openProject: (p: string) => useEditor.getState().openProject(p),
      exportGif: (p: string) => useEditor.getState().exportVideo(p, 'gif'),
      addImageOverlay: (p: string) => {
        useEditor.getState().addImageOverlay(p);
        return Promise.resolve();
      },
      planAndPreview: (input: string) => useEditor.getState().planAndPreview(input),
      approvePlan: () => useEditor.getState().approvePlan(),
      rejectPlan: () => useEditor.getState().rejectPlan(),
      applyStylePack: (id: string) => useEditor.getState().applyStylePack(id),
      autoEnhance: () => useEditor.getState().autoEnhance(),
      correctWord: (wordId: string, text: string) => useEditor.getState().correctWord(wordId, text),
      autoHighlight: (targetSeconds: number) => useEditor.getState().autoHighlight(targetSeconds),
      detectLlm: () => useEditor.getState().detectLlm(),
    };
    // 로컬 LLM 가용성 1회 조회(부재/비활성 시 조용히 룰 플래너로 동작).
    void useEditor.getState().detectLlm();
  }, []);
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    const isTextInput = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };
    const SEEK_STEP_US = 100_000; // 0.1s
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's' && useEditor.getState().timeline) {
          e.preventDefault();
          (async () => {
            const p = await window.dawn?.saveFile();
            if (p) await useEditor.getState().saveProject(p);
          })();
          return;
        }
        if (k === 'o') {
          e.preventDefault();
          (async () => {
            const p = await window.dawn?.openFile();
            if (p) await useEditor.getState().openProject(p);
          })();
          return;
        }
        if (k === 'e' && useEditor.getState().timeline) {
          e.preventDefault();
          (async () => {
            const p = await window.dawn?.saveFile();
            if (p) await useEditor.getState().exportTo(p);
          })();
          return;
        }
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        if (!isTextInput(e.target)) {
          e.preventDefault();
          setShowHelp((v) => !v);
          return;
        }
      }
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false);
        return;
      }
      if (isTextInput(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useEditor.getState();
      const dur = st.durationProgramUs;
      if (e.code === 'Space') {
        if (!st.timeline) return;
        e.preventDefault();
        st.setPlaying(!st.playing);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        // 1순위: 선택된 오버레이(스티커/이미지). 2순위: 선택된 보이스 클립. 3순위: 어절 컷.
        if (st.selectedOverlayId) {
          st.removeOverlay(st.selectedOverlayId);
          return;
        }
        if (st.selectedVoiceId) {
          st.removeTts(st.selectedVoiceId);
          return;
        }
        if (st.selected.length > 0) st.deleteSelection();
        return;
      }
      if (e.key === 'ArrowRight') {
        if (!dur) return;
        e.preventDefault();
        st.setPlayhead(Math.min(dur, st.playheadUs + SEEK_STEP_US));
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (!dur) return;
        e.preventDefault();
        st.setPlayhead(Math.max(0, st.playheadUs - SEEK_STEP_US));
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        st.setPlayhead(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        st.setPlayhead(dur);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, showHelp]);
  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <Rail />
        <Dock />
        <Preview />
        <Transcript />
      </div>
      <Timeline />
      <StatusBar />
      <ProgressOverlay />
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';
  const rows: [string, string][] = [
    [`${mod} Z / ${mod} ⇧ Z`, 'Undo / Redo'],
    [`${mod} S`, 'Save project (.dawn)'],
    [`${mod} O`, 'Open project (.dawn)'],
    [`${mod} E`, 'Export MP4'],
    ['Space', 'Play / pause'],
    ['← / →', 'Seek ±0.1s'],
    ['Home / End', 'Jump to start / end'],
    ['?', 'Show / hide this help'],
    ['Esc', 'Close overlays'],
  ];
  return (
    <button
      type="button"
      className="help-overlay"
      data-testid="help-overlay"
      onClick={onClose}
      aria-label="Close help"
    >
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <strong>Keyboard shortcuts</strong>
          <button type="button" className="x" onClick={onClose}>
            ✕
          </button>
        </div>
        <table>
          <tbody>
            {rows.map(([k, d]) => (
              <tr key={k}>
                <td>
                  <code>{k}</code>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </button>
  );
}
