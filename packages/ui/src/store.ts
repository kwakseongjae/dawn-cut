import {
  buildTranscriptModel,
  createInitialTimeline,
  deleteWordRange,
  deserializeProject,
  formatSrt,
  makeProject,
  removeSilences,
  serializeProject,
  timelineToEdl,
  transcriptToCues,
  videoClips,
} from '@dawn-cut/core';
import type { OverlayClip, TimelineModel, TranscriptModel } from '@dawn-cut/core';
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
}

export type PanelId = 'media' | 'text' | 'sticker' | 'effect';
export interface Overlay {
  id: string;
  kind: 'image' | 'sticker' | 'gif' | 'subtitle' | 'video';
  name: string;
  src?: string; // file path for image/gif; undefined for emoji sticker (preview until rasterized)
  // placement (normalized) — mirrors core OverlayClip
  x: number;
  y: number;
  scale: number;
  opacity: number;
  startUs: number;
  endUs: number;
  z: number;
  // animation (linear interp base→to over [startUs,endUs]) + constant rotation (deg)
  to?: { x?: number; y?: number; scale?: number };
  rotation?: number;
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
        ...(o.rotation ? { rotation: o.rotation } : {}),
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
    const transcript = buildTranscriptModel(tr.words, MEDIA_ID, tr.language);
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
    const { after } = deleteWordRange(timeline, transcript, fromId, toId);
    set({
      timeline: after,
      selected: [],
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      ...derive(after),
    });
  },

  removeSilencesAction: async () => {
    const { timeline, mediaPath } = get();
    const dawn = window.dawn;
    if (!timeline || !mediaPath || !dawn) return;
    set({ status: 'detecting silence' });
    const silences = await dawn.detectSilences(mediaPath);
    const { after } = removeSilences(timeline, MEDIA_ID, silences, 0);
    set({
      timeline: after,
      status: 'ready',
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      ...derive(after),
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
    const { timeline, mediaPath, overlays, frameW, frameH, ttsClips } = get();
    const dawn = window.dawn;
    if (!timeline || !mediaPath || !dawn) return;
    set({ status: 'exporting' });
    const edl = timelineToEdl(timeline, mediaPath);
    await dawn.render(edl, path, {
      overlays: toClips(overlays, timeline.durationProgram),
      frameW,
      frameH,
      voicePath: ttsClips.find((c) => c.wavPath)?.wavPath,
    });
    set({ status: 'exported' });
  },

  exportVideo: async (path, format) => {
    const { timeline, mediaPath, overlays, frameW, frameH, ttsClips } = get();
    const dawn = window.dawn;
    if (!timeline || !mediaPath || !dawn) return;
    set({ status: format === 'gif' ? 'exporting gif' : 'exporting' });
    const edl = timelineToEdl(timeline, mediaPath);
    await dawn.render(edl, path, {
      format,
      overlays: toClips(overlays, timeline.durationProgram),
      frameW,
      frameH,
      voicePath: format === 'gif' ? undefined : ttsClips.find((c) => c.wavPath)?.wavPath,
    });
    set({ status: format === 'gif' ? 'gif exported' : 'exported' });
  },

  exportSrt: async (path) => {
    const { timeline, transcript } = get();
    const dawn = window.dawn;
    if (!timeline || !transcript || !dawn) return;
    set({ status: 'exporting srt' });
    const cues = transcriptToCues(transcript, timeline);
    await dawn.writeSrt(path, formatSrt(cues));
    set({ status: 'srt exported' });
  },

  saveProject: async (path) => {
    const { timeline, transcript, mediaPath } = get();
    const dawn = window.dawn;
    if (!timeline || !transcript || !mediaPath || !dawn) return;
    await dawn.saveProject(path, serializeProject(makeProject(mediaPath, transcript, timeline)));
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
    });
  },
}));

export { deadSet };
