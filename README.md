# dawn-cut

### The open-source video editor where your footage never leaves your machine.

Edit video like a document — **auto subtitles, text-based cutting, and automatic
silence removal, 100% local.** No cloud, no account, no watermark, no subscription.

<p>
  <img alt="100% local" src="https://img.shields.io/badge/100%25-local-2ea44f">
  <img alt="no watermark" src="https://img.shields.io/badge/no-watermark-2ea44f">
  <img alt="no subscription" src="https://img.shields.io/badge/no-subscription-2ea44f">
  <img alt="no account" src="https://img.shields.io/badge/no-account-2ea44f">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue">
</p>

> **Status: PoC (Proof of Concept).** The deterministic editing core is real and
> tested (text-based cut, silence removal, Korean auto-subtitles, SRT/chapter
> export). Natural-language AI editing is the **vision** we're building toward — it
> is *not* shipped yet. We label everything below honestly: what works today vs.
> what's on the [Roadmap](#roadmap).

---

## Demo

<!-- Replace with the hero GIF: original clip → tight, captioned cut. Recommended path: -->
![dawn-cut demo: import → auto-transcribe → text-cut + silence-removal → captioned export](assets/hero.gif)

> _Placeholder._ A reproducible end-to-end run (real `whisper.cpp` + FFmpeg) already
> exists under [`demo-output/`](demo-output/README.md): a 23.6s English-narrated clip
> is transcribed, text-edited, silence-trimmed to 17.3s, and exported with a muxed
> **soft (toggleable) subtitle track** + SRT + a reusable `.dawn` project. (The UI can
> also *burn* subtitles in; Korean is covered by unit + integration tests.) Regenerate
> it with
> `pnpm demo:assets && pnpm demo:run && pnpm demo:ui`.

---

## Why dawn-cut

Every popular "AI video editor" makes you pick **one** of two things you actually
want: *privacy* or *AI assistance*. The cloud tools take your footage; the local
tools can't think. dawn-cut is built so you don't have to choose.

| | dawn-cut | CapCut | Vrew | Descript | OpenCut |
|---|---|---|---|---|---|
| Runs 100% locally | **Yes** | No (cloud) | No (cloud STT) | No (cloud) | Yes (browser) |
| No account / no watermark / no subscription | **Yes** | No | Free tier limited | Credits/limits | Yes |
| Word-level STT + text-based editing | **Yes** | No | Partial | Yes | No |
| Auto subtitles (incl. Korean) | **Yes (local)** | Cloud | Cloud | Cloud | No |
| Deterministic, verifiable edit core (EDL + invariants) | **Yes** | No | No | No | No |
| Open source | **Yes (MIT)** | No | No | No | Yes (MIT) |

- **vs CapCut** — Your video never leaves your laptop. No telemetry, no terms that
  claim a license to your face and voice, no export watermark.
- **vs Vrew** — Comparable Korean auto-captioning (whisper `large-v3-turbo`), but
  local, unlimited, and free. dawn-cut reassembles Korean *eojeol* (word + particle)
  losslessly from whisper tokens — see [`whisper.ts`](packages/core/src/whisper.ts).
- **vs Descript** — The same "delete a sentence, delete the footage" text-based
  editing — but with no cloud, no credits, no upload.
- **vs OpenCut** — OpenCut owns the general-purpose, hand-edited browser timeline.
  dawn-cut takes the gap it leaves: **word-level STT, text-based editing, and a
  deterministic edit core a machine can drive** — the foundation for agent editing.

---

## What works today

Honest list — every item below is implemented in [`packages/core`](packages/core)
and covered by unit/property tests, or wired through the Electron UI.

- **Word-level transcription** — `whisper.cpp` (MIT, local) produces per-word
  timestamps; Korean *eojeol* are reconstructed losslessly (validated char-accuracy,
  zero mojibake).
- **Text-based editing** — delete a word range and the corresponding footage is cut
  and rippled gaplessly (`deleteWordRange`, `cutSourceRange`).
- **Automatic silence removal** — detect silent intervals and trim them with
  configurable padding (`removeSilences`).
- **Filler-word detection** — conservative Korean filler lexicon, exact-match only
  (`detectFillers`).
- **Auto subtitles** — group live words into program-timed cues, break on sentence
  ends / cuts / word caps, export **SRT** (`transcriptToCues`, `formatSrt`).
- **Auto chapters** — rule-based YouTube `M:SS title` chapter list from the
  transcript (`extractChapters`, `formatChapters`).
- **Glossary substitution** — deterministic term replacement across the transcript
  (`applyGlossary`).
- **Image / sticker / GIF overlays** — position, scale, opacity, z-order, rotation,
  blend modes, and multi-keyframe motion paths, **composited into the exported video**
  via the FFmpeg overlay filter (`OverlayClip`, [`overlay.ts`](packages/core/src/overlay.ts),
  [`draw.ts`](packages/core/src/draw.ts), `renderEdl`).
- **Deterministic EDL export** — the timeline compiles to an Export Decision List
  that the FFmpeg sidecar renders (`timelineToEdl`).
- **Transcript ↔ timeline sync** — provable two-way mapping between words and
  program time (`wordToProgram`, `programToWord`).
