# dawn-cut 기능 감사 (Feature Audit)

> 워크플로 `wf_8bafe932`(7 에이전트: 코드그라운딩 인벤토리 + CapCut/Vrew·Descript/OpenCut·OSS NLE/AI-에이전트 4맵 → 종합 → 적대검증) 산출. 적대검증 **grounded:true**. 2026-06-02.
> 비평이 잡은 정정 반영됨: ① "로컬 LLM 번역 wired" 주장 삭제(번역 경로 없음), ② 경쟁사 주장=방향성 헤지, ③ command bus = **11 verb**(코드 기준; 일부 문서의 "9 verb"는 stale).

**타깃 유저(모든 결정의 기준):** 프라이버시·비용 민감한 한국어 롱폼 1인 크리에이터(팟캐스트/해설/강의/레시피). 10~40분 원본을 클라우드 업로드·구독·수동 타임라인 없이 자막 + 정돈 + 쇼츠로. **포지셔닝: 로컬 + 자동 + 에이전트 구동 가능 — CapCut식 수동 NLE 아님.** 전환 라이브러리가 아니라 "비공개·무료·무제한·에이전트 구동"으로 이긴다.

---

## 1. 격차 매트릭스 (Gap Matrix)

> ⚠️ **경쟁사 능력 주장은 2026-01 지식 기준 외부/시장 주장이며 코드로 검증된 것이 아니다 — AHEAD/BEHIND는 방향성으로 보라. 코드 검증 열은 dawn-cut 쪽뿐이다.**

## dawn-cut Gap Matrix (code-verified 2026-06-02; "behind" claims re-checked against current tree, not dossier snapshot)

> Note: the dossier is **stale** on three items. Animated captions (reveal/karaoke), the `vivid` 1-tap preset, and style packs are now **implemented + UI-surfaced + pixel-verified** (`effects.ts:31,137`; `subtitles.ts:88,111` + `index.tsx:1252`; `templates.ts STYLE_PACKS` + `index.tsx:1332 applyPackAndBurn`; PRODUCTION.md marks all three ship-ready). They are corrected to PAR/AHEAD below.

