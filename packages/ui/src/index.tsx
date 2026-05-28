import {
  SUBTITLE_PRESETS,
  clampRange,
  drawBadge,
  drawEmoji,
  drawSubtitle,
  moveOverlay,
  programToWord,
  resizeOverlay,
  timelineToEdl,
  transcriptToCues,
  videoClips,
} from '@dawn-cut/core';
import type { Edl, SubtitleStyle } from '@dawn-cut/core';
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
import type { PanelId } from './store.js';

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
const isVideo = (n: string) => /\.(mp4|mov|m4v|webm|mkv)$/i.test(n);
const isImage = (n: string) => /\.(png|jpe?g|webp|avif)$/i.test(n);
const isGif = (n: string) => /\.gif$/i.test(n);
const filePath = (f: File) => (f as File & { path?: string }).path ?? '';

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
          Import
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
          Open
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
          Save
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
          ↶ Undo
        </button>
        <button
          type="button"
          className="btn ghost"
          data-testid="redo"
          disabled={!s.canRedo}
          onClick={() => s.redo()}
        >
          ↷ Redo
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
          ✂ Remove silences
        </button>
        <button
          type="button"
          className="btn"
          data-testid="delete-selection"
          disabled={s.selected.length === 0}
          onClick={() => s.deleteSelection()}
        >
          Delete ({s.selected.length})
        </button>
        <div className="sep" />
        <div className="menu-wrap">
          <button
            type="button"
            className="btn primary"
            disabled={!s.timeline}
            onClick={() => setMenu((v) => !v)}
          >
            Export ▾
          </button>
          {menu && (
            <div className="menu">
              <button
                type="button"
                data-testid="export-button"
                onClick={() => exportAs(s.exportTo)}
              >
                <span>Video — MP4</span>
                <span className="k badge live">ready</span>
              </button>
              <button
                type="button"
                data-testid="export-gif"
                onClick={() => exportAs((p) => s.exportVideo(p, 'gif'))}
              >
                <span>Animated GIF</span>
                <span className="k badge live">ready</span>
              </button>
              <button type="button" data-testid="export-srt" onClick={() => exportAs(s.exportSrt)}>
                <span>Subtitles — .srt</span>
                <span className="k badge live">ready</span>
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
const RAIL: { id: PanelId; ico: string; label: string; short: string }[] = [
  { id: 'media', ico: '🎬', label: 'Media', short: 'Media' },
  { id: 'text', ico: '🗣', label: 'Text · TTS', short: 'TTS' },
  { id: 'sticker', ico: '✨', label: 'Sticker · GIF', short: 'GIF' },
  { id: 'effect', ico: '🎚', label: 'Effects', short: 'FX' },
];

function Rail() {
  const { panel, setPanel } = useEditor();
  return (
    <div className="rail">
      {RAIL.map((r) => (
        <button
          key={r.id}
          type="button"
          className={panel === r.id ? 'on' : ''}
          onClick={() => setPanel(r.id)}
          title={r.label}
        >
          <span className="ico">{r.ico}</span>
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
        <span className="dz-icon">⬆</span>
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
    transcript,
    importPath,
    overlays,
    addImageOverlay,
    addOverlaySrc,
    removeOverlay,
  } = useEditor();
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
        hint="Drop a video or image here, or click to browse. Video imports + auto-transcribes; images attach as overlays."
      />
      {mediaPath && (
        <div className="asset-card">
          <div className="thumb">🎬</div>
          <div className="meta">
            <div className="name">{mediaPath.split('/').pop()}</div>
            <div className="sub">
              {transcript ? `${transcript.order.length} words transcribed` : 'transcribing…'}
            </div>
          </div>
          <span className="badge live">source</span>
        </div>
      )}
      {overlays
        .filter((o) => o.kind === 'image')
        .map((o) => (
          <div className="asset-card" key={o.id}>
            <div className="thumb">🖼</div>
            <div className="meta">
              <div className="name">{o.name}</div>
              <div className="sub">image overlay</div>
            </div>
            <span className="badge">preview</span>
            <button type="button" className="x" onClick={() => removeOverlay(o.id)}>
              ✕
            </button>
          </div>
        ))}
      <p className="muted-note">
        Reference images/B-roll attach to the timeline as overlays. Compositing onto the video is on
        the roadmap — shown here as <b>preview</b>.
      </p>
    </div>
  );
}

const VOICES = ['Samantha', 'Alex', 'Daniel', 'Aria', 'Nova', 'Echo'];
function TextPanel() {
  const { ttsClips, generateVoiceover } = useEditor();
  const [voice, setVoice] = useState(VOICES[0]!);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  return (
    <div className="dock-body">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>AI Voiceover (TTS)</strong>
        <span className="badge live">mixes on export</span>
      </div>
      <label className="field" htmlFor="tts-voice">
        Voice
      </label>
      <select
        id="tts-voice"
        className="select"
        value={voice}
        onChange={(e) => setVoice(e.target.value)}
      >
        {VOICES.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <label className="field" htmlFor="tts-text">
        Script
      </label>
      <textarea
        id="tts-text"
        className="textarea"
        placeholder="Type what the AI voice should say…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        className="btn primary full"
        data-testid="generate-voiceover"
        disabled={!text.trim() || busy}
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
        {busy ? '… synthesizing' : '🗣 Generate voiceover'}
      </button>
      {ttsClips.map((c) => (
        <div className="list-row" key={c.id}>
          <div className="t">
            {c.voice}
            <small>
              {c.text.slice(0, 42)}
              {c.text.length > 42 ? '…' : ''}
            </small>
          </div>
          <span className="badge live">ready</span>
        </div>
      ))}
      <p className="muted-note">
        Synthesizes a real voice track from text (macOS <code>say</code> by default; Piper if{' '}
        <code>DAWN_PIPER_BIN</code> is set) and <b>mixes it into the export</b>.
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
  const { overlays, addOverlaySrc, removeOverlay } = useEditor();
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
          <div className="list-row" key={o.id}>
            <div className="t">
              {o.kind === 'sticker' ? o.name : `GIF · ${o.name}`}
              <small>{o.kind} · composited</small>
            </div>
            <button type="button" className="x" onClick={() => removeOverlay(o.id)}>
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

const EFFECTS = [
  ['🔍', 'Auto-zoom', 'Screen-Studio style punch-in'],
  ['🖱', 'Cursor highlight', 'spotlight + click ripples'],
  ['🌫', 'Blur region', 'hide sensitive areas'],
  ['💥', 'Shake', 'beat-synced camera shake'],
  ['✨', 'Glitch', 'transition flair'],
];
function EffectPanel() {
  return (
    <div className="dock-body">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Effects & Transitions</strong>
        <span className="badge">preview</span>
      </div>
      {EFFECTS.map(([ico, name, desc]) => (
        <div className="list-row" key={name}>
          <div className="t">
            {ico} {name}
            <small>{desc}</small>
          </div>
          <span className="badge">preview</span>
        </div>
      ))}
      <p className="muted-note">
        Effect catalog UI. Rendering pipeline lands with the GPU compositor — listed as{' '}
        <b>preview</b>.
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
  } = useEditor();
  const selectedOverlay = overlays.find((o) => o.id === selectedOverlayId) ?? null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
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
            <video
              ref={videoRef}
              src={`file://${mediaPath}`}
              preload="auto"
              onEnded={() => setPlaying(false)}
            />
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
            {playing ? '❚❚' : '▶'}
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
          <span className="ov-props-title">{selectedOverlay.name}</span>
          <label className="ov-field">
            size
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
            opacity
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
            start
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
            end
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
            anim x
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
            anim y
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
            rotate
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
            ⟲ reset
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => removeOverlay(selectedOverlay.id)}
          >
            ✕ remove
          </button>
        </div>
      )}
    </div>
  );
}

// ── Transcript (hero) ────────────────────────────────────────────────
const rasterizeSubtitle = (text: string, style: SubtitleStyle = {}) =>
  rasterizeWith(1000, 150, (ctx, w, h) => drawSubtitle(ctx, w, h, text, style));

function SubtitlePreview({ style }: { style: SubtitleStyle }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    // soft frame backdrop so transparent bgs are visible
    const grad = ctx.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, '#2a3a55');
    grad.addColorStop(1, '#16213a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);
    drawSubtitle(ctx, c.width, c.height, 'preview caption', style);
  }, [style]);
  return (
    <canvas
      ref={ref}
      width={320}
      height={60}
      data-testid="sub-preview"
      style={{
        borderRadius: 6,
        border: '1px solid var(--border)',
        display: 'block',
      }}
    />
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

function Transcript() {
  const {
    transcript,
    timeline,
    selected,
    playheadUs,
    toggleWord,
    addOverlayWith,
    clearOverlaysByKind,
    overlays,
    subtitlePos,
    setSubtitlePos,
    subtitleStyle,
    setSubtitleStyle,
    replaceSubtitleStyle,
  } = useEditor();
  const dead = useMemo(() => deadSet(timeline, transcript), [timeline, transcript]);
  const activeId = useMemo(
    () => (timeline && transcript ? programToWord(timeline, transcript, playheadUs) : null),
    [timeline, transcript, playheadUs],
  );
  const burnt = overlays.some((o) => o.kind === 'subtitle');
  const doBurn = async (pos: { x: number; y: number; scale: number }, style: SubtitleStyle) => {
    if (!transcript || !timeline) return;
    for (const c of transcriptToCues(transcript, timeline)) {
      const res = await window.dawn?.writeAsset(rasterizeSubtitle(c.text, style));
      if (res)
        addOverlayWith({
          kind: 'subtitle',
          name: c.text.slice(0, 24),
          src: res.path,
          x: pos.x,
          y: pos.y,
          scale: pos.scale,
          opacity: 1,
          startUs: c.startUs,
          endUs: c.endUs,
          z: 100,
        });
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
  const applyPreset = async (presetId: string) => {
    const next = SUBTITLE_PRESETS[presetId] ?? {};
    replaceSubtitleStyle(next);
    if (burnt) {
      clearOverlaysByKind('subtitle');
      await doBurn(subtitlePos, next);
    }
  };
  return (
    <div className="transcript">
      <div className="panel-head">
        <h2>Transcript</h2>
        <button
          type="button"
          className="btn ghost"
          data-testid="burn-subtitles"
          disabled={!transcript}
          onClick={burnSubtitles}
          style={{ fontSize: 11, padding: '4px 8px' }}
        >
          {burnt ? '✓ subtitles burned' : 'Burn subtitles'}
        </button>
      </div>
      <div className="sub-pos" data-testid="subtitle-pos">
        <SubtitlePreview style={subtitleStyle} />
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
        <div className="sub-pos-sliders">
          <label className="ov-field">
            x
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
          <label className="ov-field">
            y
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
          <label className="ov-field">
            size
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
        <div className="sub-pos-sliders">
          <label className="ov-field">
            preset
            <select
              className="select"
              data-testid="sub-preset"
              defaultValue="default"
              onChange={(e) => applyPreset(e.target.value)}
              style={{ height: 24, fontSize: 11, padding: '0 4px' }}
            >
              {Object.keys(SUBTITLE_PRESETS).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="ov-field">
            color
            <input
              type="color"
              value={subtitleStyle.color ?? '#ffffff'}
              data-testid="sub-color"
              onChange={(e) => applyStyle({ color: e.target.value })}
            />
          </label>
          <label className="ov-field">
            outline
            <input
              type="color"
              value={(subtitleStyle.stroke as string) || '#000000'}
              data-testid="sub-stroke"
              onChange={(e) => applyStyle({ stroke: e.target.value })}
            />
          </label>
          <label className="ov-field">
            bg
            <select
              className="select"
              value={subtitleStyle.bg ?? 'rgba(0,0,0,0.55)'}
              data-testid="sub-bg"
              onChange={(e) => applyStyle({ bg: e.target.value })}
              style={{ height: 24, fontSize: 11, padding: '0 4px' }}
            >
              <option value="rgba(0,0,0,0.55)">dark 55%</option>
              <option value="rgba(0,0,0,0.85)">dark 85%</option>
              <option value="rgba(255,255,255,0.7)">light</option>
              <option value="transparent">none</option>
            </select>
          </label>
          <label className="ov-field">
            font
            <select
              className="select"
              value={subtitleStyle.fontFamily ?? 'system-ui, sans-serif'}
              data-testid="sub-font"
              onChange={(e) => applyStyle({ fontFamily: e.target.value })}
              style={{ height: 24, fontSize: 11, padding: '0 4px' }}
            >
              <option value="system-ui, sans-serif">system</option>
              <option value="Georgia, serif">serif</option>
              <option value="'Courier New', monospace">mono</option>
              <option value="Impact, sans-serif">impact</option>
            </select>
          </label>
        </div>
      </div>
      <div className="transcript-body" data-testid="transcript-panel">
        {!transcript && (
          <div className="empty-transcript">
            Transcript appears after import.
            <br />
            Edit your video by editing the text.
          </div>
        )}
        {transcript?.segments.map((seg) => (
          <div className="seg" key={seg.id}>
            {seg.words.map((id) => {
              const w = transcript.words[id];
              if (!w) return null;
              const isDead = dead.has(id);
              const cls = [
                'word',
                isDead ? 'dead' : '',
                selected.includes(id) ? 'sel' : '',
                id === activeId ? 'active' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <span
                  key={id}
                  className={cls}
                  data-testid="word"
                  data-dead={isDead ? 'true' : 'false'}
                  onClick={() => !isDead && toggleWord(id)}
                  onKeyDown={() => {}}
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
  const { timeline, durationProgramUs, playheadUs, overlays, ttsClips } = useEditor();
  const clips = timeline ? videoClips(timeline) : [];
  const ratio = durationProgramUs > 0 ? playheadUs / durationProgramUs : 0;
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
          <div className="track">
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
          <div className="track thin">
            {overlays.length === 0 ? (
              <span className="track empty-track">drop images / add stickers · preview</span>
            ) : (
              overlays.map((o, i) => (
                <div className="chip" key={o.id} style={{ width: 64, marginLeft: i ? 4 : 0 }}>
                  {o.kind === 'image' ? '🖼' : o.kind === 'gif' ? 'GIF' : o.name}
                </div>
              ))
            )}
          </div>
        </div>
        <div className="trackrow">
          <span className="lbl">Voice</span>
          <div className="track thin">
            {ttsClips.length === 0 ? (
              <span className="track empty-track">AI voiceover · preview</span>
            ) : (
              ttsClips.map((c, i) => (
                <div className="chip audio" key={c.id} style={{ width: 96, marginLeft: i ? 4 : 0 }}>
                  🗣 {c.voice}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  const { status, clipCount, durationProgramUs } = useEditor();
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
      <span className="spacer" />
      <code>MIT · whisper.cpp · FFmpeg · local-only</code>
    </div>
  );
}

export function AppShell() {
  const s = useEditor();
  useEffect(() => {
    window.__editor = {
      importPath: (p: string) => useEditor.getState().importPath(p),
      exportTo: (p: string) => useEditor.getState().exportTo(p),
      exportSrt: (p: string) => useEditor.getState().exportSrt(p),
      saveProject: (p: string) => useEditor.getState().saveProject(p),
      openProject: (p: string) => useEditor.getState().openProject(p),
      exportGif: (p: string) => useEditor.getState().exportVideo(p, 'gif'),
      addImageOverlay: (p: string) => {
        useEditor.getState().addImageOverlay(p);
        return Promise.resolve();
      },
    };
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
