# dawn-cut

> Open-source AI video editor — edit video like a document.
> **Auto subtitles · text-based cutting · auto silence removal.**
> No subscriptions, no watermarks, no account. Everything runs locally.

An open-source take on the Vrew/CapCut experience, built Mac-first (Electron),
with a portable pure-TypeScript editing core designed to extend to Windows and mobile.

> Status: **PoC (Proof of Concept)** — proving the core wedge (text-based editing)
> before building out. See [`docs/poc/README.md`](docs/poc/README.md).

## Why
[OpenCut](https://github.com/OpenCut-app/OpenCut) already owns "open-source CapCut"
(general timeline editor). dawn-cut targets the gap OpenCut leaves: **AI subtitle +
text-based editing + auto silence removal**, with a real native desktop experience.

## Architecture
- 3-layer: UI/shell (Electron) → portable editing core (pure TS) → AI/render sidecars.
- STT: [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT, local).
- Encode/analyze: FFmpeg (LGPL, subprocess only).
- Full design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Develop
```bash
pnpm install
pnpm verify            # lint + boundary + build + unit (+ integration if binaries ready)
pnpm setup:binaries    # build whisper.cpp + download model (needs cmake)
pnpm make:fixture      # generate deterministic test video (macOS `say`)
```

## Verification-driven
Every milestone gate (G0–G8) is backed by an automated test.
`pnpm verify` exit code 0 is the necessary condition for "done".
See [`docs/poc/03-TEST-GATES.md`](docs/poc/03-TEST-GATES.md).

## License
MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