| Feature category | vs CapCut | vs Vrew/Descript | vs OpenCut/OSS NLE | vs AI-agent (Opus/Underlord) | Status & evidence |
|---|---|---|---|---|---|
| **Deterministic, validated, agent-drivable edit IR** | AHEAD (no equivalent) | AHEAD (both black-box cloud) | AHEAD (none expose a machine IR) | AHEAD (pro-NLE MCPs are non-deterministic ExtendScript bridges) | **THE MOAT.** 11-verb Zod union → 1 dispatcher w/ post-condition invariant gate (`edit-command.ts:296`), hash-chain audit (`audit.ts`), dry-run, MCP 10 tools (`apps/mcp/src/mcp-server.ts`). Unique combination. |
| **100% local / no account / no watermark / MIT** | AHEAD | AHEAD | PAR (OpenCut/Kdenlive also local) | AHEAD (all rivals cloud) | Structural, not a feature (`package.json`). |
| **Text-based cut (delete words → ripple footage)** | AHEAD (CapCut auto-cut is opaque) | PAR (category def by Descript/Vrew) | AHEAD (OpenCut has zero STT) | PAR | `deleteWordRange`/`cutSourceRange` real, gapless ripple (`commands.ts:47,82`), SYNC-INV proven. |
| **Auto silence / filler removal** | PAR | PAR (KO lexicon narrower, conservative by design) | AHEAD | PAR | `removeSilences`/`removeFillers` (`commands.ts:116`, `fillers.ts`). |
| **Auto captions + KO eojeol + reveal/karaoke + per-cue editor** | PAR (CapCut has more templates/auto-translate) | PAR→AHEAD on KO eojeol fidelity (`whisper.ts:97`) | AHEAD | PAR | reveal/karaoke **shipped** (`subtitles.ts:88,111`, `index.tsx:1252`, G28/G29 pixel tests). Corrects dossier "absent". |
| **Subtitle burn-in (GUI)** | PAR | PAR | AHEAD | n/a | GUI burns PNG frames (`index.tsx:1201 doBurn`). **MCP `render` does NOT burn** (`mcp-server.ts:149`, `session.ts:164`) — agent output ≠ GUI output. |
| **Color presets (6) + 1-tap auto-enhance** | BEHIND (smaller library, no LUT/HSL/curves UI) | PAR/AHEAD on basics | PAR | PAR | 6 presets incl. `vivid` **shipped** (`effects.ts:31,137`); `applyAutoEnhance` deterministic from signalstats (`effects.ts:261`). Adaptive-intensity variant still external-only. |
| **Style packs (1-click look bundles)** | BEHIND (no template marketplace / network effect) | BEHIND (Vrew scene/layout templates) | AHEAD | PAR | 6 packs **shipped** as EditCommand[] plans (`templates.ts`, `index.tsx:1332`). These are look bundles, NOT scene/layout templates. |
| **Punch-in zoom** | BEHIND (CapCut full keyframe transforms) | PAR | BEHIND (Kdenlive keyframed) | PAR | `applyZoom` is strictly **2-point** from→to linear (`effects.ts:21-23`). No multi-point clip keyframes. |
| **Overlays (img/sticker/gif) w/ multi-keyframe + blend + rotation** | PAR (overlay-only, no on-canvas drag) | AHEAD vs both | PAR/AHEAD for shorts | PAR | Genuinely rich in core (`overlay.ts`, `types.ts:73`); UI inspector exposes only `to.x/y`+rotation (easing/multi-kf/blend core-only). |
| **Reframe 9:16 / 1:1** | BEHIND (CapCut auto-reframe w/ subject tracking) | PAR (both center-crop-ish) | AHEAD | BEHIND (Opus tracks active speaker) | **Center-crop only**, no saliency/face tracking (`cropForAspect`). No tracking sidecar exists (grep 0). |
| **NL → edit (agent can actually DRIVE)** | n/a | n/a | n/a | BEHIND on coverage | Planner drives only **5 of 11** verbs (`PLANNER_VERBS`, `planner.ts:39`); cut/silence/zoom externally-gated (need µs/IDs). `findWords`/`findSilences` selectors + `highlightKeyword` verb **NOT implemented** (grep 0). This is the single biggest agent-vision gap. |
| **Transitions / crossfade** | BEHIND (★★★ for social) | BEHIND | BEHIND | BEHIND | **Absent** (only amix `dropout_transition`, `setpts` for trim). Hard-cut concat only. |
| **Speed / time-remap / ramps** | BEHIND (★★★ signature) | BEHIND | BEHIND | BEHIND | **Absent** — no atempo/setpts-stretch. Trim is length-invariant only. |
| **Auto-highlight / long-video → shorts** | BEHIND | BEHIND (Vrew auto-shorts) | n/a | BEHIND (Opus/Underlord headline) | **Absent** but `chapters.ts extractChapters` + transcript scoring is a ready substrate. |
| **AI dubbing / translation-revoice** | BEHIND | BEHIND (both translate+revoice) | n/a | BEHIND | **Absent** — TTS is macOS `say`/Piper stock only; glossary substitution only. 번역 경로 없음(grep 0). TTS는 macOS `say`/Piper 스톡, glossary는 용어 치환만. 더빙은 신규 translate/dub verb 필요. |
| **Screen / camera recording** | BEHIND | BEHIND (both have it) | BEHIND | n/a | **Absent** (no desktopCapturer/getDisplayMedia, grep 0). Biggest table-stakes gap for tutorial/talking-head. |
| **Voice clone / Overdub** | n/a | BEHIND (Descript signature) | n/a | n/a | **Absent.** Ethically fraught + heavy model + off-thesis. Intentional skip. |
| **Speaker diarization** | BEHIND | BEHIND | n/a | BEHIND | **Absent.** Whisper-only, no pyannote. |
| **Beat-synced cuts / music library / audio mixer** | BEHIND (★★★ retention hook) | BEHIND (Vrew BGM) | BEHIND (Kdenlive mixer) | BEHIND (CapCut beat markers) | **Absent.** Audio = single-voice TTS amix (`index.ts:268`). No onset detection (grep 0). |
| **Multitrack / manual drag-trim-split timeline** | BEHIND (CapCut spine) | BEHIND | BEHIND (OpenCut/Kdenlive own this) | n/a | **Absent by construction** (`timeline.ts:30,45` single video track + clip; gapless ripple hardcoded). **Deliberate — this is the moat boundary, not a gap to close.** |
| **Masking / chroma / background removal** | BEHIND (★★★ AI flagship) | n/a | BEHIND | BEHIND | **Absent.** Overlays use global opacity, no per-pixel matte. Needs external segmentation model. |
| **Export presets (4K / fps / bitrate / audio-only)** | BEHIND | BEHIND | PAR | n/a | mp4 (libx264 yuv420p) + gif only; no resolution/bitrate picker surfaced. Trivial FFmpeg-arg gap. |
| **Collaboration / cloud** | BEHIND | BEHIND (Descript strength) | PAR (none) | n/a | **Absent by design** — contradicts 100%-local pitch. Intentional skip. |

