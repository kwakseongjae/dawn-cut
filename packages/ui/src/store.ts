import {
  applyCommand,
  applyGlossary,
  buildTranscriptModel,
  createInitialTimeline,
  deserializeProject,
  formatSrt,
  makeProject,
  serializeProject,
  timelineToEdl,
  transcriptToCues,
  videoClips,
} from '@dawn-cut/core';
import type {
  GlossaryPair,
  OverlayClip,
  SubtitleStyle,
  TimelineModel,
  TranscriptModel,
} from '@dawn-cut/core';
import { create } from 'zustand';

const MEDIA_ID = 'media';

interface EditorState {
  mediaPath: string | null;
  transcript: TranscriptModel | null;
  timeline: TimelineModel | null;
  selected: string[]; // selected word ids
  status: string;
  clipCount: number;
  durationProgramUs: number;
  past: TimelineModel[];
  future: TimelineModel[];
  canUndo: boolean;
  canRedo: boolean;
  playheadUs: number;
  playing: boolean;
  // ── CapCut-style asset panels (functional + preview stubs) ──
  panel: PanelId;
  overlays: Overlay[]; // image/sticker/gif references
  ttsClips: TtsClip[]; // generated voiceovers (preview stub)
  frameW: number;
  frameH: number;
  selectedOverlayId: string | null;
  subtitlePos: { x: number; y: number; scale: number };
  subtitleStyle: SubtitleStyle;

  importPath: (path: string) => Promise<void>;
  toggleWord: (id: string) => void;
  deleteSelection: () => void;
  removeSilencesAction: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  exportTo: (path: string) => Promise<void>;
  exportVideo: (path: string, format: 'mp4' | 'gif') => Promise<void>;
  exportSrt: (path: string) => Promise<void>;
  saveProject: (path: string) => Promise<void>;
  openProject: (path: string) => Promise<void>;
  setPlayhead: (us: number) => void;
  setPlaying: (p: boolean) => void;
  setPanel: (p: PanelId) => void;
  addImageOverlay: (path: string) => void;
  addOverlaySrc: (kind: Overlay['kind'], name: string, src: string) => void;
  addOverlayWith: (o: Omit<Overlay, 'id'>) => void;
  clearOverlaysByKind: (kind: Overlay['kind']) => void;
  addAssetStub: (kind: Overlay['kind'], name: string) => void;
  selectOverlay: (id: string | null) => void;
  updateOverlay: (id: string, patch: Partial<Overlay>) => void;
  generateVoiceover: (voice: string, text: string) => Promise<void>;
  removeOverlay: (id: string) => void;
  setSubtitlePos: (patch: Partial<{ x: number; y: number; scale: number }>) => void;
  setSubtitleStyle: (patch: SubtitleStyle) => void;
  replaceSubtitleStyle: (style: SubtitleStyle) => void;
  keywordEmphasis: boolean; // 키워드 강조 자막 on/off (색은 subtitleStyle.emphasisColor)
  setKeywordEmphasis: (on: boolean) => void;
  // ── 한글 검수 자동화 (어절 위) ──
  glossary: GlossaryPair[]; // 고유명사 '내 사전' (localStorage 영속)
  addGlossaryPair: (from: string, to: string) => void;
  removeGlossaryPair: (index: number) => void;
  applyGlossaryNow: () => void; // 현재 전사에 사전 치환 적용
  removeFillers: () => void; // 말버릇(음/어…) 어절을 타임라인에서 컷
  // ── 대기 UX / 완료 / 무음 제어 (사이클2) ──
  sourceDurationUs: number; // 원본 미디어 길이(완료 카드의 '원본')
  lastExport: { path: string; format: string; originalUs: number; finalUs: number } | null;
  silenceParams: { noiseDb: number; minSilenceMs: number };
  silencePreview: { count: number; savedUs: number } | null;
  setSilenceParams: (patch: Partial<{ noiseDb: number; minSilenceMs: number }>) => void;
  refreshSilencePreview: () => Promise<void>;
  revealExport: () => void;
  dismissExport: () => void;
}

