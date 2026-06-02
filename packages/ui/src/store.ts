import {
  appendAudit,
  applyCommand,
  applyGlossary,
  autoEnhanceParams,
  buildPlanPrompt,
  buildTranscriptModel,
  createInitialTimeline,
  deserializeProject,
  dryRunCommands,
  formatSrt,
  makeProject,
  parsePlan,
  plannerManifest,
  ruleBasedPlan,
  serializeProject,
  stylePackById,
  summarizeState,
  timelineToEdl,
  transcriptToCues,
  videoClips,
} from '@dawn-cut/core';
import type {
  AuditEntry,
  ColorEq,
  DryRunReport,
  EditCommand,
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
  advanced: boolean; // 고급(전체) UI 노출 — DAWN_ADVANCED=1(preload). false=쇼케이스 단순 UI.

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
  colorPreset: ColorPreset; // 전역 색보정 프리셋(익스포트 시 전 클립에 적용)
  setColorPreset: (p: ColorPreset) => void;
  // 적응형 자동 보정(1탭): 영상 분석 → autoEnhanceParams → applyAutoEnhance(command bus+감사+undo).
  autoEnhanceEq: ColorEq | null; // 마지막 적용 eq(프리뷰 CSS 근사용; 실제 렌더는 timeline 이펙트)
  autoEnhance: () => Promise<void>;
  correctWord: (wordId: string, text: string) => void; // STT 오인식 어절 교정(검수)
  reframe: Reframe; // 익스포트 종횡비(원본/세로 9:16/정사각 1:1) — 자동 중앙 크롭
  setReframe: (r: Reframe) => void;
  // ── 한글 검수 자동화 (어절 위) ──
  glossary: GlossaryPair[]; // 고유명사 '내 사전' (localStorage 영속)
  addGlossaryPair: (from: string, to: string) => void;
  removeGlossaryPair: (index: number) => void;
  applyGlossaryNow: () => void; // 현재 전사에 사전 치환 적용
  removeFillers: () => void; // 말버릇(음/어…) 어절을 타임라인에서 컷
  auditLog: AuditEntry[]; // 적용된 편집 명령의 결정적 해시체인 기록(replay/검증 토대)
  // ── 자연어 명령 (NL → plan → dryRun 미리보기 → 승인 → commit) ──
  nlBusy: boolean;
  // 승인 대기(승인 전 상태 불변). engine = 이 plan을 만든 주체(로컬 LLM / 룰).
  pendingPlan: { input: string; commands: EditCommand[]; engine: 'llm' | 'rule' } | null;
  planReport: DryRunReport | null; // pendingPlan의 dryRun diff
  nlError: string | null;
  llmReady: boolean; // 로컬 LLM 사용 가능(llama.cpp+모델). false면 룰 플래너만.
  llmReason: string | null; // llmReady=false 사유(사람이 읽을 메시지) 또는 null.
  detectLlm: () => Promise<void>; // 마운트 시 1회 llm:available 조회 → llmReady/llmReason 설정
  planAndPreview: (input: string) => Promise<void>; // NL → (LLM 가능시 LLM, 실패시 룰) → dryRun
  approvePlan: () => void; // 유일한 상태변경 지점: 각 cmd applyCommand + appendAudit
  rejectPlan: () => void;
  applyStylePack: (id: string) => void; // 1클릭 스타일 팩: 팩 commands를 command bus+감사로 적용
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

export type ColorPreset = 'none' | 'warm' | 'cool' | 'punch' | 'cinematic' | 'flat' | 'vivid';
export type Reframe = 'source' | '9:16' | '1:1';
/** 색보정 프리셋(전역 룩)을 전 클립에 적용한 타임라인(익스포트용). command bus 경유, 길이 불변. */
function gradeTimeline(
  timeline: TimelineModel,
  transcript: TranscriptModel | null,
  preset: ColorPreset,
): TimelineModel {
  if (preset === 'none' || !transcript) return timeline;
  return applyCommand({ timeline, transcript }, { type: 'applyColorgrade', preset }).after.timeline;
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
  // preload가 노출한 DAWN_ADVANCED 플래그(모듈 로드 시 1회 평가; 비-electron/테스트=false).
  advanced: typeof window !== 'undefined' ? (window.dawn?.advanced ?? false) : false,
  keywordEmphasis: false,
  colorPreset: 'none',
  autoEnhanceEq: null,
  reframe: 'source',
  glossary: loadGlossary(),
  auditLog: [],
  sourceDurationUs: 0,
  lastExport: null,
  silenceParams: { noiseDb: -30, minSilenceMs: 500 },
  silencePreview: null,
  nlBusy: false,
  pendingPlan: null,
  planReport: null,
  nlError: null,
  llmReady: false,
  llmReason: null,

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
  setColorPreset: (p) => set({ colorPreset: p }),
  setReframe: (r) => set({ reframe: r }),

  autoEnhance: async () => {
    // 1탭 적응형 보정: 영상을 분석(signalstats) → 순수 autoEnhanceParams로 eq 계산 →
    // applyAutoEnhance를 command bus로 적용(전 클립, 길이 불변) + 감사로그 + undo 스택.
    // 사람 GUI가 AI 에이전트와 똑같은 verb를 구동한다(에이전트도 같은 흐름으로 자동 보정 가능).
    const { mediaPath, timeline, transcript } = get();
    const dawn = window.dawn;
    if (!mediaPath || !timeline || !transcript || !dawn) return;
    set({ status: 'analyzing' });
    try {
      const stats = await dawn.analyzeVideo(mediaPath);
      const eq = autoEnhanceParams(stats);
      const cmd = { type: 'applyAutoEnhance', eq } as const;
      const { after, removedProgramUs } = applyCommand({ timeline, transcript }, cmd);
      set({
        timeline: after.timeline,
        autoEnhanceEq: eq,
        past: [...get().past, timeline],
        future: [],
        canUndo: true,
        canRedo: false,
        status: 'ready',
        auditLog: appendAudit(get().auditLog, cmd, removedProgramUs),
        ...derive(after.timeline),
      });
    } catch {
      set({ status: 'ready' }); // 분석 실패 → 조용히 원복(미디어 손상/ffmpeg 부재)
    }
  },

  correctWord: (wordId, text) => {
    // STT 오인식 어절을 사람이 교정 — command bus 경유(applyGlossaryNow와 동형). 타임스탬프/id
    // 보존이라 sync 불변, 교정 텍스트는 cue/SRT/번인에 자동 반영. 감사로그에 남는다(타임라인 불변).
    const { transcript, timeline } = get();
    const t = text.trim();
    if (!transcript || !timeline || !t) return;
    const w = transcript.words[wordId];
    if (!w || w.text === t) return;
    const cmd = { type: 'correctWord', wordId, text: t } as const;
    const { after } = applyCommand({ timeline, transcript }, cmd);
    set({ transcript: after.transcript, auditLog: appendAudit(get().auditLog, cmd, 0) });
  },

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
      auditLog: [],
      autoEnhanceEq: null,
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
    const cmd = { type: 'deleteWordRange', fromWordId: fromId, toWordId: toId } as const;
    const { after, removedProgramUs } = applyCommand({ timeline, transcript }, cmd);
    set({
      timeline: after.timeline,
      selected: [],
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      auditLog: appendAudit(get().auditLog, cmd, removedProgramUs),
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
    const cmd = { type: 'removeSilences', silences, padUs: 0 } as const;
    const { after, removedProgramUs } = applyCommand({ timeline, transcript }, cmd);
    set({
      timeline: after.timeline,
      status: 'ready',
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      auditLog: appendAudit(get().auditLog, cmd, removedProgramUs),
      ...derive(after.timeline),
    });
  },

  undo: () => {
    const { past, future, timeline, auditLog } = get();
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
      // 감사로그를 '모든 상태변경 액션'의 완전한 기록으로 — undo도 meta 항목으로 남겨
      // 로그가 현재 타임라인에 이르는 실제 시퀀스를 충실히 반영(R1 정합성).
      auditLog: appendAudit(
        auditLog,
        { type: 'history', op: 'undo' },
        timeline.durationProgram - prev.durationProgram,
      ),
      ...derive(prev),
    });
  },

  redo: () => {
    const { past, future, timeline, auditLog } = get();
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
      auditLog: appendAudit(
        auditLog,
        { type: 'history', op: 'redo' },
        timeline.durationProgram - next.durationProgram,
      ),
      ...derive(next),
    });
  },

  exportTo: async (path) => {
    const { timeline, mediaPath, overlays, frameW, frameH, ttsClips, transcript, reframe } = get();
    const dawn = window.dawn;
    if (!timeline || !mediaPath || !dawn) return;
    set({ status: 'exporting' });
    // 색보정 프리셋(전역 룩)을 익스포트 시 전 클립에 적용(command bus 경유, 길이 불변).
    const edl = timelineToEdl(gradeTimeline(timeline, transcript, get().colorPreset), mediaPath);
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
      ...(reframe !== 'source' ? { reframe } : {}),
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
    const { timeline, mediaPath, overlays, frameW, frameH, ttsClips, transcript, reframe } = get();
    const dawn = window.dawn;
    if (!timeline || !mediaPath || !dawn) return;
    set({ status: format === 'gif' ? 'exporting gif' : 'exporting' });
    const edl = timelineToEdl(gradeTimeline(timeline, transcript, get().colorPreset), mediaPath);
    const res = await dawn.render(edl, path, {
      format,
      overlays: toClips(overlays, timeline.durationProgram),
      frameW,
      frameH,
      voicePath: format === 'gif' ? undefined : ttsClips.find((c) => c.wavPath)?.wavPath,
      ...(reframe !== 'source' ? { reframe } : {}),
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
      auditLog: [],
      autoEnhanceEq: null,
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
    const cmd = { type: 'applyGlossary', pairs: glossary } as const;
    const { after } = applyCommand({ timeline, transcript }, cmd);
    set({ transcript: after.transcript, auditLog: appendAudit(get().auditLog, cmd, 0) });
  },
  removeFillers: () => {
    // 사람 GUI도 AI 에이전트와 동일한 command bus(applyCommand)를 구동한다 — P1 키스톤.
    const { transcript, timeline } = get();
    if (!transcript || !timeline) return;
    const cmd = { type: 'removeFillers' } as const;
    const { after, removedProgramUs } = applyCommand({ timeline, transcript }, cmd);
    if (removedProgramUs === 0) return; // 살아있는 말버릇 없음 → 변화 없음
    set({
      timeline: after.timeline,
      selected: [],
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      status: 'ready',
      auditLog: appendAudit(get().auditLog, cmd, removedProgramUs),
      ...derive(after.timeline),
    });
  },

  detectLlm: async () => {
    // 마운트 시 1회: 로컬 LLM 가용성 조회. 실패해도 조용히 룰 플래너로 동작.
    try {
      const status = await window.dawn?.llmAvailable();
      const ready = status?.available ?? false;
      set({ llmReady: ready, llmReason: status?.reason ?? null });
      // 가용하면 상주 서버를 백그라운드로 미리 데운다(첫 요청 콜드 ~9s → 웜 ~0.1–0.5s).
      if (ready) void window.dawn?.llmWarmup?.();
    } catch {
      set({ llmReady: false, llmReason: null });
    }
  },

  planAndPreview: async (input) => {
    // 자연어 → plan → dryRun 미리보기. 상태는 절대 변경하지 않는다(승인 전).
    // 경로: LLM 사용 가능하면 로컬 LLM(자유형 NL·복합 편집)을 먼저 시도하고,
    // 부재/오류/빈 plan이면 결정적 룰 플래너로 graceful fallback. 둘 다 같은 command bus로 흐른다.
    const { timeline, transcript, subtitleStyle, llmReady } = get();
    if (!timeline || !transcript) return;
    set({ nlBusy: true, nlError: null, pendingPlan: null, planReport: null });
    const state = { timeline, transcript, subtitleStyle };
    try {
      let commands: EditCommand[] = [];
      let engine: 'llm' | 'rule' = 'rule';

      if (llmReady && window.dawn?.llmPlan) {
        try {
          // 프롬프트/매니페스트는 plannerGrammar()와 같은 안전 부분집합으로 구성(금지 verb·clipId 차단).
          const prompt = buildPlanPrompt(input, summarizeState(state), plannerManifest());
          const { text } = await window.dawn.llmPlan(prompt);
          const { plan } = parsePlan(text); // 코드펜스/잡설 섞여도 JSON 배열만 추출 + Zod 검증.
          if (plan.length > 0) {
            commands = plan;
            engine = 'llm';
          }
        } catch {
          // LLM 실패(타임아웃/크래시 등) → 아래 룰 폴백.
        }
      }

      if (commands.length === 0) {
        commands = ruleBasedPlan(input, state);
        engine = 'rule';
      }

      const { report } = dryRunCommands(state, commands);
      set({
        nlBusy: false,
        pendingPlan: { input, commands, engine },
        planReport: report,
        nlError:
          commands.length === 0
            ? '이해하지 못한 명령입니다. (예: "말버릇 빼줘", "시네마틱하게")'
            : null,
      });
    } catch (e) {
      set({ nlBusy: false, nlError: e instanceof Error ? e.message : String(e) });
    }
  },
  approvePlan: () => {
    // 승인 = 유일한 상태변경 지점. 각 명령을 command bus로 적용 + 감사 로그 기록.
    const { pendingPlan, planReport, timeline, transcript, subtitleStyle } = get();
    if (!pendingPlan || !planReport?.ok || pendingPlan.commands.length === 0) return;
    if (!timeline || !transcript) return;
    let st: { timeline: TimelineModel; transcript: TranscriptModel; subtitleStyle: SubtitleStyle } =
      {
        timeline,
        transcript,
        subtitleStyle,
      };
    let audit = get().auditLog;
    for (const cmd of pendingPlan.commands) {
      const { after, removedProgramUs } = applyCommand(st, cmd);
      st = {
        timeline: after.timeline,
        transcript: after.transcript,
        subtitleStyle: after.subtitleStyle ?? {},
      };
      audit = appendAudit(audit, cmd, removedProgramUs);
    }
    set({
      timeline: st.timeline,
      transcript: st.transcript,
      subtitleStyle: st.subtitleStyle,
      auditLog: audit,
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      selected: [],
      pendingPlan: null,
      planReport: null,
      nlError: null,
      status: 'ready',
      ...derive(st.timeline),
    });
  },
  rejectPlan: () => set({ pendingPlan: null, planReport: null, nlError: null }),

  applyStylePack: (id) => {
    // 1클릭 스타일 팩 = plan(EditCommand[] 묶음)을 approvePlan과 동일한 command bus 경로로 적용.
    // 색보정·자막스타일(+애니)·말버릇 컷이 한 번에 들어가고 감사로그에 남는다. 자막 번인은 별도(doBurn).
    const pack = stylePackById(id);
    const { timeline, transcript, subtitleStyle } = get();
    if (!pack || !timeline || !transcript) return;
    let st: { timeline: TimelineModel; transcript: TranscriptModel; subtitleStyle: SubtitleStyle } =
      {
        timeline,
        transcript,
        subtitleStyle,
      };
    let audit = get().auditLog;
    for (const cmd of pack.commands) {
      const { after, removedProgramUs } = applyCommand(st, cmd);
      st = {
        timeline: after.timeline,
        transcript: after.transcript,
        subtitleStyle: after.subtitleStyle ?? {},
      };
      audit = appendAudit(audit, cmd, removedProgramUs);
    }
    set({
      timeline: st.timeline,
      transcript: st.transcript,
      subtitleStyle: st.subtitleStyle,
      auditLog: audit,
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      selected: [],
      status: 'ready',
      ...derive(st.timeline),
    });
  },
}));

export { deadSet };