---

## 2. 투자 우선순위 (Impact × Effort × Moat-safety × Vision)

## Prioritized Investment Recommendation

Scoring per candidate: **Impact** (demo punch × user value) · **Effort** (S/M/L) · **Moat-safety** (preserves deterministic single-track EDL + agent-drivable verb bus? PASS / RISK / BREAK) · **Vision-alignment** (advances NL/agent editing?). Ranked by (Impact × Moat-safety × Vision) ÷ Effort.

### TIER 1 — Build first. High impact, moat-safe, vision-advancing, mostly leverage on existing infra.

**1. NL selector layer (`findWords` / `findSilences` read-only tools) → unlock cut/silence/zoom for the agent (close the 5→11 gap).**
- Impact: HIGHEST. Today the agent *cannot cut by language* — only because µs/wordId can't be synthesized from NL. The vision already specs the fix (`VISION-AI-EDITING.md:334-346`). Turns "cut the dead air and the intro ramble" into a real one-prompt edit. This is the demo that makes "natural-language editing" true instead of aspirational.
- Effort: M. Selectors sit on existing `sync.ts wordToProgram`/`liveWords` (`VISION-AI-EDITING.md:547`); resolve NL refs → handles, LLM works in handles not arithmetic. No grammar weakening — purely additive.
- Moat-safety: PASS. Read-only resolvers + existing verbs; nothing touches single-track EDL or invariants. Deepens the moat (more the agent can wield).
- Vision-alignment: MAXIMUM. This *is* the vision's stated #1 fix.

**2. Lift `highlightKeyword` into the command bus (keyword-emphasis caption verb).**
- Impact: HIGH. The "viral caption" look (key phrase pops yellow). Documented ROI-top-1 (`VISION-AI-EDITING.md:114`).
- Effort: S. Infra exists — `keywords.ts:165 pickKeywords`, per-cue emphasis rendering in `draw.ts`, `emphasisColor` in style. It is simply **not yet an EditCommand** (grep 0 in `edit-command.ts`). New reducer over existing per-cue infra.
- Moat-safety: PASS. Length-invariant caption metadata; agent inherits it free via Zod→manifest.
- Vision-alignment: HIGH. NL-drivable, no external coords needed (planner-whitelist-safe).