export type PanelId = 'media' | 'text' | 'sticker' | 'effect';
export interface Overlay {
  id: string;
  kind: 'image' | 'sticker' | 'gif' | 'subtitle' | 'video';
  name: string;
  // Original caption text (for subtitles only) — kept so we can re-rasterize
  // this single overlay if the user tweaks its per-cue style or text.
  text?: string;
  // Per-cue override of the global subtitle style. Falls back to global on burn.
  cueStyle?: SubtitleStyle;
  src?: string; // file path for image/gif; undefined for emoji sticker (preview until rasterized)
  // placement (normalized) — mirrors core OverlayClip
  x: number;
  y: number;
  scale: number;
  opacity: number;
  startUs: number;
  endUs: number;
  z: number;
  // animation (linear/eased interp) + multi-keyframe + rotation + blend mode
  to?: {
    x?: number;
    y?: number;
    scale?: number;
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  };
  keyframes?: Array<{
    u: number;
    x?: number;
    y?: number;
    scale?: number;
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  }>;
  rotation?: number;
  blend?: 'normal' | 'screen' | 'multiply' | 'overlay' | 'lighten' | 'darken';
}
// default corner placements (with margin), cycled by index
const CORNERS = [
  { x: 0.62, y: 0.06 },
  { x: 0.62, y: 0.62 },
  { x: 0.06, y: 0.06 },
  { x: 0.06, y: 0.62 },
];
function placement(
  index: number,
  durationUs: number,
): Omit<Overlay, 'id' | 'kind' | 'name' | 'src'> {
  const c = CORNERS[index % CORNERS.length]!;
  return {
    x: c.x,
    y: c.y,
    scale: 0.3,
    opacity: 1,
    startUs: 0,
    endUs: durationUs || 1_000_000,
    z: index,
  };
}
export interface TtsClip {
  id: string;
  voice: string;
  text: string;
  wavPath?: string;
}
const uid = () => Math.random().toString(36).slice(2, 9);
const baseName = (p: string) => p.split('/').pop() ?? p;

