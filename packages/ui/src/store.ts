import {
  appendAudit,
  applyCommand,
  applyGlossary,
  assessSpeech,
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
  mediaPath: string | null; // 원본(편집·내보내기·전사의 단일 진실원천)
  // 미리보기 <video>가 재생할 경로. 보통 = mediaPath. 단, 고레벨/초고해상도/비-web 코덱이라
  // Electron이 못 그리는 영상은 백그라운드로 만든 H.264 프록시 경로(편집/내보내기는 원본 그대로).
  previewPath: string | null;
  proxyBusy: boolean; // 미리보기 프록시 변환 중
  hasAudio: boolean; // 가져온 미디어에 오디오 트랙이 있는가(자막 생성 가능 여부)
  transcribeError: string | null; // 자막 생성 실패/불가 사유(사람이 읽을 메시지)
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
  manualCues: ManualCue[]; // 직접 입력한 자막(STT 없이) — 무음 영상도 자막 가능
  frameW: number;
  frameH: number;
  selectedOverlayId: string | null;
  selectedVoiceId: string | null; // 선택된 보이스 클립(Delete·하이라이트용)
  subtitlePos: { x: number; y: number; scale: number };
  subtitleStyle: SubtitleStyle;
  advanced: boolean; // 고급(전체) UI 노출 — DAWN_ADVANCED=1(preload). false=쇼케이스 단순 UI.

  importPath: (path: string) => Promise<void>; // 프로브만(즉시) — 자막 자동 생성 안 함
  transcribeMedia: () => Promise<void>; // 명시적 자막 생성(받아쓰기)
  clearMedia: () => void; // 가져온 영상·자막·편집 비우기(빈 상태로)
  seekTo: (programUs: number) => void; // 플레이헤드 이동 + 일시정지(스크럽/타임라인 클릭)
  toggleWord: (id: string) => void;
  deleteSelection: () => void;
  removeSilencesAction: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  exportTo: (
    path: string,
    preset?: { outHeight?: number; quality?: 'high' | 'medium' | 'small'; outFps?: number },
  ) => Promise<void>;
  exportVideo: (path: string, format: 'mp4' | 'gif') => Promise<void>;
  exportAudio: (path: string, format: 'mp3' | 'wav') => Promise<void>; // 오디오만(팟캐스트/녹취)
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
  generateVoiceover: (voice: string, text: string, opts?: TtsVoiceOpts) => Promise<void>;
  updateTts: (id: string, patch: Partial<TtsClip>) => void;
  removeTts: (id: string) => void;
  selectVoice: (id: string | null) => void;
  // 수기 자막: 현재 재생 위치에 새 cue 추가 / 텍스트·타이밍 수정 / 삭제.
  addManualCue: (text?: string) => void;
  updateManualCue: (id: string, patch: Partial<ManualCue>) => void;
  removeManualCue: (id: string) => void;
  removeOverlay: (id: string) => void;
  setSubtitlePos: (patch: Partial<{ x: number; y: number; scale: number }>) => void;
  setSubtitleStyle: (patch: SubtitleStyle) => void;
  replaceSubtitleStyle: (style: SubtitleStyle) => void;
  colorPreset: ColorPreset; // 전역 색보정 프리셋(익스포트 시 전 클립에 적용)
  setColorPreset: (p: ColorPreset) => void;
  // 적응형 자동 보정(1탭): 영상 분석 → autoEnhanceParams → applyAutoEnhance(command bus+감사+undo).
  autoEnhanceEq: ColorEq | null; // 마지막 적용 eq(프리뷰 CSS 근사용; 실제 렌더는 timeline 이펙트)
  autoEnhance: () => Promise<void>;
  correctWord: (wordId: string, text: string) => void; // STT 오인식 어절 교정(검수)
  // CapCut 표준 키맵(issue #6) — 플레이헤드 기준 편집. 전부 command bus(undo·감사) 경유.
  splitAtPlayhead: () => void; // Cmd+B — 클립 분할(길이 불변)
  rippleDeleteAtPlayhead: (side: 'left' | 'right') => void; // Q/W — 클립 시작↔플레이헤드↔끝 삭제
  playbackRate: number; // JKL 셔틀 — 미리보기 재생 배속(1/1.5/2)
  setPlaybackRate: (r: number) => void;
  autoHighlight: (targetSeconds: number) => void; // 롱폼→쇼츠: 핵심만 남겨 ~targetSeconds로 컷
  // 자동 하이라이트 결과 알림(컷됨/이미 짧음). 사용자가 닫을 때까지 유지.
  highlightNotice: {
    cut: number;
    originalUs: number;
    finalUs: number;
    targetSeconds: number;
  } | null;
  dismissHighlightNotice: () => void;
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
  planReport: DryRunReport | null; // pendingPlan의 dryRun diff (부분 적용 시 선택분만 재평가)
  planExcluded: number[]; // 부분 적용 — 사용자가 체크 해제한 명령 인덱스(#14)
  togglePlanCommand: (index: number) => void; // 체크 토글 → 선택분만 dry-run 재평가
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
  // ── 작업 현황 저장(issue #17) — 자동저장·복구 ──
  autosavedAt: number | null; // 마지막 자동저장 시각(ms) — 상태바 표시용
  recovery: { savedAtMs: number } | null; // 시작 시 발견된 자동저장(복구 제안 배너)
  checkRecovery: () => Promise<void>; // 앱 시작 시 1회 — autosave 존재하면 recovery 세팅
  recoverAutosave: () => Promise<void>; // 배너 [복구] — autosave를 프로젝트로 복원
  dismissRecovery: () => void; // 배너 [무시] — autosave 삭제
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
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back';
  };
  keyframes?: Array<{
    u: number;
    x?: number;
    y?: number;
    scale?: number;
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back';
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
// 새 오버레이는 '현재 위치에서 3초간'을 기본으로 둔다(영상 전체로 깔리지 않게 — 직관적이고
// 타임라인에서 드래그로 늘릴 수 있다). 시작은 플레이헤드, 길이 3초(영상 끝을 넘지 않게 클램프).
const DEFAULT_OVERLAY_LEN_US = 3_000_000;
function placement(
  index: number,
  durationUs: number,
  startUs = 0,
): Omit<Overlay, 'id' | 'kind' | 'name' | 'src'> {
  const c = CORNERS[index % CORNERS.length]!;
  const dur = durationUs || 1_000_000;
  const s = Math.max(0, Math.min(Math.round(startUs), Math.max(0, dur - 500_000)));
  return {
    x: c.x,
    y: c.y,
    scale: 0.3,
    opacity: 1,
    startUs: s,
    endUs: Math.min(s + DEFAULT_OVERLAY_LEN_US, dur),
    z: index,
  };
}
export interface TtsVoiceOpts {
  rate?: number; // 속도(wpm)
  pitch?: number; // 톤(pbas 0~100)
  volume?: number; // 음량(volm)
  style?: string; // 적용된 스타일 프리셋 id(차분/보통/활기찬 등) — UI 표시·재합성용
}
export interface TtsClip {
  id: string;
  voice: string;
  text: string;
  wavPath?: string;
  startUs: number; // 타임라인 시작(µs) — 오버레이처럼 드래그로 이동
  endUs: number; // 타임라인 끝(µs) — 음성 길이. 드래그 양끝으로 조절
  opts?: TtsVoiceOpts; // 합성에 쓴 속도/톤/스타일(프로젝트 저장·재합성 대비)
}
const DEFAULT_TTS_LEN_US = 2_000_000; // 길이 모를 때(probe 실패) 기본 2초

// 수기(직접 입력) 자막 cue — 받아쓰기(STT) 없이 사용자가 타이핑한 캡션. 프로그램 시간(µs).
// 무음 영상(화면녹화 등)도 이걸로 자막을 넣을 수 있다. 번인/SRT/스타일은 STT 자막과 동일 엔진 사용.
export interface ManualCue {
  id: string;
  text: string;
  startUs: number;
  endUs: number;
  // 스티커처럼 cue마다 독립 위치(정규화 x/y + scale). 없으면 전역 subtitlePos를 따른다.
  // 여러 수기 자막을 영상 위 서로 다른 자리에 동시에 둘 수 있게 한다.
  pos?: { x: number; y: number; scale: number };
}
const DEFAULT_CUE_LEN_US = 2_500_000; // 새 수기 자막 기본 길이 2.5초
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

// Electron <video>가 신뢰성 있게 그리는 비디오 코덱(소문자). 이 외(hevc/prores/mpeg4 등)는 프록시 필요.
const WEB_VCODECS = new Set(['h264', 'avc1', 'vp8', 'vp9', 'vp09', 'av1', 'av01', 'theora']);
/**
 * 미리보기 프록시가 필요한가. 비-web 코덱이거나, 고레벨 H.264(level>4.1 = 5.x; 실측상 검은 화면),
 * 또는 초고해상도(긴 변>1920)면 true. true면 작은 표준 H.264로 재인코딩해 미리보기에만 쓴다.
 */
function needsPreviewProxy(p: {
  vcodec: string;
  level: number;
  width: number;
  height: number;
}): boolean {
  if (!WEB_VCODECS.has((p.vcodec || '').toLowerCase())) return true;
  if (p.level > 41) return true; // H.264 level 5.x → Electron 미리보기 검정 위험(실측: 당근.mp4 L5.2)
  if (Math.max(p.width, p.height) > 1920) return true;
  return false;
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

// ── 작업 현황 저장 헬퍼(issue #17) — 풀 상태 ↔ Project v3 ──────────────

/** 디스크 파일을 참조하는 에셋 경로 전부(오버레이 PNG/GIF + TTS wav). 저장 시 .assets/로 복사 대상. */
function collectAssetPaths(s: EditorState): string[] {
  const files = new Set<string>();
  for (const o of s.overlays) if (o.src) files.add(o.src);
  for (const t of s.ttsClips) if (t.wavPath) files.add(t.wavPath);
  return [...files];
}

/** 현재 편집 상태 전체를 Project v3 JSON으로 직렬화. mapping으로 에셋 경로 바꿔치기(자동저장은 {}). */
function serializeFullProject(s: EditorState, mapping: Record<string, string>): string {
  const remap = (p?: string) => (p && mapping[p] ? mapping[p] : p);
  const tx = s.transcript ?? buildTranscriptModel([], MEDIA_ID, 'und');
  return serializeProject(
    makeProject(s.mediaPath!, tx, s.timeline!, {
      subtitlePos: s.subtitlePos,
      subtitleStyle: s.subtitleStyle,
      overlays: s.overlays.map((o) => ({ ...o, src: remap(o.src) ?? '' })),
      manualCues: s.manualCues,
      ttsClips: s.ttsClips.map((t) => ({ ...t, wavPath: remap(t.wavPath) })),
      reframe: s.reframe,
      colorPreset: s.colorPreset,
      autoEnhanceEq: s.autoEnhanceEq,
      glossary: s.glossary,
    }),
  );
}

/** 저장 직후 라이브 상태의 에셋 경로를 .assets/ 사본으로 교체(tmp 소멸 대비). */
function remapAssetPaths(
  set: (p: Partial<EditorState>) => void,
  get: () => EditorState,
  mapping: Record<string, string>,
) {
  set({
    overlays: get().overlays.map((o) =>
      o.src && mapping[o.src] ? { ...o, src: mapping[o.src] } : o,
    ),
    ttsClips: get().ttsClips.map((t) =>
      t.wavPath && mapping[t.wavPath] ? { ...t, wavPath: mapping[t.wavPath] } : t,
    ),
  });
}

/** Project(v1/v2/v3) → 스토어 상태 패치. openProject와 자동저장 복구가 공유한다. */
function restoreFromProject(project: ReturnType<typeof deserializeProject>) {
  return {
    mediaPath: project.mediaPath,
    previewPath: project.mediaPath, // 열기는 원본 미리보기(검으면 다시 가져오기로 프록시 생성)
    proxyBusy: false,
    hasAudio: true, // 저장된 프로젝트는 이미 전사를 거쳤다고 가정
    transcribeError: null,
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
    // ── v3 작업 현황 복원(구버전 파일은 빈 값) ──
    overlays: (project.overlays ?? []).map((o) => ({ name: '', ...o })) as Overlay[],
    manualCues: (project.manualCues ?? []) as ManualCue[],
    ttsClips: (project.ttsClips ?? []) as TtsClip[],
    reframe: (project.reframe ?? 'source') as Reframe,
    colorPreset: (project.colorPreset ?? 'none') as ColorPreset,
    autoEnhanceEq: project.autoEnhanceEq ?? null,
    selectedOverlayId: null,
    selectedVoiceId: null,
    ...(project.glossary?.length ? { glossary: project.glossary } : {}),
  } satisfies Partial<EditorState>;
}

export const useEditor = create<EditorState>((set, get) => ({
  mediaPath: null,
  previewPath: null,
  proxyBusy: false,
  hasAudio: false,
  transcribeError: null,
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
  manualCues: [],
  frameW: 0,
  frameH: 0,
  selectedOverlayId: null,
  selectedVoiceId: null,
  subtitlePos: { x: 0.1, y: 0.8, scale: 0.8 },
  subtitleStyle: {},
  // preload가 노출한 DAWN_ADVANCED 플래그(모듈 로드 시 1회 평가; 비-electron/테스트=false).
  advanced: typeof window !== 'undefined' ? (window.dawn?.advanced ?? false) : false,
  colorPreset: 'none',
  autoEnhanceEq: null,
  highlightNotice: null,
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
  setColorPreset: (p) => set({ colorPreset: p }),
  setReframe: (r) => set({ reframe: r }),

  autoEnhance: async () => {
    // 1탭 적응형 보정: 영상을 분석(signalstats) → 순수 autoEnhanceParams로 eq 계산 →
    // applyAutoEnhance를 command bus로 적용(전 클립, 길이 불변) + 감사로그 + undo 스택.
    // 사람 GUI가 AI 에이전트와 똑같은 verb를 구동한다(에이전트도 같은 흐름으로 자동 보정 가능).
    const { mediaPath, timeline, transcript } = get();
    const dawn = window.dawn;
    // 색/노출 보정은 자막과 무관 — transcript 없이도(무음·미전사 영상) 동작해야 한다.
    // applyCommand 컨텍스트 타입만 채우면 되므로 없으면 빈 TranscriptModel을 합성한다.
    if (!mediaPath || !timeline || !dawn) return;
    set({ status: 'analyzing' });
    try {
      const stats = await dawn.analyzeVideo(mediaPath);
      const eq = autoEnhanceParams(stats);
      const cmd = { type: 'applyAutoEnhance', eq } as const;
      const tx = transcript ?? buildTranscriptModel([], MEDIA_ID, 'und');
      const { after, removedProgramUs } = applyCommand({ timeline, transcript: tx }, cmd);
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

  autoHighlight: (targetSeconds) => {
    // 롱폼→쇼츠 헤드라인: 핵심만 남기는 결정적 컷 플랜을 command bus로 적용(undo·감사). 사람 GUI가
    // AI 에이전트와 동일한 verb를 구동한다(NL "60초 하이라이트로"도 같은 verb로 흐른다).
    const { transcript, timeline } = get();
    if (!transcript || !timeline) return;
    const originalUs = timeline.durationProgram;
    const cmd = { type: 'autoHighlight', targetSeconds } as const;
    const { after, removedProgramUs } = applyCommand({ timeline, transcript }, cmd);
    if (removedProgramUs <= 0) {
      // 컷할 게 없음(원본이 이미 목표보다 짧음) — 침묵하지 않고 그 사실을 알린다.
      set({
        highlightNotice: { cut: 0, originalUs, finalUs: originalUs, targetSeconds },
        status: 'ready',
      });
      return;
    }
    set({
      timeline: after.timeline,
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      selected: [],
      status: 'ready',
      highlightNotice: {
        cut: removedProgramUs,
        originalUs,
        finalUs: after.timeline.durationProgram,
        targetSeconds,
      },
      auditLog: appendAudit(get().auditLog, cmd, removedProgramUs),
      ...derive(after.timeline),
    });
  },
  // ── CapCut 표준 키맵(issue #6) ──
  splitAtPlayhead: () => {
    const { timeline, playheadUs } = get();
    if (!timeline) return;
    // 자막 생성 전에도 동작해야 한다(분할은 transcript 무관) — 빈 transcript 합성(저장과 동일 패턴).
    const transcript = get().transcript ?? buildTranscriptModel([], MEDIA_ID, 'und');
    const cmd = { type: 'splitAt', programUs: Math.round(playheadUs) } as const;
    const { after } = applyCommand({ timeline, transcript }, cmd);
    if (videoClips(after.timeline).length === videoClips(timeline).length) return; // 경계 no-op
    set({
      timeline: after.timeline,
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      auditLog: appendAudit(get().auditLog, cmd, 0),
      ...derive(after.timeline),
    });
  },
  rippleDeleteAtPlayhead: (side) => {
    // Q(left)=클립 시작→플레이헤드 삭제 · W(right)=플레이헤드→클립 끝 삭제 (CapCut 문법).
    const { timeline, playheadUs } = get();
    if (!timeline) return;
    const transcript = get().transcript ?? buildTranscriptModel([], MEDIA_ID, 'und');
    const clip = videoClips(timeline).find(
      (c) =>
        playheadUs >= c.timelineStart &&
        playheadUs < c.timelineStart + (c.sourceEnd - c.sourceStart),
    );
    if (!clip) return;
    const srcAt = clip.sourceStart + (playheadUs - clip.timelineStart);
    const [a, b] = side === 'left' ? [clip.sourceStart, srcAt] : [srcAt, clip.sourceEnd];
    if (b - a < 33_334) return; // 1프레임 미만 — 의미 없는 컷 방지
    const cmd = {
      type: 'cutSourceRange',
      mediaId: clip.mediaId,
      sourceStart: Math.round(a),
      sourceEnd: Math.round(b),
    } as const;
    const { after, removedProgramUs } = applyCommand({ timeline, transcript }, cmd);
    set({
      timeline: after.timeline,
      past: [...get().past, timeline],
      future: [],
      canUndo: true,
      canRedo: false,
      selected: [],
      playheadUs:
        side === 'left' ? clip.timelineStart : Math.min(playheadUs, after.timeline.durationProgram),
      auditLog: appendAudit(get().auditLog, cmd, removedProgramUs),
      ...derive(after.timeline),
    });
  },
  playbackRate: 1,
  setPlaybackRate: (r) => set({ playbackRate: r }),

  dismissHighlightNotice: () => set({ highlightNotice: null }),

  // 오버레이/보이스 선택은 상호 배타 — Delete 키가 어느 쪽을 지울지 모호하지 않게.
  selectOverlay: (id) => set({ selectedOverlayId: id, selectedVoiceId: null }),
  selectVoice: (id) => set({ selectedVoiceId: id, selectedOverlayId: null }),
  updateOverlay: (id, patch) =>
    set({ overlays: get().overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) }),
  updateTts: (id, patch) =>
    set({ ttsClips: get().ttsClips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
  removeTts: (id) =>
    set({
      ttsClips: get().ttsClips.filter((c) => c.id !== id),
      selectedVoiceId: get().selectedVoiceId === id ? null : get().selectedVoiceId,
    }),

  addManualCue: (text = '') => {
    const { playheadUs, durationProgramUs, manualCues } = get();
    const dur = durationProgramUs || DEFAULT_CUE_LEN_US;
    const startUs = Math.max(0, Math.min(playheadUs, Math.max(0, dur - DEFAULT_CUE_LEN_US)));
    const endUs = Math.min(startUs + DEFAULT_CUE_LEN_US, dur || startUs + DEFAULT_CUE_LEN_US);
    set({ manualCues: [...manualCues, { id: uid(), text, startUs, endUs }] });
  },
  updateManualCue: (id, patch) =>
    set({ manualCues: get().manualCues.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
  removeManualCue: (id) => set({ manualCues: get().manualCues.filter((c) => c.id !== id) }),

  setPlayhead: (us) => set({ playheadUs: us }),
  setPlaying: (p) => set({ playing: p }),
  setPanel: (p) => set({ panel: p }),
  // 오버레이를 추가하면 곧바로 '선택' 상태로 둔다 → 속성 패널(위치/크기/타이밍)이 즉시 보인다
  // (발견성 개선: 예전엔 추가해도 클릭 전엔 컨트롤이 안 떠서 "기능이 없다"고 느꼈음).
  addImageOverlay: (path) => {
    const { overlays, durationProgramUs, playheadUs } = get();
    const id = uid();
    set({
      overlays: [
        ...overlays,
        {
          id,
          kind: 'image',
          name: baseName(path),
          src: path,
          ...placement(overlays.length, durationProgramUs, playheadUs),
        },
      ],
      selectedOverlayId: id,
    });
  },
  addOverlaySrc: (kind, name, src) => {
    const { overlays, durationProgramUs, playheadUs } = get();
    const id = uid();
    set({
      overlays: [
        ...overlays,
        { id, kind, name, src, ...placement(overlays.length, durationProgramUs, playheadUs) },
      ],
      selectedOverlayId: id,
    });
  },
  addOverlayWith: (o) => set({ overlays: [...get().overlays, { id: uid(), ...o }] }),
  clearOverlaysByKind: (kind) =>
    set({
      overlays: get().overlays.filter((o) => o.kind !== kind),
      selectedOverlayId: null,
    }),
  addAssetStub: (kind, name) => {
    const { overlays, durationProgramUs, playheadUs } = get();
    const id = uid();
    set({
      overlays: [
        ...overlays,
        { id, kind, name, ...placement(overlays.length, durationProgramUs, playheadUs) },
      ],
      selectedOverlayId: id,
    });
  },
  generateVoiceover: async (voice, text, opts) => {
    const dawn = window.dawn;
    if (!dawn) return;
    set({ status: 'synthesizing voice' });
    let res: Awaited<ReturnType<typeof dawn.synthesizeTts>>;
    try {
      res = await dawn.synthesizeTts(text, voice, opts);
    } catch (e) {
      // 클라우드 전용 — 키 부재/네트워크 실패는 명시적 에러(조용한 로컬 폴백 금지, 2026-06-11).
      set({ status: 'voice failed' });
      throw e;
    }
    // 플레이헤드에서 시작, 길이는 실제 음성 길이(probe). 프로그램 끝을 넘지 않게 클램프.
    const { playheadUs, durationProgramUs } = get();
    const len = res.durationUs > 0 ? res.durationUs : DEFAULT_TTS_LEN_US;
    const startUs = durationProgramUs
      ? Math.min(playheadUs, Math.max(0, durationProgramUs - len))
      : playheadUs;
    const id = uid();
    set({
      ttsClips: [
        ...get().ttsClips,
        {
          id,
          voice: res.voice || voice,
          text,
          wavPath: res.wavPath,
          startUs,
          endUs: startUs + len,
          ...(opts ? { opts } : {}),
        },
      ],
      selectedVoiceId: id,
      selectedOverlayId: null,
      status: 'voice ready',
    });
  },
  removeOverlay: (id) =>
    set({
      overlays: get().overlays.filter((o) => o.id !== id),
      selectedOverlayId: get().selectedOverlayId === id ? null : get().selectedOverlayId,
    }),

  importPath: async (path) => {
    // 가져오기 = 프로브만(즉시). 오디오 추출·자막 생성은 자동으로 하지 않는다 —
    // 무거운(수십 초) 받아쓰기를 사용자가 원할 때 명시적으로(transcribeMedia) 실행한다.
    const dawn = window.dawn;
    if (!dawn) throw new Error('bridge unavailable');
    set({ status: 'probing' });
    const probe = await dawn.probe(path);
    const timeline = createInitialTimeline(MEDIA_ID, probe.durationUs, probe.fps || 30);
    // 미리보기: 보통은 원본을 그대로 재생. 단 Electron이 못 그리는 영상(고레벨/초고해상도/비-web
    // 코덱)은 백그라운드로 작은 H.264 프록시를 만들어 그걸로 미리본다(편집·내보내기는 원본).
    const proxyNeeded = needsPreviewProxy(probe);
    set({
      mediaPath: path,
      previewPath: proxyNeeded ? null : path,
      proxyBusy: proxyNeeded,
      hasAudio: probe.hasAudio,
      transcribeError: null,
      transcript: null, // 자막은 'transcribeMedia'를 눌러야 생성된다.
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
      ttsClips: [],
      manualCues: [],
      selectedOverlayId: null,
      selectedVoiceId: null,
      frameW: probe.width,
      frameH: probe.height,
      sourceDurationUs: probe.durationUs,
      lastExport: null,
      silencePreview: null,
      auditLog: [],
      autoEnhanceEq: null,
      ...derive(timeline),
    });
    if (proxyNeeded) {
      // 가져오기를 막지 않고 백그라운드 변환. 완료 시 미리보기를 프록시로 교체(같은 미디어일 때만).
      void dawn
        .makePreviewProxy(path)
        .then(({ path: proxy }) => {
          if (get().mediaPath === path) set({ previewPath: proxy, proxyBusy: false });
        })
        .catch(() => {
          // 변환 실패 → 원본으로 폴백(그래도 검으면 <video> onError가 안내).
          if (get().mediaPath === path) set({ previewPath: path, proxyBusy: false });
        });
    }
  },

  transcribeMedia: async () => {
    // 명시적 자막 생성(받아쓰기) — 가져온 미디어의 오디오를 추출해 whisper로 전사한다.
    // 사용자가 '자막 생성'을 눌렀을 때만 실행(가져오기 시 자동 실행 안 함).
    const { mediaPath, hasAudio } = get();
    const dawn = window.dawn;
    if (!mediaPath || !dawn) return;
    // 오디오 트랙이 없는 영상(화면녹화 등)은 추출이 실패한다 → 미리 막고 친절히 안내.
    if (!hasAudio) {
      set({ transcribeError: '이 영상에는 오디오(소리)가 없어 자막을 만들 수 없어요.' });
      return;
    }
    set({ status: 'extracting', transcribeError: null });
    try {
      const { wavPath } = await dawn.extractAudio(mediaPath);
      set({ status: 'transcribing' });
      let tr = await dawn.transcribe(wavPath, MEDIA_ID);
      let speech = assessSpeech(tr.words, get().sourceDurationUs || undefined);
      // 언어 오감지 복구 — whisper가 한국어 발화를 영어 등으로 오감지하면 환각 루프가 나온다
      // (실측 ko-review: auto=en 중앙신뢰 0.53 → ko 강제 시 1.00). 비한국어 감지 + 신뢰도가
      // 애매하면 한국어로 1회 재전사해 더 나은 쪽을 쓴다(한국어 우선 제품 가정).
      if (tr.language !== 'ko' && speech.medianConfidence < 0.7) {
        const koTr = await dawn.transcribe(wavPath, MEDIA_ID, 'ko');
        const koSpeech = assessSpeech(koTr.words, get().sourceDurationUs || undefined);
        if (koSpeech.medianConfidence > speech.medianConfidence) {
          tr = koTr;
          speech = koSpeech;
        }
      }
      // 잡음/무발화 가드 — whisper는 잡음에서도 그럴듯한 문장을 환각한다. 신뢰도 평가로
      // 거르고, 환각 의심이면 자막을 만들지 않고 사유를 안내한다(2026-06-11).
      if (!speech.speechLikely) {
        set({
          status: 'ready',
          transcribeError:
            speech.reason === 'no-words'
              ? '오디오에서 말소리를 찾지 못했어요. (배경음/무음일 수 있어요 — 직접 자막 입력은 가능합니다.)'
              : '말소리가 또렷하지 않아요(잡음·음악일 가능성). 자막 정확도를 보장할 수 없어 만들지 않았어요 — 직접 자막 입력을 써보세요.',
        });
        return;
      }
      // 전사 직후 '내 사전'을 적용해 자주 틀리는 고유명사를 교정한다.
      const subWords = applyGlossary(tr.words, get().glossary);
      const transcript = buildTranscriptModel(subWords, MEDIA_ID, tr.language);
      set({ transcript, status: 'ready' });
    } catch {
      // 추출/전사 실패(오디오 없음·형식 문제 등) → 크래시 대신 메시지.
      set({
        status: 'ready',
        transcribeError: '자막 생성에 실패했어요. 오디오 트랙이 없거나 형식 문제일 수 있어요.',
      });
    }
  },

  clearMedia: () =>
    set({
      mediaPath: null,
      previewPath: null,
      proxyBusy: false,
      hasAudio: false,
      transcribeError: null,
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
      overlays: [],
      selectedOverlayId: null,
      selectedVoiceId: null,
      ttsClips: [],
      manualCues: [],
      frameW: 0,
      frameH: 0,
      sourceDurationUs: 0,
      lastExport: null,
      silencePreview: null,
      auditLog: [],
      autoEnhanceEq: null,
      colorPreset: 'none',
      reframe: 'source',
      subtitleStyle: {},
    }),

  seekTo: (programUs) => {
    // 플레이헤드를 옮기고 일시정지 → Preview의 'paused 시 영상 시킹' 이펙트가 해당 시점으로 이동.
    const dur = get().durationProgramUs;
    const us = Math.max(0, Math.min(programUs, dur));
    set({ playheadUs: us, playing: false });
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

  exportTo: async (path, preset) => {
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
    const voiceClip = ttsClips.find((c) => c.wavPath);
    const res = await dawn.render(edl, path, {
      overlays: toClips(overlays, timeline.durationProgram),
      frameW,
      frameH,
      inputHasAudio: get().hasAudio,
      ...(voiceClip
        ? { voicePath: voiceClip.wavPath, voiceStartUs: Math.max(0, voiceClip.startUs) }
        : {}),
      ...(subtitlesPath ? { subtitlesPath } : {}),
      ...(reframe !== 'source' ? { reframe } : {}),
      ...(preset?.outHeight ? { outHeight: preset.outHeight } : {}),
      ...(preset?.quality ? { quality: preset.quality } : {}),
      ...(preset?.outFps ? { outFps: preset.outFps } : {}),
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

  exportAudio: async (path, format) => {
    // 오디오만 추출(issue #5) — 컷·무음 제거가 반영된 EDL 오디오를 mp3/wav로(색보정 무관).
    const { timeline, mediaPath } = get();
    const dawn = window.dawn;
    if (!timeline || !mediaPath || !dawn?.renderAudio) return;
    set({ status: 'exporting' });
    // 저장 다이얼로그 기본값이 .mp4라 확장자를 포맷에 맞게 교정한다.
    const out = new RegExp(`\\.${format}$`, 'i').test(path)
      ? path
      : `${path.replace(/\.[^/.]+$/, '')}.${format}`;
    const edl = timelineToEdl(timeline, mediaPath);
    await dawn.renderAudio(edl, out, format);
    set({
      status: 'exported',
      lastExport: {
        path: out,
        format,
        originalUs: get().sourceDurationUs,
        finalUs: timeline.durationProgram,
      },
    });
  },

  exportVideo: async (path, format) => {
    const { timeline, mediaPath, overlays, frameW, frameH, ttsClips, transcript, reframe } = get();
    const dawn = window.dawn;
    if (!timeline || !mediaPath || !dawn) return;
    set({ status: format === 'gif' ? 'exporting gif' : 'exporting' });
    const edl = timelineToEdl(gradeTimeline(timeline, transcript, get().colorPreset), mediaPath);
    const voiceClip = format === 'gif' ? undefined : ttsClips.find((c) => c.wavPath);
    const res = await dawn.render(edl, path, {
      format,
      overlays: toClips(overlays, timeline.durationProgram),
      frameW,
      frameH,
      inputHasAudio: get().hasAudio,
      ...(voiceClip
        ? { voicePath: voiceClip.wavPath, voiceStartUs: Math.max(0, voiceClip.startUs) }
        : {}),
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
    const { timeline, transcript, manualCues } = get();
    const dawn = window.dawn;
    if (!timeline || !dawn) return;
    // 자막 소스: 받아쓰기(transcript) 우선, 없으면 수기 자막(manualCues). 둘 다 없으면 중단.
    const cues = transcript
      ? transcriptToCues(transcript, timeline)
      : manualCues
          .filter((c) => c.text.trim())
          .slice()
          .sort((a, b) => a.startUs - b.startUs)
          .map((c, i) => ({
            index: i + 1,
            startUs: c.startUs,
            endUs: c.endUs,
            text: c.text.trim(),
          }));
    if (cues.length === 0) return;
    set({ status: 'exporting srt' });
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
    const dawn = window.dawn;
    const { timeline, mediaPath } = get();
    if (!timeline || !mediaPath || !dawn) return;
    // 작업 현황(오버레이/수기자막/TTS)의 tmp 에셋(PNG/wav)을 .dawn 옆 .assets/로 복사해
    // 재부팅에도 살아남게 한 뒤(src 바꿔치기), 풀 상태(v3)를 저장한다 — issue #17.
    const assets = collectAssetPaths(get());
    const mapping = assets.length ? await dawn.archiveAssets(path, assets) : {};
    await dawn.saveProject(path, serializeFullProject(get(), mapping));
    // 매핑된 새 경로를 라이브 상태에도 반영(저장 직후 tmp가 사라져도 미리보기 유지).
    if (Object.keys(mapping).length) remapAssetPaths(set, get, mapping);
    await dawn.autosaveClear?.(); // 정식 저장됨 — 구버전 복구 제안 방지
    set({ status: 'saved' });
  },

  openProject: async (path) => {
    const dawn = window.dawn;
    if (!dawn) return;
    const project = deserializeProject(await dawn.openProject(path));
    set(restoreFromProject(project));
  },

  // ── 자동저장 복구(issue #17) ──
  autosavedAt: null,
  recovery: null,
  checkRecovery: async () => {
    const dawn = window.dawn;
    if (!dawn?.autosaveRead) return;
    // 이미 작업 중이면(미디어 열림) 덮어쓰기 제안하지 않는다.
    if (get().mediaPath) return;
    const saved = await dawn.autosaveRead();
    if (saved) set({ recovery: { savedAtMs: saved.savedAtMs } });
  },
  recoverAutosave: async () => {
    const dawn = window.dawn;
    if (!dawn?.autosaveRead) return;
    const saved = await dawn.autosaveRead();
    if (!saved) {
      set({ recovery: null });
      return;
    }
    const project = deserializeProject(saved.content);
    set({ ...restoreFromProject(project), recovery: null, status: '작업을 복구했습니다' });
  },
  dismissRecovery: () => {
    void window.dawn?.autosaveClear?.();
    set({ recovery: null });
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
        planExcluded: [],
        nlError:
          commands.length === 0
            ? '이해하지 못한 명령입니다. (예: "말버릇 빼줘", "시네마틱하게")'
            : null,
      });
    } catch (e) {
      set({ nlBusy: false, nlError: e instanceof Error ? e.message : String(e) });
    }
  },
  planExcluded: [],
  togglePlanCommand: (index) => {
    // 부분 적용(#14): 체크 해제된 명령을 빼고 dry-run을 다시 평가한다(승인 전 상태 불변).
    const { pendingPlan, planExcluded, timeline, transcript, subtitleStyle } = get();
    if (!pendingPlan || !timeline || !transcript) return;
    const excluded = planExcluded.includes(index)
      ? planExcluded.filter((i) => i !== index)
      : [...planExcluded, index];
    const enabled = pendingPlan.commands.filter((_, i) => !excluded.includes(i));
    const { report } = dryRunCommands({ timeline, transcript, subtitleStyle }, enabled);
    set({ planExcluded: excluded, planReport: report });
  },
  approvePlan: () => {
    // 승인 = 유일한 상태변경 지점. 선택된(체크된) 명령만 command bus로 적용 + 감사 로그 기록.
    const { pendingPlan, planReport, planExcluded, timeline, transcript, subtitleStyle } = get();
    if (!pendingPlan || !planReport?.ok) return;
    const approved = pendingPlan.commands.filter((_, i) => !planExcluded.includes(i));
    if (approved.length === 0) return;
    if (!timeline || !transcript) return;
    let st: { timeline: TimelineModel; transcript: TranscriptModel; subtitleStyle: SubtitleStyle } =
      {
        timeline,
        transcript,
        subtitleStyle,
      };
    let audit = get().auditLog;
    for (const cmd of approved) {
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
      planExcluded: [],
      nlError: null,
      status: 'ready',
      ...derive(st.timeline),
    });
  },
  rejectPlan: () => set({ pendingPlan: null, planReport: null, planExcluded: [], nlError: null }),

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

// ── 자동저장(issue #17) — 편집 변화가 잠잠해지면 2.5s 뒤 userData/autosave.dawn에 기록.
// 정식 저장(saveProject)·복구 무시(dismissRecovery)가 슬롯을 비운다. 에셋 복사는 하지 않는다
// (재부팅 전 복구가 목적 — 정식 저장만 .assets/ 아카이브).
const AUTOSAVE_DEBOUNCE_MS = 2_500;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let autosaveLast: {
  timeline: TimelineModel | null;
  transcript: TranscriptModel | null;
  overlays: unknown;
  manualCues: unknown;
  ttsClips: unknown;
  subtitleStyle: unknown;
  subtitlePos: unknown;
  colorPreset: unknown;
  reframe: unknown;
} | null = null;

useEditor.subscribe((s) => {
  if (!s.timeline || !s.mediaPath || !window.dawn?.autosaveWrite) return;
  // 관심 필드의 참조 비교 — 무관한 set(재생/플레이헤드 등)에는 반응하지 않는다.
  const snap = {
    timeline: s.timeline,
    transcript: s.transcript,
    overlays: s.overlays,
    manualCues: s.manualCues,
    ttsClips: s.ttsClips,
    subtitleStyle: s.subtitleStyle,
    subtitlePos: s.subtitlePos,
    colorPreset: s.colorPreset,
    reframe: s.reframe,
  };
  if (
    autosaveLast &&
    Object.keys(snap).every(
      (k) => autosaveLast![k as keyof typeof snap] === snap[k as keyof typeof snap],
    )
  )
    return;
  autosaveLast = snap;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    const st = useEditor.getState();
    if (!st.timeline || !st.mediaPath) return;
    try {
      const r = await window.dawn!.autosaveWrite!(serializeFullProject(st, {}));
      useEditor.setState({ autosavedAt: r.savedAtMs });
    } catch {
      // 자동저장 실패는 치명적이지 않다(다음 변경에서 재시도).
    }
  }, AUTOSAVE_DEBOUNCE_MS);
});

export { deadSet };