**3. MCP `render`: burn subtitles + overlays (close the agent-output ≠ GUI-output gap).**
- Impact: MED-HIGH (credibility). Today MCP render is cut+color+zoom+reframe only (`mcp-server.ts:149`, `session.ts:164`); GUI already burns via `renderEdl`. The agent's deliverable currently looks worse than the GUI's — undermines the whole agent pitch.
- Effort: S. Pure plumbing — wire the GUI burn path into MCP render.
- Moat-safety: PASS. Zero structural change.
- Vision-alignment: HIGH. Completes the agent story.

**4. Deterministic auto-highlight / "long video → short clip" (transcript-scored cut plan).**
- Impact: HIGH (demo). Local answer to Opus Clip's headline. "Turn my 20-min talk into a 60s clip, locally, free" — crushes rivals on the privacy+free axis.
- Effort: M. Score sentences by keyword density / silence / energy; emit `deleteWordRange`/`cutSourceRange[]`. Substrate exists (`chapters.ts extractChapters`, `keywords.ts`). Stays a **plan over the single track** — no multitrack.
- Moat-safety: PASS. Emits standard EditCommand[], dry-runnable + auditable.
- Vision-alignment: MAXIMUM. One magic button, fully agent-reproducible.

### TIER 2 — Build next. Moat-safe, strong demo, but heavier or one structural caution.

**5. Crossfade / dip-to-black transition as a typed, length-accounted verb.**
- Impact: HIGH (table-stakes for the "social edit" before/after; reads instantly).
- Effort: M. But it is the one to **design carefully**: a true crossfade *overlaps* two segments, which violates EDL totality (Σ segments == total, `edl.ts:25`). Model it as a verb with **explicit deterministic time consumption** (overlap N µs accounted in the EDL math) so EDL-INV/SYNC stay provable — NOT as a freeform overlap.
- Moat-safety: PASS *only if* specified as a length-accounted verb (RISK if done as ad-hoc overlap). This is the first crack in "duration == sum of segments" if done wrong.
- Vision-alignment: MED (agent can request "add dissolves on the cuts").

**6. Clip-level speed factor (constant; simple ramp later) as an explicit transform verb.**
- Impact: HIGH (slow-mo / speed-up is an instant wow, frequent ask).
- Effort: M. New per-clip `speedMultiplier` remaps source↔program length; FFmpeg atempo/setpts.
- Moat-safety: RISK (handle with care). It touches the exact source→program timing math that the whole text-cut/SYNC model leans on. Safe **only** as an explicit validated transform with recomputed durations the invariant gate checks — never as a freeform timeline drag. Add invariant coverage before shipping.
- Vision-alignment: MED.

