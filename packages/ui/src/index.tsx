import {
  PRESET_META,
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
import type { Chapter, ColorEq, Edl, SubtitleCue, SubtitleStyle } from '@dawn-cut/core';
import {
  ArrowUpToLine,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Clipboard,
  CornerDownRight,
  Eraser,
  Film,
  Image as ImageIcon,
  Images,
  Info,
  ListTree,
  Lock,
  type LucideIcon,
  Mic,
  NotebookText,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
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
  X,
} from 'lucide-react';
import {
  type CSSProperties,
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
import type { ColorPreset, ManualCue, Overlay, PanelId, TtsClip } from './store.js';

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

// 커스텀 드롭다운. 네이티브 <select>는 이 Electron/Chromium 빌드에서 닫힌 표시 텍스트의 한글이
// 자모 분리로 깨진다(같은 화면의 일반 DOM 텍스트는 정상). 옵션·표시값을 모두 일반 DOM으로 그려
// 한글을 정상 렌더하고, 톤앤매너도 통일한다. data-testid는 버튼에, 옵션엔 data-value를 둔다.
interface KOption {
  value: string;
  label: string;
  disabled?: boolean;
}
function KSelect({
  value,
  onChange,
  options,
  testId,
  disabled,
  title,
  placeholder,
  flex,
}: {
  value?: string;
  onChange: (v: string) => void;
  options: KOption[];
  testId?: string;
  disabled?: boolean;
  title?: string;
  placeholder?: string;
  flex?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);
  const sel = options.find((o) => o.value === value);
  return (
    <div className={`kselect${disabled ? ' disabled' : ''}${flex ? ' flex' : ''}`} ref={ref}>
      <button
        type="button"
        className="kselect-btn"
        data-testid={testId}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className="kselect-val">{sel ? sel.label : (placeholder ?? '')}</span>
        <ChevronDown size={13} className="kselect-arrow" />
      </button>
      {open && (
        <div className="kselect-pop">
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              data-value={o.value}
              className={`kselect-opt${o.value === value ? ' on' : ''}`}
              disabled={o.disabled}
              onClick={() => {
                if (o.disabled) return;
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
const isVideo = (n: string) => /\.(mp4|mov|m4v|webm|mkv|avi|flv|ts|mpe?g|wmv|3gp)$/i.test(n);
const isImage = (n: string) => /\.(png|jpe?g|webp|avif|bmp)$/i.test(n);
const isGif = (n: string) => /\.gif$/i.test(n);
// 드래그앤드롭 경로: Electron 32+는 File.path를 제거 → preload의 webUtils.getPathForFile 사용.
// (구버전/비-Electron 폴백으로 File.path도 본다.)
const filePath = (f: File) =>
  window.dawn?.pathForFile?.(f) || (f as File & { path?: string }).path || '';

// 자막 cue 분절 옵션 — 애니메이션(reveal/karaoke)이면 짧은 쇼츠형 cue로 쪼갠다. 미리보기와 번인이
// 반드시 같은 함수를 써야 동일한 자막 텍스트가 나온다(드리프트 방지). 'none'이면 기본(cue당 1프레임).
const cueOptsForAnim = (
  anim: string,
): { maxWordsPerCue?: number; maxCharsPerCue?: number; maxGapUs?: number } =>
  // 'none'·'pop'은 cue 전체 유지(pop=등장 모션이라 쇼츠 분절 불필요). 나머지는 짧게 쪼갠다.
  anim === 'none' || anim === 'pop'
    ? {}
    : { maxWordsPerCue: 4, maxCharsPerCue: 13, maxGapUs: 400_000 };
// 자막 'pop' 등장 키프레임 — 시작 60% 크기에서 22% 구간 동안 풀크기로 커진다(easeOut).
const POP_FROM = 0.6;
const POP_U = 0.22;
// 수기 자막 cue → SubtitleCue(어절 타이밍 포함)로 변환. reveal/karaoke 애니가 어절을 쓰도록
// 텍스트를 공백으로 나눠 [startUs,endUs]에 균등 분배. none/pop/typewriter는 어절 불필요.
function manualCueToSubtitleCue(mc: ManualCue, index: number): SubtitleCue {
  const parts = mc.text.trim().split(/\s+/).filter(Boolean);
  const span = Math.max(1, mc.endUs - mc.startUs);
  const words = parts.map((t, i) => ({
    text: t,
    startUs: Math.round(mc.startUs + (span * i) / parts.length),
    endUs: Math.round(mc.startUs + (span * (i + 1)) / parts.length),
  }));
  return { index: index + 1, startUs: mc.startUs, endUs: mc.endUs, text: mc.text.trim(), words };
}
const manualToCues = (cues: ManualCue[]): SubtitleCue[] =>
  cues
    .filter((c) => c.text.trim())
    .slice()
    .sort((a, b) => a.startUs - b.startUs)
    .map(manualCueToSubtitleCue);

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
          title={!s.timeline ? '먼저 영상을 가져오세요' : '프로젝트(.dawn) 저장 (자막 없어도 가능)'}
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
              <button
                type="button"
                data-testid="export-srt"
                disabled={!s.transcript}
                title={!s.transcript ? '자막 생성 후 .srt로 내보낼 수 있어요' : '자막 파일(.srt)'}
                onClick={() => exportAs(s.exportSrt)}
              >
                <span>자막 — .srt {!s.transcript ? '(자막 생성 필요)' : ''}</span>
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
          <div className="thumb">
            <Clapperboard size={19} strokeWidth={1.75} />
          </div>
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
          <span
            className="badge live"
            data-testid="media-badge"
            data-state={
              proxyBusy ? 'busy' : previewPath && previewPath !== mediaPath ? 'proxy' : 'src'
            }
            title={
              proxyBusy
                ? '미리보기용 프록시를 만드는 중입니다 (편집·내보내기는 원본 품질).'
                : previewPath && previewPath !== mediaPath
                  ? '미리보기는 가벼운 프록시로 재생됩니다. 편집·내보내기는 항상 원본 품질입니다.'
                  : '원본을 그대로 미리봅니다.'
            }
          >
            {proxyBusy
              ? '변환 중'
              : previewPath && previewPath !== mediaPath
                ? '프록시(미리보기용)'
                : '원본'}
          </span>
          <button
            type="button"
            className="x"
            data-testid="clear-media"
            onClick={clearMedia}
            title="이 영상 치우기 (편집 초기화)"
            aria-label="영상 제거"
          >
            <X size={14} />
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
          <div className="thumb">
            {o.kind === 'gif' ? (
              <Images size={18} strokeWidth={1.75} />
            ) : (
              <ImageIcon size={18} strokeWidth={1.75} />
            )}
          </div>
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
            <X size={14} />
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
          <Trash2 size={13} /> 모두 지우기 ({imageOverlays.length})
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

// 보이스 스타일 = say의 속도(wpm)·톤(pbas) 조합 프리셋. 진짜 감정형은 아니지만 '느낌'을 바꾼다.
const VOICE_STYLES: { id: string; label: string; rate: number; pitch: number }[] = [
  { id: 'calm', label: '차분', rate: 145, pitch: 38 },
  { id: 'normal', label: '보통', rate: 180, pitch: 50 },
  { id: 'lively', label: '활기참', rate: 235, pitch: 64 },
];
function TextPanel() {
  const { ttsClips, generateVoiceover, selectedVoiceId, selectVoice, removeTts } = useEditor();
  const [voices, setVoices] = useState<{ name: string; lang: string }[]>([]);
  const [voice, setVoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [rate, setRate] = useState(180); // wpm
  const [pitch, setPitch] = useState(50); // pbas 0~100
  const [style, setStyle] = useState('normal'); // 선택된 스타일 칩 id('custom'=슬라이더 수동)
  const [previewing, setPreviewing] = useState(false);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const pickStyle = (s: (typeof VOICE_STYLES)[number]) => {
    setStyle(s.id);
    setRate(s.rate);
    setPitch(s.pitch);
  };
  const previewVoice = async () => {
    if (previewing) return;
    setPreviewing(true);
    try {
      const res = await window.dawn?.synthesizeTts('안녕하세요, 미리듣기입니다.', voice, {
        rate,
        pitch,
      });
      if (res?.wavPath) {
        previewAudio.current?.pause();
        const a = new Audio(`file://${encodeURI(res.wavPath)}`);
        previewAudio.current = a;
        await a.play().catch(() => {});
      }
    } finally {
      setPreviewing(false);
    }
  };
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
  // TTS 엔진 상태 — 뉴럴(Piper) 설치 시 배지 표시, 아니면 macOS say(기본).
  const [neural, setNeural] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const st = await window.dawn?.ttsEngineStatus?.();
      if (alive) setNeural(Boolean(st?.available));
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
        <span
          className="badge"
          data-testid="tts-engine"
          title={
            neural
              ? '뉴럴(Piper) 엔진 사용 중'
              : 'macOS say 엔진. 뉴럴은 pnpm setup:tts-neural 로 설치(영어 위주 — 한국어 뉴럴은 준비 중)'
          }
        >
          {neural ? '뉴럴(Piper)' : 'macOS say'}
        </span>
      </div>
      <div className="field">보이스</div>
      <KSelect
        testId="tts-voice"
        flex
        value={voice}
        onChange={setVoice}
        options={voices.map((v) => ({ value: v.name, label: `${v.name} · ${langLabel(v.lang)}` }))}
      />
      <div className="field">스타일</div>
      <div className="chip-row" data-testid="tts-styles">
        {VOICE_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid={`tts-style-${s.id}`}
            className={`tchip${style === s.id ? ' on' : ''}`}
            onClick={() => pickStyle(s)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <label className="sub-slider">
        <span>속도 · {rate <= 150 ? '느리게' : rate >= 220 ? '빠르게' : '보통'}</span>
        <input
          type="range"
          min={120}
          max={260}
          value={rate}
          data-testid="tts-rate"
          onChange={(e) => {
            setRate(Number(e.target.value));
            setStyle('custom');
          }}
        />
      </label>
      <label className="sub-slider">
        <span>톤 · {pitch <= 40 ? '낮게' : pitch >= 62 ? '높게' : '보통'}</span>
        <input
          type="range"
          min={30}
          max={70}
          value={pitch}
          data-testid="tts-pitch"
          onChange={(e) => {
            setPitch(Number(e.target.value));
            setStyle('custom');
          }}
        />
      </label>
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
      <div className="tts-actions">
        <button
          type="button"
          className="btn"
          data-testid="tts-preview"
          disabled={previewing}
          onClick={previewVoice}
          title="현재 보이스·속도·톤으로 짧게 들어보기"
        >
          {previewing ? (
            <span className="spinner sm" />
          ) : (
            <Play size={13} fill="currentColor" strokeWidth={0} />
          )}{' '}
          미리듣기
        </button>
        <button
          type="button"
          className="btn primary"
          data-testid="generate-voiceover"
          disabled={!text.trim() || busy}
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={async () => {
            setBusy(true);
            try {
              await generateVoiceover(voice, text.trim(), { rate, pitch, style });
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
      </div>
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
            <X size={14} />
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
  const [motion, setMotion] = useState<{ name: string; path: string }[]>([]);
  // 번들된 모션 스티커(로컬 생성 애니 GIF) 로드. 클라우드 의존 없음.
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = (await window.dawn?.motionStickers?.()) ?? [];
      if (alive) setMotion(list);
    })();
    return () => {
      alive = false;
    };
  }, []);
  const add = async (kind: 'sticker' | 'gif', name: string, dataUrl: string) => {
    const res = await window.dawn?.writeAsset(dataUrl);
    if (res) addOverlaySrc(kind, name, res.path);
  };
  // 내 GIF/이미지 불러오기 — 기존 오버레이 경로 재사용(드래그앤드롭과 동일).
  const addFiles = (files: File[]) => {
    for (const f of files) {
      const p = filePath(f);
      if (!p) continue;
      if (isGif(f.name)) addOverlaySrc('gif', f.name, p);
      else if (isImage(f.name)) addOverlaySrc('image', f.name, p);
    }
  };
  return (
    <div className="dock-body">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>스티커 · GIF</strong>
        <span className="badge live">영상에 합성</span>
      </div>
      <div className="field">스티커</div>
      <div className="sticker-grid">
        {STICKERS.map((e) => (
          <button key={e} type="button" onClick={() => add('sticker', e, rasterizeEmoji(e))}>
            {e}
          </button>
        ))}
      </div>
      {motion.length > 0 && (
        <>
          <div className="field">모션 스티커 (움직이는 GIF)</div>
          <div className="motion-grid" data-testid="motion-grid">
            {motion.map((m) => (
              <button
                key={m.name}
                type="button"
                className="motion-card"
                data-testid={`motion-${m.name}`}
                title={m.name}
                onClick={() => addOverlaySrc('gif', m.name, m.path)}
              >
                <img src={`file://${encodeURI(m.path)}`} alt={m.name} />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="field">내 GIF / 이미지</div>
      <Dropzone
        onFiles={addFiles}
        hint="GIF·이미지를 끌어다 놓거나 클릭 — 오버레이로 합성됩니다."
      />
      <div className="field">텍스트 GIF 배지</div>
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
                {o.kind === 'sticker' ? '스티커' : 'GIF'} · {fmt(o.startUs)}~{fmt(o.endUs)}{' '}
                (타임라인 #{laneNumber(overlays, o.id)})
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
              <X size={14} />
            </button>
          </div>
        ))}
      <p className="muted-note">
        스티커·배지·모션 GIF 모두 <b>미리보기·내보내기에서 실제 영상에 합성</b>됩니다. 움직이는
        GIF도 끌어다 놓으면 그대로 반복 재생돼요. 타임라인에서 위치·길이를 조절할 수 있습니다.
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
    status,
  } = useEditor();
  const analyzing = status === 'analyzing';
  // eq가 사실상 중립(±변화 거의 0)이면 '이미 잘 노출됨' — 시각 변화가 작은 게 정상임을 알린다.
  const eqNeutral =
    !!autoEnhanceEq &&
    Math.abs(autoEnhanceEq.brightness ?? 0) < 0.02 &&
    Math.abs((autoEnhanceEq.contrast ?? 1) - 1) < 0.02 &&
    Math.abs((autoEnhanceEq.saturation ?? 1) - 1) < 0.02;
  return (
    <div className="dock-body">
      <strong style={{ fontSize: 13 }}>자동 보정 (Auto)</strong>
      <button
        type="button"
        className="btn primary"
        data-testid="auto-enhance"
        disabled={!timeline || !mediaPath || analyzing}
        onClick={() => void autoEnhance()}
        title="영상을 분석해 밝기·대비·채도를 자동으로 보정합니다 (1탭)"
        style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
      >
        {analyzing ? (
          <>
            <span className="spinner sm" /> 분석 중…
          </>
        ) : autoEnhanceEq ? (
          <>
            <Check size={14} /> 자동 보정 적용됨
          </>
        ) : (
          <>
            <Wand2 size={14} /> 자동 보정 (1탭)
          </>
        )}
      </button>
      {autoEnhanceEq && (
        <p className="muted-note" data-testid="auto-enhance-applied" style={{ marginTop: 6 }}>
          적용됨 · 채도 ×{autoEnhanceEq.saturation?.toFixed(2)} · 대비 ×
          {autoEnhanceEq.contrast?.toFixed(2)} · 밝기 {autoEnhanceEq.brightness! >= 0 ? '+' : ''}
          {autoEnhanceEq.brightness?.toFixed(2)} (⌘Z로 되돌리기)
          {eqNeutral && ' · 이미 노출이 좋아 변화가 작아요'}
        </p>
      )}
      <strong style={{ fontSize: 13, marginTop: 12, display: 'block' }}>색보정 (Color)</strong>
      <div className="ov-field" style={{ marginTop: 8 }}>
        프리셋
        <KSelect
          testId="color-preset"
          flex
          value={colorPreset}
          disabled={!timeline}
          onChange={(v) => setColorPreset(v as ColorPreset)}
          options={COLOR_PRESET_OPTS.map((o) => ({ value: o.id, label: o.label }))}
        />
      </div>
      <strong style={{ fontSize: 13, marginTop: 12, display: 'block' }}>비율 (Reframe)</strong>
      <div className="ov-field" style={{ marginTop: 8 }}>
        익스포트 비율
        <KSelect
          testId="reframe"
          flex
          value={reframe}
          disabled={!timeline}
          onChange={(v) => setReframe(v as 'source' | '9:16' | '1:1')}
          options={REFRAME_OPTS.map((o) => ({ value: o.id, label: o.label }))}
        />
      </div>
      <p className="note-strong">
        미리보기는 분위기만 보여줘요. 실제 색·비율은 <b>내보낼 때 정확히 적용</b>됩니다.{' '}
        <b>9:16·1:1은 화면 가운데를 기준으로 잘립니다.</b>
      </p>
    </div>
  );
}

function Dock() {
  const { panel } = useEditor();
  const titles: Record<PanelId, string> = {
    media: '미디어',
    text: '음성 · TTS',
    sticker: '스티커 · GIF',
    effect: '효과 · 색보정',
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
// 리프레임(9:16·1:1) 중앙 크롭 가이드. export의 cropForAspect와 동일 공식으로 잘릴 영역을
// 반투명 마스크 + 세이프프레임 테두리로 프리뷰에 그린다(미리보기 비율은 원본 그대로 두고 오버레이만).
function ReframeMask({
  reframe,
  srcW,
  srcH,
}: { reframe: '9:16' | '1:1'; srcW: number; srcH: number }) {
  const target = reframe === '9:16' ? 9 / 16 : 1; // 목표 가로/세로 비
  const src = srcW / srcH;
  // src가 더 넓으면 좌우가 잘리고, 더 좁으면(세로 영상) 상하가 잘린다.
  const cutsSides = src > target;
  const keepFrac = cutsSides ? target / src : src / target; // 유지되는 가로(또는 세로) 비율
  const bandPct = `${((1 - keepFrac) / 2) * 100}%`;
  const safe: CSSProperties = cutsSides
    ? { top: 0, bottom: 0, left: bandPct, right: bandPct }
    : { left: 0, right: 0, top: bandPct, bottom: bandPct };
  return (
    <div className="reframe-mask" data-testid="reframe-mask" data-aspect={reframe}>
      {cutsSides ? (
        <>
          <div className="reframe-band" style={{ top: 0, bottom: 0, left: 0, width: bandPct }} />
          <div className="reframe-band" style={{ top: 0, bottom: 0, right: 0, width: bandPct }} />
        </>
      ) : (
        <>
          <div className="reframe-band" style={{ left: 0, right: 0, top: 0, height: bandPct }} />
          <div className="reframe-band" style={{ left: 0, right: 0, bottom: 0, height: bandPct }} />
        </>
      )}
      <div className="reframe-safe" style={safe} />
      <span className="reframe-tag">{reframe} 영역</span>
    </div>
  );
}

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
    reframe,
    frameW,
    frameH,
  } = useEditor();
  const selectedOverlay = overlays.find((o) => o.id === selectedOverlayId) ?? null;
  const liveCap = useLiveCaption();
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
            {previewPath && (
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
            )}
            {/* 변환 중(proxyBusy)이거나 아직 미리보기 경로가 없으면 안내 오버레이를 영상 위에 덮어
                검은 화면 오해를 막는다. (프록시가 previewPath를 먼저 세팅하는 레이스에도 견고) */}
            {(proxyBusy || !previewPath) && (
              <div
                className={`video-err${previewPath ? '' : ' standalone'}`}
                data-testid="proxy-busy"
              >
                <span className="spinner" />
                <div className="big">미리보기 변환 중…</div>
                <div className="sub">
                  큰/고해상도·비표준 코덱(AV1 등) 영상을 미리보기용으로 변환하고 있어요(몇 초).
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
            {reframe !== 'source' && frameW > 0 && frameH > 0 && (
              <ReframeMask reframe={reframe} srcW={frameW} srcH={frameH} />
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
            {/* 번인 전 라이브 자막 — 영상 위에 그대로 얹어 "자막이 들어간다"를 눈으로 확인.
                번인(burnt)되면 실제 subtitle 오버레이가 같은 자리에 떠 이중표시가 안 되게 끈다. */}
            {previewPath && !videoErr && !liveCap.burnt && liveCap.caption && (
              <VideoCaption
                style={liveCap.style}
                text={liveCap.caption}
                emphasis={liveCap.emphasis}
                pos={liveCap.pos}
              />
            )}
          </div>
        ) : (
          <div className="empty-stage">
            <div className="big">여기에 영상을 끌어다 놓으세요</div>
            <div>또는 상단 “가져오기”를 누르세요 — 자막은 “자막 생성” 버튼으로 만듭니다.</div>
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
            <Trash2 size={13} /> 이 오버레이 제거
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

// 자막 프리셋 갤러리 썸네일 — 각 프리셋 룩을 대표 텍스트로 작게 미리 그려 한눈에 고르게 한다
// (드롭다운의 id 텍스트보다 직관적). 클릭 시 applyPreset. drawSubtitle 동일 경로 = WYSIWYG.
function PresetThumb({
  id,
  label,
  sample,
  active,
  onPick,
}: { id: string; label: string; sample: string; active: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 128;
    const H = 44;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(0, 0, W, H);
    drawSubtitle(ctx, W, H, sample, SUBTITLE_PRESETS[id] ?? {});
  }, [id, sample]);
  return (
    <button
      type="button"
      className={`preset-card${active ? ' on' : ''}`}
      data-testid={`sub-preset-card-${id}`}
      onClick={onPick}
      title={label}
    >
      <canvas ref={ref} />
      <span>{label}</span>
    </button>
  );
}

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

// 현재 playhead의 자막 한 줄(받아쓰기 또는 수기) — 번인과 '동일 경로'(transcriptToCues/manualToCues
// → captionFrames → wrapCaption)로 계산해 미리보기 카드와 영상 위 라이브 자막이 정확히 일치한다.
// Transcript 카드와 달리 cue를 못 찾으면 null(fallback 없음) — 영상 위엔 "지금 보일 자막"만 떠야 한다.
function useLiveCaption() {
  const { transcript, timeline, manualCues, playheadUs, subtitleStyle, subtitlePos, overlays } =
    useEditor();
  const subAnim = subtitleStyle.animation ?? 'none';
  const emphasizeKeywords = subtitleStyle.emphasizeKeywords ?? false;
  const burnt = overlays.some((o) => o.kind === 'subtitle');
  const currentCue = useMemo(() => {
    if (!timeline) return null;
    const cues = transcript
      ? transcriptToCues(transcript, timeline, cueOptsForAnim(subAnim))
      : manualToCues(manualCues);
    return cues.find((c) => playheadUs >= c.startUs && playheadUs < c.endUs) ?? null;
  }, [transcript, timeline, playheadUs, subAnim, manualCues]);
  const currentFrame = useMemo(() => {
    if (!currentCue) return null;
    const frames = captionFrames(currentCue, subAnim);
    return frames.find((f) => playheadUs >= f.startUs && playheadUs < f.endUs) ?? frames[0] ?? null;
  }, [currentCue, subAnim, playheadUs]);
  const caption = useMemo(
    () =>
      currentFrame ? wrapCaption(currentFrame.text, { maxCharsPerLine: 16, maxLines: 2 }) : '',
    [currentFrame],
  );
  const emphasis = useMemo(() => {
    if (!currentCue) return undefined;
    if (subAnim === 'karaoke' && currentFrame?.activeWord)
      return new Set([currentFrame.activeWord]);
    return emphasisFor(currentCue.text, emphasizeKeywords);
  }, [currentCue, currentFrame, subAnim, emphasizeKeywords]);
  return { caption, emphasis, style: subtitleStyle, pos: subtitlePos, burnt };
}

// 영상 프레임 위에 그대로 얹는 라이브 자막 밴드(SubtitlePreview와 동일한 drawSubtitle/밴드 수학,
// 다만 무대가 아니라 실제 .video-frame을 관측). 번인 전에도 "자막이 영상에 들어간다"를 눈으로 확인.
function VideoCaption({
  style,
  text,
  emphasis,
  pos,
}: {
  style: SubtitleStyle;
  text: string;
  emphasis?: ReadonlySet<string>;
  pos: { x: number; y: number; scale: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const frame = c?.parentElement;
    if (!c || !frame) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const fw = frame.clientWidth;
      const fh = frame.clientHeight;
      if (fw < 8 || fh < 8) return;
      const bandW = Math.max(48, Math.round(fw * pos.scale));
      const bandH = Math.max(14, Math.round(bandW * 0.15)); // export raster 1000:150 비율
      c.width = Math.round(bandW * dpr);
      c.height = Math.round(bandH * dpr);
      c.style.width = `${bandW}px`;
      c.style.height = `${bandH}px`;
      c.style.left = `${Math.round(Math.min(Math.max(0, pos.x), Math.max(0, 1 - pos.scale)) * fw)}px`;
      c.style.top = `${Math.round(Math.min(Math.max(0, pos.y), 1) * Math.max(0, fh - bandH))}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, bandW, bandH);
      drawSubtitle(ctx, bandW, bandH, text, style, emphasis);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [style, text, emphasis, pos.x, pos.y, pos.scale]);
  return <canvas className="live-cap" ref={ref} data-testid="live-caption" />;
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
    manualCues,
    addManualCue,
    updateManualCue,
    removeManualCue,
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
  const [presetSel, setPresetSel] = useState('default'); // 자막 프리셋 드롭다운 표시값
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
  // 키워드 강조 on/off는 subtitleStyle.emphasizeKeywords(EditorState, command bus·MCP 구동)에서.
  const emphasizeKeywords = subtitleStyle.emphasizeKeywords ?? false;
  // 미리보기 자막은 '번인과 동일한' 파라미터(cueOpts·captionFrames·강조)를 써야 텍스트가 일치한다
  // (예전엔 미리보기가 기본 cueOpts라 애니/스타일팩에서 번인과 다른 문장이 떴음).
  const subAnim = subtitleStyle.animation ?? 'none';
  const currentCue = useMemo(() => {
    if (!timeline) return null;
    // 받아쓰기 자막이 있으면 그걸, 없으면 수기 자막을 미리보기 단일 출처로 쓴다(무음 영상 대응).
    const cues = transcript
      ? transcriptToCues(transcript, timeline, cueOptsForAnim(subAnim))
      : manualToCues(manualCues);
    return cues.find((c) => playheadUs >= c.startUs && playheadUs < c.endUs) ?? cues[0] ?? null;
  }, [transcript, timeline, playheadUs, subAnim, manualCues]);
  // 현재 playhead가 속한 애니 서브프레임(번인과 동일: captionFrames). 'none'이면 cue 전체 1프레임.
  const currentFrame = useMemo(() => {
    if (!currentCue) return null;
    const frames = captionFrames(currentCue, subAnim);
    return frames.find((f) => playheadUs >= f.startUs && playheadUs < f.endUs) ?? frames[0] ?? null;
  }, [currentCue, subAnim, playheadUs]);
  const currentCaption = useMemo(
    () =>
      currentFrame ? wrapCaption(currentFrame.text, { maxCharsPerLine: 16, maxLines: 2 }) : '',
    [currentFrame],
  );
  // emphasis Set은 메모이즈(안정 참조)해야 SubtitlePreview useEffect 무한재그림 방지.
  // karaoke는 활성 어절만 강조(번인 doBurn과 동형), 그 외엔 키워드 강조.
  const currentEmphasis = useMemo(() => {
    if (!currentCue) return undefined;
    if (subAnim === 'karaoke' && currentFrame?.activeWord)
      return new Set([currentFrame.activeWord]);
    return emphasisFor(currentCue.text, emphasizeKeywords);
  }, [currentCue, currentFrame, subAnim, emphasizeKeywords]);
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
    const { transcript: tr, timeline: tl, manualCues: mc } = useEditor.getState();
    if (!tl) return;
    // 애니메이션(reveal/karaoke)이면 짧은 쇼츠형 cue로 끊어 단어가 또박또박 등장하게 한다.
    // animation 'none'(또는 미설정)이면 기존 동작 그대로(기본 cue, cue당 1오버레이) — e2e 보존.
    const anim = style.animation ?? 'none';
    // 자막 소스 = 받아쓰기(transcript) cue + 수기 자막(manualCues). 둘 다 있으면 합쳐 번인.
    const cues = [
      ...(tr ? transcriptToCues(tr, tl, cueOptsForAnim(anim)) : []),
      ...manualToCues(mc),
    ];
    for (const c of cues) {
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
            // pop: 작은 크기에서 시작 → 초반 구간 동안 풀크기로 커지는 키프레임 주입(스케일-인).
            scale: anim === 'pop' ? pos.scale * POP_FROM : pos.scale,
            ...(anim === 'pop'
              ? { keyframes: [{ u: POP_U, scale: pos.scale, easing: 'easeOut' as const }] }
              : {}),
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
    if (!timeline) return;
    if (burnt) {
      clearOverlaysByKind('subtitle');
      return;
    }
    if (!transcript && manualCues.length === 0) return; // 받아쓰기·수기 자막 둘 다 없으면 할 게 없음
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
          disabled={!transcript && manualCues.length === 0}
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
      {/* 헤더 아래 전체를 단일 스크롤 영역으로 — 작은 창에서 자막카드·갤러리가 잘리지 않고 스크롤된다. */}
      <div className="transcript-scroll">
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
            <KSelect
              testId="style-pack"
              flex
              placeholder="스타일 팩 1클릭 — 색·자막·말버릇 한 번에"
              value=""
              onChange={(id) => {
                if (id) void applyPackAndBurn(id);
              }}
              options={STYLE_PACKS.map((p) => ({ value: p.id, label: `${p.label} · ${p.genre}` }))}
            />
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
                {!planReport.ok && (
                  <span className="plan-bad"> · 적용 불가: {planReport.error}</span>
                )}
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
            <div className="sub-group sub-gallery-group">
              <span className="sub-group-label">스타일</span>
              <div className="preset-gallery" data-testid="preset-gallery">
                {PRESET_META.map((m) => (
                  <PresetThumb
                    key={m.id}
                    id={m.id}
                    label={m.label}
                    sample={m.sample}
                    active={presetSel === m.id}
                    onPick={() => {
                      setPresetSel(m.id);
                      void applyPreset(m.id);
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="sub-group">
              <span className="sub-group-label">애니메이션</span>
              <KSelect
                testId="sub-animation"
                flex
                value={subtitleStyle.animation ?? 'none'}
                onChange={(v) => applyStyle({ animation: v as SubtitleStyle['animation'] })}
                options={[
                  { value: 'none', label: '없음 (한 번에)' },
                  { value: 'pop', label: '팝 (커지며 등장)' },
                  { value: 'reveal', label: '한 어절씩 등장' },
                  { value: 'typewriter', label: '타자기 (글자씩)' },
                  { value: 'karaoke', label: '가라오케(노래방)' },
                ]}
              />
            </div>
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
                <div className="sub-ctl">
                  <span>배경</span>
                  <KSelect
                    testId="sub-bg"
                    flex
                    value={subtitleStyle.bg ?? 'rgba(0,0,0,0.55)'}
                    onChange={(v) => applyStyle({ bg: v })}
                    options={[
                      { value: 'rgba(0,0,0,0.55)', label: '어둡게 55%' },
                      { value: 'rgba(0,0,0,0.85)', label: '어둡게 85%' },
                      { value: 'rgba(255,255,255,0.7)', label: '밝게' },
                      { value: 'transparent', label: '없음' },
                    ]}
                  />
                </div>
                <div className="sub-ctl">
                  <span>폰트</span>
                  <KSelect
                    testId="sub-font"
                    flex
                    value={subtitleStyle.fontFamily ?? 'system-ui, sans-serif'}
                    onChange={(v) => applyStyle({ fontFamily: v })}
                    options={[
                      { value: 'system-ui, sans-serif', label: '시스템' },
                      { value: 'Georgia, serif', label: '세리프' },
                      { value: "'Courier New', monospace", label: '고정폭' },
                      { value: 'Impact, sans-serif', label: '임팩트' },
                      {
                        value:
                          '"Apple SD Gothic Neo", "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif',
                        label: '한글(CJK)',
                      },
                    ]}
                  />
                </div>
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
                        <X size={14} />
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
                    : '이 영상엔 오디오가 없어 받아쓰기는 불가해요. 대신 아래 "직접 자막 입력"으로 캡션을 타이핑할 수 있습니다.'}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn"
                  data-testid="add-manual-cue"
                  onClick={() => addManualCue('')}
                  title="현재 재생 위치에 자막을 직접 입력합니다 (음성 없어도 가능)"
                >
                  <Pencil size={13} /> 직접 자막 입력
                </button>
              </div>
            </div>
          )}
          {manualCues.length > 0 && (
            <div className="manual-cues" data-testid="manual-cues">
              <div className="field" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>직접 입력 자막 ({manualCues.length})</span>
                <button
                  type="button"
                  className="btn ghost xs"
                  data-testid="add-manual-cue"
                  onClick={() => addManualCue('')}
                  title="현재 재생 위치에 새 자막 추가"
                >
                  <Plus size={13} /> 현재 위치에 추가
                </button>
              </div>
              {[...manualCues]
                .sort((a, b) => a.startUs - b.startUs)
                .map((c) => (
                  <div className="manual-cue" key={c.id}>
                    <input
                      className="input"
                      data-testid="manual-cue-text"
                      value={c.text}
                      placeholder="자막 텍스트를 입력하세요"
                      onChange={(e) => updateManualCue(c.id, { text: e.target.value })}
                    />
                    <div className="manual-cue-time">
                      <button
                        type="button"
                        className="link"
                        onClick={() => setPlayhead(c.startUs)}
                        title="이 자막 시작으로 이동"
                      >
                        {fmt(c.startUs)}~{fmt(c.endUs)}
                      </button>
                      <button
                        type="button"
                        className="btn ghost xs"
                        title="시작을 현재 재생 위치로"
                        onClick={() =>
                          updateManualCue(c.id, {
                            startUs: Math.min(playheadUs, c.endUs - 100_000),
                          })
                        }
                      >
                        시작=현재
                      </button>
                      <button
                        type="button"
                        className="btn ghost xs"
                        title="끝을 현재 재생 위치로"
                        onClick={() =>
                          updateManualCue(c.id, {
                            endUs: Math.max(playheadUs, c.startUs + 100_000),
                          })
                        }
                      >
                        끝=현재
                      </button>
                      <button
                        type="button"
                        className="x"
                        data-testid="manual-cue-remove"
                        title="삭제"
                        onClick={() => removeManualCue(c.id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              <p className="muted-note">
                스크럽으로 위치를 맞춘 뒤 <b>시작=현재 / 끝=현재</b>로 타이밍을 잡고, 위{' '}
                <b>자막 입히기</b>로 영상에 새깁니다. 스타일·애니메이션·내보내기(SRT)는 받아쓰기
                자막과 동일하게 적용돼요.
              </p>
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
    transcript,
    manualCues,
    seekTo,
    selectOverlay,
    selectedOverlayId,
    updateOverlay,
    selectVoice,
    selectedVoiceId,
    updateTts,
  } = useEditor();
  const clips = timeline ? videoClips(timeline) : [];
  // 자막 트랙 블록 = 받아쓰기 cue(문장 단위) + 수기 자막. 라이브 자막/번인과 동일한 소스라
  // "자막을 만들면 타임라인에서 같이 보인다". 클릭하면 그 cue 시작으로 이동(읽기 전용).
  const subtitleCues = useMemo(() => {
    if (!timeline) return [];
    const base = transcript ? transcriptToCues(transcript, timeline, {}) : [];
    return [...base, ...manualToCues(manualCues)].sort((a, b) => a.startUs - b.startUs);
  }, [transcript, timeline, manualCues]);
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
          <span className="lbl">Subtitle</span>
          <div
            className="track thin ov-lane sub-lane"
            data-testid="tl-subtitle-track"
            onClick={seekFromTrack}
            style={{ cursor: timeline ? 'pointer' : 'default' }}
          >
            {subtitleCues.length === 0 ? (
              <span className="empty-track">
                자막을 만들면(받아쓰기·직접 입력) 여기에 시간 블록으로 표시 — 클릭=그 자막으로 이동
              </span>
            ) : (
              subtitleCues.map((c, i) => {
                const left = durationProgramUs > 0 ? (c.startUs / durationProgramUs) * 100 : 0;
                const width =
                  durationProgramUs > 0
                    ? Math.max(1.5, ((c.endUs - c.startUs) / durationProgramUs) * 100)
                    : 0;
                return (
                  <button
                    type="button"
                    key={`${c.startUs}-${i}`}
                    className="ov-block sub-block"
                    data-testid="sub-block"
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${fmt(c.startUs)}~${fmt(c.endUs)} · ${c.text}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      seekTo(c.startUs);
                    }}
                  >
                    <span className="ov-block-label sub-block-label">{c.text}</span>
                  </button>
                );
              })
            )}
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
              <span className="empty-track">
                스티커·이미지를 추가하면 시간 블록으로 표시 — 드래그=이동 · 양끝=길이 · Delete=삭제
              </span>
            ) : (
              laneOverlays.map((o, idx) => {
                const left = durationProgramUs > 0 ? (o.startUs / durationProgramUs) * 100 : 0;
                const width =
                  durationProgramUs > 0
                    ? Math.max(2, ((o.endUs - o.startUs) / durationProgramUs) * 100)
                    : 0;
                // 미디어 종류는 lucide 아이콘으로(기본 이모지 대신). 이모지 '스티커'는 콘텐츠라 그대로.
                const icon =
                  o.kind === 'image' ? (
                    <ImageIcon size={11} strokeWidth={2} />
                  ) : o.kind === 'gif' ? (
                    <Images size={11} strokeWidth={2} />
                  ) : o.kind === 'video' ? (
                    <Film size={11} strokeWidth={2} />
                  ) : (
                    o.name
                  );
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
              <span className="empty-track">
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
    proxyBusy,
    highlightNotice,
    dismissHighlightNotice,
  } = useEditor();
  // 프록시 변환 중이면 전역 신호를 '변환 중'으로(끝나면 원래 상태). 그 외엔 한국어 라벨 맵.
  const statusLabel = proxyBusy ? '미리보기 변환 중' : (STATUS_KO[status] ?? status);
  return (
    <div className="statusbar">
      <span className={`pill${proxyBusy ? ' busy' : ''}`}>
        <span className="led" />
        {/* 기계 상태값은 sr-only로 DOM에 보존(e2e의 toHaveText 호환), 화면엔 한국어 라벨. */}
        <span className="sr-only" data-testid="status">
          {status}
        </span>
        <span aria-hidden="true">{statusLabel}</span>
      </span>
      <span>
        클립 <b data-testid="clip-count">{clipCount}</b>
      </span>
      <span>
        길이 <b>{fmt(durationProgramUs)}</b>
        {/* 원시 µs는 숨겨 테스트 호환 유지(화면엔 사람이 읽는 시:분만). */}
        <b className="sr-only" data-testid="duration">
          {durationProgramUs}
        </b>
      </span>
      <span title="기록된 편집 명령 수 (결정적 replay/검증 토대)" className="audit">
        <Pencil size={12} /> <b data-testid="audit-count">{auditLog.length}</b>
      </span>
      <span className="spacer" />
      {highlightNotice && (
        <span className="export-done" data-testid="highlight-notice">
          {highlightNotice.cut > 0 ? (
            <>
              <CheckCircle2 size={13} /> 핵심만 남겨 {fmt(highlightNotice.originalUs)} →{' '}
              {fmt(highlightNotice.finalUs)}
            </>
          ) : highlightNotice.originalUs <= highlightNotice.targetSeconds * 1_000_000 ? (
            <>
              <Info size={13} /> 이미 ~{fmt(highlightNotice.originalUs)}라{' '}
              {highlightNotice.targetSeconds}초보다 짧아 컷할 게 없어요
            </>
          ) : (
            <>
              <Info size={13} /> 대부분이 핵심이라 {highlightNotice.targetSeconds}초로는 더 줄이지
              못했어요
            </>
          )}
          <button
            type="button"
            className="x"
            onClick={() => dismissHighlightNotice()}
            aria-label="닫기"
          >
            <X size={14} />
          </button>
        </span>
      )}
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
            <X size={14} />
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
// 상태 알약(좌하단)용 한국어 라벨. 기계 상태값(영문)을 사람이 읽는 말로. BUSY_LABEL을 포함한다.
const STATUS_KO: Record<string, string> = {
  idle: '대기',
  ready: '준비됨',
  exported: '내보냄 완료',
  'gif exported': 'GIF 내보냄 완료',
  'srt exported': '자막 저장 완료',
  saved: '저장됨',
  opened: '불러옴',
  'voice ready': '음성 준비됨',
  ...BUSY_LABEL,
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
              ? silencePreview.count > 0
                ? `감지 ${silencePreview.count}곳 · −${fmt(silencePreview.savedUs)}`
                : '제거할 무음 없음 — 민감도/최소 무음을 조절해 보세요'
              : '감지 중…'}
          </div>
          <button
            type="button"
            className="btn primary"
            data-testid="silence-apply"
            disabled={!silencePreview || silencePreview.count === 0}
            onClick={async () => {
              setOpen(false);
              await removeSilencesAction();
            }}
          >
            {silencePreview && silencePreview.count === 0
              ? '제거할 무음 없음'
              : '이 설정으로 무음 제거'}
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
      // 수기 자막(무음 영상 대응) 자동화 표면 — 라이브 자막 미리보기 검증에 사용.
      addManualCue: (text: string) => useEditor.getState().addManualCue(text),
      setPlayhead: (us: number) => useEditor.getState().setPlayhead(us),
      addOverlaySrc: (kind: 'image' | 'gif' | 'video', name: string, path: string) =>
        useEditor.getState().addOverlaySrc(kind, name, path),
    };
    // QA/검증용 읽기 스냅샷(상태 단언). __editor와 동일하게 무해한 자동화 표면.
    window.__dawnState = () => {
      const st = useEditor.getState();
      return {
        status: st.status,
        clipCount: st.clipCount,
        durationProgramUs: st.durationProgramUs,
        overlays: st.overlays.length,
        subtitleOverlays: st.overlays.filter((o) => o.kind === 'subtitle').length,
        ttsClips: st.ttsClips.length,
        words: st.transcript?.order.length ?? 0,
        selectedOverlayId: st.selectedOverlayId,
        selectedVoiceId: st.selectedVoiceId,
        previewIsProxy: Boolean(st.previewPath && st.previewPath !== st.mediaPath),
        proxyBusy: st.proxyBusy,
        hasAudio: st.hasAudio,
        auditLog: st.auditLog.length,
      };
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
            <X size={14} />
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