- **Project save / open** — versioned `.dawn` JSON; full undo/redo
  ([`history.ts`](packages/core/src/history.ts)).
- **Electron desktop app** — import media, transcribe, edit by text, scrub, preview
  subtitles live, and export.

### Built on data contracts, not vibes

The editing core is the moat. It is **pure TypeScript** — it may not import
`electron`, `fs`, `child_process`, or `path` (enforced by `dependency-cruiser`).
Every model is governed by validated invariants:

- **Time is integer microseconds (µs)**; intervals are half-open `[start, end)`.
- `validateSync` proves the transcript↔timeline roundtrip (SYNC-INV).
- `validateEdl` proves the export list is contiguous and total-duration-exact
  (EDL-INV).
- `validateCues` proves subtitles are sequential, non-overlapping, and in-bounds
  (SUB-INV).
- Commands are **pure functions** returning `{ before, after, removedProgramUs }`,
  so every edit is undoable and replayable.

These properties — determinism, validation, undo, headless execution — are exactly
the non-functional requirements an AI editing agent will need.

---

## Vision

> **Say what you want; the AI proposes the edit; you review the timeline/EDL; then
> render.** Not a black box.

The endgame is an editor where you type *"cut the dead air and put captions on the
key points"* and an LLM emits a list of **validated, serializable `EditCommand`s**
that the deterministic core applies and renders — with a dry-run diff you approve
first. Because the core already exposes a reviewable intermediate representation
(timeline + EDL) and validates every step, an agent's edits are reproducible and
auto-checkable rather than opaque.

This is **roadmap, not reality today.** The natural-language layer (command bus,
Zod-derived tool schemas, local LLM planner, MCP server) is still 0% built. See
below.

---

## Roadmap

- **Phase 1 — Command bus.** Lift the editing actions scattered in the UI store into
  a single serializable `EditCommand` union with one `applyCommand` dispatcher, each
  verb backed by one Zod schema (→ TS type + runtime guard + JSON-Schema manifest).
  Post-condition gate runs the invariant validators after every command.
- **Phase 2 — Dry-run / diff / commit + audit log.** Preview an edit on a cloned
  state, show the diff (removed µs, changed cues, length delta), commit through an
  append-only hash-chained log. Add a real render pipeline for punch-in zoom and
  color grading (effect-aware EDL).
- **Phase 3 — Local LLM planner (the differentiator).** A `llama.cpp` sidecar (reusing
  the `whisper.cpp` IPC pattern) with grammar-constrained decoding produces a
  validated `EditCommand` plan from natural language, dry-run + approve + commit —
  100% local, no cloud.
- **Phase 4 — MCP server + OTIO + multitrack.** Expose the command registry as an MCP
  server for external agents (Claude Desktop / Cursor), generalize to multitrack /
  multi-source (B-roll, PIP, music), and add OTIO export for Premiere/Resolve/FCP
  interop.

---

## Quickstart

Requires **Node ≥ 20**, **pnpm 10**, and (for transcription) **cmake** + **FFmpeg**.

```bash
pnpm install            # install workspace deps

pnpm verify             # lint + core boundary check + build + unit + E2E
                        # (whisper-dependent steps self-skip; integration runs when fixtures present)

pnpm setup:binaries     # build whisper.cpp + download the model (needs cmake + ffmpeg)
                        # default model: large-v3-turbo (~1.6GB);
                        # lighter setup: DAWN_WHISPER_MODEL=base pnpm setup:binaries

pnpm make:fixture       # generate a deterministic test video (uses macOS `say`)
```

Other useful scripts: `pnpm test:unit`, `pnpm test:int`, `pnpm test:e2e`,
`pnpm demo:assets && pnpm demo:run && pnpm demo:ui` (full real-media demo).

---

## Architecture

Three layers, with a strict portability boundary at the core:

```
UI / shell  ──►  editing core  ──►  AI / render sidecars
(Electron, React)  (pure TS)         (Node subprocess wrappers)
```

- **`packages/core`** — portable, pure-TypeScript editing core: transcript /
  timeline / sync / commands / EDL / subtitles / overlays / chapters. No Node, no
  Electron (enforced). This is what a future agent will drive.
- **`packages/ui`** — React UI + Zustand store (`@dawn-cut/ui`).
- **`apps/desktop`** — Electron shell (`@dawn-cut/desktop`).
- **`sidecar/stt`** — `whisper.cpp` subprocess wrapper, word-level timestamps (MIT).
- **`sidecar/ffmpeg`** — FFmpeg / ffprobe subprocess wrapper (LGPL, subprocess only).
- **`sidecar/tts`** — text-to-speech (macOS `say` offline by default; Piper opt-in).

The **EDL** is the deterministic IR that separates *editing* from *exporting*: the
core produces it, the FFmpeg sidecar consumes it, so the same edit always renders the
same output. Full design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the PoC
docs under [`docs/poc/`](docs/poc/README.md).

### Verification-driven

Every milestone gate is backed by an automated test. `pnpm verify` exiting `0` is the
necessary condition for "done." See [`docs/poc/03-TEST-GATES.md`](docs/poc/03-TEST-GATES.md).

---

## License

**MIT** — see [LICENSE](LICENSE) and [NOTICE](NOTICE). The core stays free and local,
forever.