**7. Subject-tracking auto-reframe (face/active-speaker → keyframed crop).**
- Impact: HIGH (Opus's marquee; CapCut ★★★).
- Effort: L. Needs a vision model in the sidecar.
- Moat-safety: PASS. Tracking runs as a deterministic sidecar that **emits crop keyframes into the EDL** (content-addressed, replayable — the pattern the vision prescribes for generative ops, `:219-227`). Crop is already EDL-expressible.
- Vision-alignment: MED-HIGH.

**8. Local AI dubbing / translation-revoice (translate transcript → re-synth Piper → re-time to cues).**
- Impact: HIGH on positioning ("translate this video to English, locally, free" beats Vrew/Descript on privacy+cost).
- Effort: L. **정정:** 로컬 LLM은 NL→EditCommand 플래닝에만 연결돼 있고 문장 번역 경로는 없다(grep 0; `glossary.ts`는 용어 치환). 따라서 더빙은 새 translate 프롬프트 + `translate`/`dub` verb + cue 재타이밍 + 다국어 Piper가 필요한 from-scratch L(기존 배선 재사용 아님).
- Moat-safety: PASS (pure EDL/cue ops + new verbs).
- Vision-alignment: HIGH.

**9. Export presets (4K / fps / bitrate / audio-only mp3-wav) + Korean font pack + UI exposure of existing overlay easing/blend.**
- Impact: MED (removes "feels v0.1" friction; closes visible Vrew caption-breadth gap).
- Effort: S. FFmpeg-arg additions + UI plumbing for already-built core capabilities.
- Moat-safety: PASS.
- Vision-alignment: LOW (polish, not agent).

### TIER 3 — Lower priority but moat-safe.
- Speaker diarization labels (whisper/pyannote-local; new transcript field) — demos for podcasts; M effort.
- Beat markers → snap existing cuts/zoom to onsets (deterministic markers); needs onset sidecar; M.
- BGM as a **fixed audio-overlay EDL channel** (NOT a manual mixer); OTIO export for NLE interop.
- More color presets / caption animations (bounce/slide) — S, additive.

### DO NOT BUILD — moat-breaking traps (explicit refusals with reasons).

- **Multitrack / manual drag-trim-split timeline.** BREAKS the moat. `timeline.ts:30,45` hardcodes single video track + clip; `rebuildGapless` and TL-INV-2/EDL-INV/SYNC-INV all depend on it. Overlapping clips make program-time a non-total, non-monotonic function of source time → SYNC-INV (`programToWord`/`wordToProgram`) collapses, dry-run stops being a clean length delta, and the action space becomes continuous spatial drag that can't be grammar-constrained for an agent. It also drags dawn-cut into OpenCut/CapCut/Kdenlive's mature territory where it would be *behind* — abandoning the one axis where it's *alone*. If B-roll/PIP/music is ever needed, add it ONLY as additional **declarative EDL/OTIO channels** the core composes + validates, never as a manual surface. Defer to last (vision says generalize this last — `VISION-AI-EDITING.md:495`).
- **Manual frame-by-frame keyframe/curve editor on the base clip.** Same problem — pushes toward a GUI-first NLE whose state can't be cleanly expressed as auditable commands. Declarative overlay keyframes (already in core) are the safe ceiling.
- **Masking / chroma / general audio mixing desk.** Per-pixel matte + manual volume-automation reintroduce the freeform-timeline problem and need heavy models off-thesis. The single-voice TTS amix is sufficient.
- **Voice clone / Overdub.** Marquee Descript feature, but consent-fraught, heavy local model, and doesn't fit the verifiable-EDL thesis. Skip or far-future opt-in.
- **Cloud collaboration / accounts.** Contradicts the 100%-local promise that is the entire pitch.

**Rule of thumb:** anything expressible as a typed, length-accounted EditCommand the reducer validates and the planner/MCP can emit is moat-safe and is the default way features should land. Anything requiring a human to drag things around a freeform canvas as the *primary* interaction breaks the thesis.

---

## 3. 첫 쇼케이스 플랜

## First User-Facing Showcase Plan

**Target user (anchor every decision to this):** the privacy/cost-sensitive Korean long-form solo creator — podcaster, talking-head YouTuber, recipe/lecture maker — who has a 10-40 min raw recording and wants captioned, tightened shorts without uploading footage to a cloud, paying a subscription, or hand-editing a timeline. Honest positioning: **local + auto + agent-drivable, NOT a manual CapCut-pro NLE.** We win on "private, free, unlimited, agent-drivable," not on transition libraries.

### Production surface (ship in v0.1 — verified ship-ready per PRODUCTION.md, real on the app path)
Surface ONLY what is pixel/audio-verified and works from a packaged app:
1. **Auto Korean subtitles → cue → burn-in** (the strongest wow; `transcriptToCues`→`captionFrames`→PNG composite, G18/G27/G28/G29).
2. **Animated captions — reveal / karaoke** (shipped, `subtitles.ts:88,111` + `index.tsx:1252`). This is the single feature that most narrows the CapCut gap and it already works.
3. **Style packs — 6 one-click look bundles** (`templates.ts` + `index.tsx:1332 applyPackAndBurn`): caption style+anim + color + filler-removal in one click. Demos "instant genre look" without a marketplace.
4. **Color: 6 presets incl. `vivid` 1-tap** + **9:16 / 1:1 reframe (center-crop)** + **cut / filler / silence removal** + **TTS voiceover** + **overlays**. All ship-ready.

Follow PRODUCTION.md **Scenario B**: core ships as *production*; NL planner + MCP ship **labeled "experimental"** (model-install-dependent, 1.5B quality, MCP subtitle-burn gap not yet closed). Do not advertise NL/MCP as polished until Tier-1 items #1 and #3 land.

### DAWN_ADVANCED dev-gate (build the flag; gate the in-flight Tier-1/2 work behind it)
No feature flag exists today (grep 0) — introduce `DAWN_ADVANCED` as a single env/build gate so the demoable-but-unpolished features can be developed in-tree, exercised in demos/dev, and excluded from the production UI until verified:
- **Auto-highlight ("long video → 60s clip")** — the headline agent demo; gate until the scoring heuristic is tuned and dry-run-clean.
- **NL selector cut/silence/zoom** (Tier-1 #1) — gate until `findWords`/`findSilences` resolve reliably and the planner whitelist is widened with grammar coverage.
- **`highlightKeyword` emphasis verb** (Tier-1 #2) — gate during wiring, then graduate to production fast (low risk).
- **MCP subtitle/overlay burn-in** (Tier-1 #3) — gate, then graduate once it matches the GUI render byte-for-byte.
- **Transition verb, speed verb, subject-tracking reframe, local dubbing** (Tier-2) — keep behind the gate; these are demo-fodder and roadmap-credibility, not v0.1 production.

### The single demoable "wow" loop (one continuous take, no cuts, ~60s, fully local)
**"Drop a 20-minute raw Korean talk → one prompt → a captioned, tightened 60-second short, on-device, no account."**

1. Open a long raw `.mp4` (no pre-baked captions) in dawn-cut. Footage never leaves the machine.
2. Auto-transcribe locally (whisper large-v3-turbo, KO eojeol). Transcript appears with word timing.
3. Type **one** natural-language instruction: *"인트로 잡담이랑 죽은 구간 잘라서 60초 하이라이트로 만들고, 핵심 문구 노란색으로 강조한 자막 넣어줘"* ("cut the intro chatter and dead air into a 60-second highlight, add captions with the key phrases in yellow").
4. The agent emits a **dry-run plan** (auto-highlight cut selection via `findWords`/`findSilences` → `deleteWordRange`/`cutSourceRange`, `highlightKeyword`, a style pack). User sees the diff — *"removed 18m 40s"* — and approves. Hash-chain audit logs every step.
5. Render → 9:16, burned reveal-animated captions with yellow keyword emphasis, `vivid` grade. Play before/after side-by-side.

**Why this loop is the right showcase:** it lands on the exact three things no competitor combines — **(a) 100% local** (the privacy/cost wedge for the Korean creator), **(b) one-prompt auto edit** (Underlord's promise, but on-device and free), **(c) a reviewable, auditable, deterministic plan** (the moat — "the AI's edits are auto-checkable, not opaque"). It rides entirely on the single-track EDL — no multitrack, no manual timeline — so it *demonstrates the thesis instead of betraying it.* Production surfaces steps 1-2 and 5 today; the Tier-1 work (selector layer + highlightKeyword + auto-highlight + MCP burn-in) is what turns step 3-4 from a stub into the wow, and it should be developed behind `DAWN_ADVANCED` and graduated to production as each piece passes pixel/dry-run verification — in the order #2 → #3 → #1 → auto-highlight.

---

## 4. 적대검증 요약

**verdict:** grounded: true. The synthesis is substantially accurate, honest, and moat-aware. I verified every load-bearing code citation against the tree and the inventory: the 11-verb Zod discriminated union + single applyCommand/validateState gate (edit-command.ts:133-145,296-308), the planner whitelist being exactly 5 of 11 with cut/silence/zoom/cutSourceRange externally-gated (planner.ts:39-44,76), highlightKeyword/findWords/findSilences genuinely grep-0 in source (spec'd only in VISION-AI-EDITING.md:114,238,334-346), the MCP render gap (session.ts:166 takes only outPath+reframe, no overlays/subtitles; comment explicitly states "자막 번인은 렌더에 미포함"), the GUI burn path (index.tsx doBurn rasterizes captionFrames to PNG overlays via renderEdl), single-track timeline + rebuildGapless + EDL totality invariant (timeline.ts, edl.ts:25 EDL-INV-1), and the shipped state of reveal/karaoke, vivid, and STYLE_PACKS (all confirmed + PRODUCTION.md marks them ship-ready with pixel tests G28/G29/g30). The "DO NOT BUILD" refusals are correctly reasoned: multitrack genuinely would collapse SYNC-INV (wordToProgram/programToWord round-trip in sync.ts:9-26) and EDL totality, and the synthesis flags the crossfade/speed verbs as the real moat-risk edges that must be length-accounted — that caution is correct and not hand-waved. The showcase plan leads with the strongest, fully-shipped, pixel-verified area (local Korean auto-captions + animation + reframe), honestly labels NL/MCP as experimental per PRODUCTION.md Scenario B, and explicitly admits steps 3-4 of the wow-loop are a stub today pending Tier-1 work — no overselling of present capability. Target-user framing (privacy/cost-sensitive Korean long-form solo creator) is consistent with the README positioning (100% local / no account / no watermark / MIT, eojeol fidelity). The only real defect is a repeated factual overclaim about "local-LLM translate is wired" feeding an AI-dubbing recommendation; it does not undermine the moat reasoning but must be corrected.

**남은 정정(문서 정합):**
1. **Fix the translate-wired overclaim (both occurrences).** In the AI-dubbing gap-matrix row and recommendation #8, replace "Local-LLM translate is wired" with: "Local LLM is wired for NL→EditCommand planning only (llama.cpp + Qwen2.5-1.5B); there is NO sentence-translation path (grep 0; `glossary.ts` is term substitution, not translation). Dubbing therefore needs a NEW translate prompt + `translate`/`dub` verbs + cue re-timing + multi-language Piper voices — treat as a from-scratch L, not thin wiring." This keeps it Tier-2/L but corrects the false "already wired" premise.

2. **Correct the dossier's MCP render signature** (note for whoever maintains the inventory): inventory tool #9 should read `render(outPath, reframe?)` — drop the `overlays?, ...`. The synthesis's text is already correct; only the ground-truth dossier needs the fix. Optionally add a one-line footnote in the gap matrix: "Inventory snapshot lists an `overlays?` param on MCP render that does not exist in `session.ts:166`; synthesis reflects the actual signature."

3. **Reconcile the 9-vs-11 verb count** across docs. The code has 11 union members; PRODUCTION.md:36 says 9. Standardize on 11 (or annotate which two PRODUCTION.md excludes and why — likely correctWord + one style-variant). Synthesis is correct as-is.

4. **Add a hedge to the competitor cells.** Prepend the gap matrix with: "Competitor capability claims are external/market assertions as of 2026-01 knowledge, not code-verified; treat AHEAD/BEHIND as directional. The code-verified column is dawn-cut's side only." This is honesty-preserving and matches the project's stated selling point (honesty) without weakening any dawn-cut claim.

5. **Tiny precision nit (optional):** the moat row says "MCP 10 tools" — mcp-server.ts registers the documented set but the inventory's tool #10 is itself hand-wavy ("Additional tool coverage: subtitle_write, silence_detect_stub, etc."). If the "10 tools" number is used in marketing, count the actual `registerTool` calls before publishing rather than trusting the dossier's rounded "10."

No adjustment needed to: the moat boundary reasoning, the DO-NOT-BUILD refusals, the Tier-1 prioritization, the DAWN_ADVANCED gating plan, the showcase wow-loop ordering, or the target-user framing — all verified accurate and moat-consistent.