// '내 사전'은 미디어를 넘어 유지되도록 localStorage에 영속.
const GLOSSARY_KEY = 'dawn.glossary';
function loadGlossary(): GlossaryPair[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(GLOSSARY_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveGlossary(g: GlossaryPair[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(GLOSSARY_KEY, JSON.stringify(g));
  } catch {
    // ignore (private mode / unavailable)
  }
}

/** Map UI overlays that have a real file (image/gif) to core OverlayClips,
 *  clamping the time range to the (possibly edited) program duration. */
function toClips(overlays: Overlay[], durationUs: number): OverlayClip[] {
  return overlays
    .filter((o) => o.src)
    .map((o) => {
      const endUs = Math.min(o.endUs || durationUs, durationUs);
      const startUs = Math.min(o.startUs, Math.max(0, endUs - 1));
      return {
        id: o.id,
        kind: o.kind,
        src: o.src!,
        x: o.x,
        y: o.y,
        scale: o.scale,
        opacity: o.opacity,
        startUs,
        endUs,
        z: o.z,
        ...(o.to ? { to: o.to } : {}),
        ...(o.keyframes ? { keyframes: o.keyframes } : {}),
        ...(o.rotation ? { rotation: o.rotation } : {}),
        ...(o.blend && o.blend !== 'normal' ? { blend: o.blend } : {}),
      };
    });
}

/** Derived fields for a timeline (clip count + program duration). */
function derive(timeline: TimelineModel) {
  return { clipCount: videoClips(timeline).length, durationProgramUs: timeline.durationProgram };
}

function deadSet(timeline: TimelineModel | null, transcript: TranscriptModel | null): Set<string> {
  // a word is dead if no live clip covers its source interval
  const dead = new Set<string>();
  if (!timeline || !transcript) return dead;
  const clips = videoClips(timeline);
  for (const id of transcript.order) {
    const w = transcript.words[id];
    if (!w) continue;
    const live = clips.some(
      (c) =>
        c.mediaId === w.mediaId && w.sourceStart >= c.sourceStart && w.sourceEnd <= c.sourceEnd,
    );
    if (!live) dead.add(id);
  }
  return dead;
}

export const useEditor = create<EditorState>((set, get) => ({
  mediaPath: null,
  transcript: null,
  timeline: null,
  selected: [],
  status: 'idle',
  clipCount: 0,
  durationProgramUs: 0,
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,
  playheadUs: 0,
  playing: false,
  panel: 'media',
  overlays: [],
  ttsClips: [],
  frameW: 0,
  frameH: 0,
  selectedOverlayId: null,
  subtitlePos: { x: 0.1, y: 0.8, scale: 0.8 },
  subtitleStyle: {},
  keywordEmphasis: false,
  glossary: loadGlossary(),
  sourceDurationUs: 0,
  lastExport: null,
  silenceParams: { noiseDb: -30, minSilenceMs: 500 },
  silencePreview: null,

  setSilenceParams: (patch) =>
    set({ silenceParams: { ...get().silenceParams, ...patch }, silencePreview: null }),
  refreshSilencePreview: async () => {
    const { mediaPath, silenceParams } = get();
    const dawn = window.dawn;
    if (!mediaPath || !dawn) return;
    const silences = await dawn.detectSilences(mediaPath, {
      noiseDb: silenceParams.noiseDb,
      minSilenceUs: silenceParams.minSilenceMs * 1000,
    });
    const savedUs = silences.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
    set({ silencePreview: { count: silences.length, savedUs } });
  },
  revealExport: () => {
    const { lastExport } = get();
    if (lastExport) window.dawn?.revealItem(lastExport.path);
  },
  dismissExport: () => set({ lastExport: null }),

  setSubtitlePos: (patch) => set({ subtitlePos: { ...get().subtitlePos, ...patch } }),
  setSubtitleStyle: (patch) => {
    // command bus 경유(미디어 미로드 시 직접 set fallback — 프리뷰 단계 스타일 조정 허용).
    const { timeline, transcript, subtitleStyle } = get();
    if (!timeline || !transcript) {
      set({ subtitleStyle: { ...subtitleStyle, ...patch } });
      return;
    }
    const { after } = applyCommand(
      { timeline, transcript, subtitleStyle },
      { type: 'setSubtitleStyle', patch },
    );
    set({ subtitleStyle: after.subtitleStyle ?? {} });
  },
  replaceSubtitleStyle: (style) => {
    const { timeline, transcript } = get();
    if (!timeline || !transcript) {
      set({ subtitleStyle: style });
      return;
    }
    const { after } = applyCommand(
      { timeline, transcript, subtitleStyle: style },
      { type: 'replaceSubtitleStyle', style },
    );
    set({ subtitleStyle: after.subtitleStyle ?? {} });
  },
  setKeywordEmphasis: (on) => set({ keywordEmphasis: on }),

  selectOverlay: (id) => set({ selectedOverlayId: id }),
  updateOverlay: (id, patch) =>
    set({ overlays: get().overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) }),

  setPlayhead: (us) => set({ playheadUs: us }),
  setPlaying: (p) => set({ playing: p }),
  setPanel: (p) => set({ panel: p }),
  addImageOverlay: (path) => {
    const { overlays, durationProgramUs } = get();
    set({
      overlays: [
        ...overlays,
        {
          id: uid(),
          kind: 'image',
          name: baseName(path),
          src: path,
          ...placement(overlays.length, durationProgramUs),
        },
      ],
    });
  },
  addOverlaySrc: (kind, name, src) => {
    const { overlays, durationProgramUs } = get();
    set({
      overlays: [
        ...overlays,
        { id: uid(), kind, name, src, ...placement(overlays.length, durationProgramUs) },
      ],
    });
  },
  addOverlayWith: (o) => set({ overlays: [...get().overlays, { id: uid(), ...o }] }),
  clearOverlaysByKind: (kind) => set({ overlays: get().overlays.filter((o) => o.kind !== kind) }),
  addAssetStub: (kind, name) => {
    const { overlays, durationProgramUs } = get();
    set({
      overlays: [
        ...overlays,
        { id: uid(), kind, name, ...placement(overlays.length, durationProgramUs) },
      ],
    });
  },
  generateVoiceover: async (voice, text) => {
    const dawn = window.dawn;
    if (!dawn) return;
    set({ status: 'synthesizing voice' });
    const res = await dawn.synthesizeTts(text, voice);
    set({
      ttsClips: [...get().ttsClips, { id: uid(), voice, text, wavPath: res.wavPath }],
      status: 'voice ready',
    });
  },
  removeOverlay: (id) =>
    set({
      overlays: get().overlays.filter((o) => o.id !== id),
      selectedOverlayId: get().selectedOverlayId === id ? null : get().selectedOverlayId,
    }),

  importPath: async (path) => {
    const dawn = window.dawn;
    if (!dawn) throw new Error('bridge unavailable');
    set({ status: 'probing' });
    const probe = await dawn.probe(path);
    set({ status: 'extracting' });
    const { wavPath } = await dawn.extractAudio(path);
    set({ status: 'transcribing' });
    const tr = await dawn.transcribe(wavPath, MEDIA_ID);
    // 전사 직후 '내 사전'을 적용해 자주 틀리는 고유명사를 교정한다.
    const subWords = applyGlossary(tr.words, get().glossary);
    const transcript = buildTranscriptModel(subWords, MEDIA_ID, tr.language);
    const timeline = createInitialTimeline(MEDIA_ID, probe.durationUs, probe.fps || 30);
    set({
      mediaPath: path,
      transcript,
      timeline,
      selected: [],
      status: 'ready',
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
      playheadUs: 0,
      playing: false,
      overlays: [],
      selectedOverlayId: null,
      frameW: probe.width,
      frameH: probe.height,
      sourceDurationUs: probe.durationUs,
      lastExport: null,
      silencePreview: null,
      ...derive(timeline),
    });
  },

  toggleWord: (id) => {
    const { selected } = get();
    set({ selected: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });
  },

  deleteSelection: () => {
    const { transcript, timeline, selected } = get();
    if (!transcript || !timeline || selected.length === 0) return;
    const idxs = selected
      .map((id) => transcript.order.indexOf(id))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    const fromId = transcript.order[idxs[0]!]!;
    const toId = transcript.order[idxs[idxs.length - 1]!]!;
    const { after } = applyCommand(
      { timeline, transcript },
      { type: 'deleteWordRange', fromWordId: fromId, toWordId: toId },
    );
    set({
      timeline: after.timeline,
      selected: [],
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      ...derive(after.timeline),
    });
  },

  removeSilencesAction: async () => {
    const { timeline, transcript, mediaPath, silenceParams } = get();
    const dawn = window.dawn;
    if (!timeline || !transcript || !mediaPath || !dawn) return;
    set({ status: 'detecting silence' });
    const silences = await dawn.detectSilences(mediaPath, {
      noiseDb: silenceParams.noiseDb,
      minSilenceUs: silenceParams.minSilenceMs * 1000,
    });
    // 감지=sidecar IO, 적용=command bus.
    const { after } = applyCommand(
      { timeline, transcript },
      { type: 'removeSilences', silences, padUs: 0 },
    );
    set({
      timeline: after.timeline,
      status: 'ready',
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      ...derive(after.timeline),
    });
  },

  undo: () => {
    const { past, future, timeline } = get();
    if (past.length === 0 || !timeline) return;
    const prev = past[past.length - 1]!;
    const newPast = past.slice(0, -1);
    set({
      timeline: prev,
      past: newPast,
      future: [timeline, ...future],
      selected: [],
      status: 'undo',
      canUndo: newPast.length > 0,
      canRedo: true,
      ...derive(prev),
    });
  },

  redo: () => {
    const { past, future, timeline } = get();
    if (future.length === 0 || !timeline) return;
    const next = future[0]!;
    const newFuture = future.slice(1);
    set({
      timeline: next,
      past: [...past, timeline],
      future: newFuture,
      selected: [],
      status: 'redo',
      canUndo: true,
      canRedo: newFuture.length > 0,
      ...derive(next),
    });
  },

  exportTo: async (path) => {
    const { timeline, mediaPath, overlays, frameW, frameH, ttsClips, transcript } = get();
    const dawn = window.dawn;
    if (!timeline || !mediaPath || !dawn) return;
    set({ status: 'exporting' });
    const edl = timelineToEdl(timeline, mediaPath);
    // 자막이 번인되지 않았으면 끌 수 있는 소프트 자막 트랙(mov_text)을 자동 mux.
    // 번인(subtitle 오버레이)된 경우엔 중복을 피해 생략한다.
    let subtitlesPath: string | undefined;
    const burnt = overlays.some((o) => o.kind === 'subtitle');
    if (transcript && !burnt) {
      const cues = transcriptToCues(transcript, timeline);
      if (cues.length) {
        const srtPath = `${path.replace(/\.[^/.]+$/, '')}.srt`;
        await dawn.writeSrt(srtPath, formatSrt(cues));
        subtitlesPath = srtPath;
      }
    }
    const res = await dawn.render(edl, path, {
      overlays: toClips(overlays, timeline.durationProgram),
      frameW,
      frameH,
      voicePath: ttsClips.find((c) => c.wavPath)?.wavPath,
      ...(subtitlesPath ? { subtitlesPath } : {}),
    });
    set({
      status: 'exported',
      lastExport: {
        path,
        format: 'mp4',
        originalUs: get().sourceDurationUs,
        finalUs: res.actualDurationUs,
      },
    });
  },

  exportVideo: async (path, format) => {
    const { timeline, mediaPath, overlays, frameW, frameH, ttsClips } = get();
    const dawn = window.dawn;
    if (!timeline || !mediaPath || !dawn) return;
    set({ status: format === 'gif' ? 'exporting gif' : 'exporting' });
    const edl = timelineToEdl(timeline, mediaPath);
    const res = await dawn.render(edl, path, {
      format,
      overlays: toClips(overlays, timeline.durationProgram),
      frameW,
      frameH,
      voicePath: format === 'gif' ? undefined : ttsClips.find((c) => c.wavPath)?.wavPath,
    });
    set({
      status: format === 'gif' ? 'gif exported' : 'exported',
      lastExport: {
        path,
        format,
        originalUs: get().sourceDurationUs,
        finalUs: res.actualDurationUs,
      },
    });
  },

  exportSrt: async (path) => {
    const { timeline, transcript } = get();
    const dawn = window.dawn;
    if (!timeline || !transcript || !dawn) return;
    set({ status: 'exporting srt' });
    const cues = transcriptToCues(transcript, timeline);
    await dawn.writeSrt(path, formatSrt(cues));
    set({
      status: 'srt exported',
      lastExport: {
        path,
        format: 'srt',
        originalUs: get().sourceDurationUs,
        finalUs: timeline.durationProgram,
      },
    });
  },

  saveProject: async (path) => {
    const { timeline, transcript, mediaPath, subtitlePos, subtitleStyle } = get();
    const dawn = window.dawn;
    if (!timeline || !transcript || !mediaPath || !dawn) return;
    await dawn.saveProject(
      path,
      serializeProject(
        makeProject(mediaPath, transcript, timeline, { subtitlePos, subtitleStyle }),
      ),
    );
    set({ status: 'saved' });
  },

  openProject: async (path) => {
    const dawn = window.dawn;
    if (!dawn) return;
    const project = deserializeProject(await dawn.openProject(path));
    set({
      mediaPath: project.mediaPath,
      transcript: project.transcript,
      timeline: project.timeline,
      selected: [],
      status: 'opened',
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
      playheadUs: 0,
      playing: false,
      clipCount: videoClips(project.timeline).length,
      durationProgramUs: project.timeline.durationProgram,
      subtitlePos: project.subtitlePos ?? { x: 0.1, y: 0.8, scale: 0.8 },
      subtitleStyle: project.subtitleStyle ?? {},
      sourceDurationUs: project.timeline.durationProgram,
      lastExport: null,
      silencePreview: null,
    });
  },

  addGlossaryPair: (from, to) => {
    const f = from.trim();
    if (!f) return;
    const glossary = [...get().glossary.filter((p) => p.from !== f), { from: f, to: to.trim() }];
    saveGlossary(glossary);
    set({ glossary });
    get().applyGlossaryNow();
  },
  removeGlossaryPair: (index) => {
    const glossary = get().glossary.filter((_, i) => i !== index);
    saveGlossary(glossary);
    set({ glossary });
  },
  applyGlossaryNow: () => {
    // command bus 경유(사람 GUI = 에이전트 동일 bus).
    const { transcript, timeline, glossary } = get();
    if (!transcript || !timeline || glossary.length === 0) return;
    const { after } = applyCommand(
      { timeline, transcript },
      { type: 'applyGlossary', pairs: glossary },
    );
    set({ transcript: after.transcript });
  },
  removeFillers: () => {
    // 사람 GUI도 AI 에이전트와 동일한 command bus(applyCommand)를 구동한다 — P1 키스톤.
    const { transcript, timeline } = get();
    if (!transcript || !timeline) return;
    const { after, removedProgramUs } = applyCommand(
      { timeline, transcript },
      { type: 'removeFillers' },
    );
    if (removedProgramUs === 0) return; // 살아있는 말버릇 없음 → 변화 없음
    set({
      timeline: after.timeline,
      selected: [],
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      status: 'ready',
      ...derive(after.timeline),
    });
  },
}));

export { deadSet };
