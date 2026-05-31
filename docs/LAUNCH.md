# dawn-cut 런치 플레이북 (LAUNCH) / Launch Playbook

> 이 문서는 [`docs/MARKETING.md`](MARKETING.md)와 [`docs/STRATEGY.md`](STRATEGY.md)를
> **실행 가능한 게시물 초안**으로 옮긴 OSS 그로스 런치 문서다.
> This is the executable companion to `MARKETING.md`/`STRATEGY.md`: real, copy-pasteable
> post drafts, list-submission blurbs, the hero GIF spec, and the metrics dashboard.

> **진실성 규칙 (NON-NEGOTIABLE) / Truth rule.**
> 모든 게시물은 **오늘 실제로 동작하는 기능에만** 근거한다. 자연어/AI 편집은 항상
> **roadmap**으로 표기한다. HN·긱뉴스에서 솔직함은 신뢰 자산이다(STRATEGY §8, MARKETING §9).
> Every post is grounded in what ships **today**. Natural-language / AI editing is always
> labeled **roadmap**. Honesty about PoC status is a trust asset, never an apology.

---

## 0. 오늘 실제로 동작하는 것 (런치 클레임의 단일 진실원천) / Ground truth: what ships today

이 목록 밖의 것은 게시물에 "현재 기능"으로 쓰지 않는다. (출처: `README.md` "What works today",
`packages/core/src`, `demo-output/`.) Anything outside this list is **not** claimed as a current
feature — it is roadmap.

**Ships today (claimable):**
- 단어 단위 전사 — `whisper.cpp` 로컬, 한국어 어절 무손실 재조립 (`whisper.ts`).
- 텍스트 기반 편집 — 단어 범위 삭제 → 해당 영상 컷 + gapless ripple (`deleteWordRange`, `cutSourceRange`).
- 자동 무음 제거 (`removeSilences`), 한국어 필러 감지 (`detectFillers`).
- 자동 자막 큐 + **SRT** export, 키워드 강조 자막 래스터(canvas, libass 없음) (`subtitles.ts`, `draw.ts`, `keywords.ts`).
- 자동 챕터 (YouTube `M:SS` 목록), 용어집 치환 (`chapters.ts`, `glossary.ts`).
- 이미지/스티커/GIF 오버레이 + 키프레임 모션 → ffmpeg 합성 (`overlay.ts`, `renderEdl`).
- **결정적 EDL** export + 불변식 검증 (`timelineToEdl`, `validateEdl`/`validateSync`/`validateCues`).
- **직렬화 가능한 EditCommand 버스** — `applyCommand(state, cmd)` 단일 디스패처, verb별 Zod 스키마,
  `z.toJSONSchema()` 매니페스트 (`edit-command.ts`). **사람 UI가 이 버스를 구동한다.**
- 프로젝트 저장/열기(`.dawn`), undo/redo (`project.ts`, `history.ts`).
- Electron 데스크톱 앱 (import → transcribe → text-edit → preview → export).
- `demo-output/`에 실제 whisper+ffmpeg 엔드투엔드 산출물(23.6s → 17.3s, soft 자막 트랙 + SRT + `.dawn`).

**Roadmap only (NEVER claim as current; always say "coming"/"vision"):**
- 자연어 → 편집 (LLM 플래너, llama.cpp sidecar) — Phase 3.
- dry-run/diff/commit UI, audit log — Phase 2.
- 펀치인 줌 / 색보정 실제 렌더 — Phase 2 (현재 프리뷰 배지 스텁).
- MCP 서버, OTIO, 멀티트랙 — Phase 4.

> **핵심 프레이밍 / Master framing.** "AI가 제안 → 당신이 EDL/타임라인 확인 → 승인 → 렌더."
> 단, NL 제안 레이어는 아직 없다 — 오늘의 클레임은 **"결정적·검증가능한 편집 코어(버스+EDL)를 이미
> 갖췄다"**까지다. *"The deterministic, command-driven, verifiable edit core is real; the
> natural-language layer that drives it is the roadmap."*

---

## 1. 런치 시퀀스 체크리스트 / Launch sequence checklist

원칙: **지금(PoC) 시작한다.** OpenCut·Onlook 모두 버그 있는 초기에 런칭했다. 모멘텀(스타차트) > 완벽.
순서는 저비용·고복리부터(Awesome 등재) → 한국 비치헤드 → 글로벌 스타부스트 → 2차 샤프닝 → PH 본런치.

### T-14d → T-0: 토대 (Phase 0) — *런치 게이트, 전부 체크돼야 발사*
- [ ] **README가 랜딩페이지인가** — 첫 화면에 가치제안 1줄 + 히어로 GIF(§4) + 배지행. (현재 README는 GIF 플레이스홀더 — 실파일 교체 필수.)
- [ ] **히어로 GIF/클립 한·영 2종** 제작, `assets/hero.gif`로 커밋(README가 이 경로를 참조).
- [ ] **PoC 상태 1줄 명시** 유지(README 상단 status 박스). 숨기지 않는다.
- [ ] **NL 편집은 README Roadmap에만** — "What works today"에서 분리 확인.
- [ ] **GitHub repo public + 토픽 태그**: `video-editor` `whisper` `ffmpeg` `local-first` `electron` `subtitles` `korean` `transcription` `open-source` `privacy`.
- [ ] **LICENSE(MIT) + NOTICE** 노출, `star-history` 배지 추가.
- [ ] **`pnpm verify`가 클린**(런치 전 CI green) — 솔직함의 근거.
- [ ] **Awesome 리스트 PR 3건 제출**(§3) — 머지에 시간 걸리므로 가장 먼저.
- [ ] **이슈 템플릿 + CONTRIBUTING + "good first issue" 3~5개** — HN/긱뉴스 유입 기여자 받을 준비.
- [ ] **X(빌드인퍼블릭) 계정** 활성화, 첫 데모 클립 1개 예약.
- [ ] **연락 채널**(GitHub Discussions 또는 이슈) 열고 README에 링크.

### T-0 단계 1 — 소프트 런치 (한국 비치헤드)
- [ ] **긱뉴스 GeekNews "Show" 글 1건**(§2.4) — 한국판 Show HN.
- [ ] **한국 유튜브 워크스루**(5~8분, 도그푸딩 메타 명시) 공개.
- [ ] 한국 커뮤니티 오가닉 공유(아카라이브 영상편집/유튜버, 클리앙) — 스팸 금지, 진성.
- [ ] 첫 24~72h: **모든 댓글에 저자 직접 응답**, 어떤 메시지가 스타를 끄는지 기록.

### T+3~7d 단계 2 — 스타부스트 (글로벌 1차)
- [ ] **Show HN 게시**(§2.1) — 화요일~목요일 미 동부 오전(8–10am ET) 권장. repo 링크, 이미지, 저자 상주.
  - [ ] **업보트 요청/링크 외부 공유 절대 금지**(HN 링 탐지). 직접 트래픽 유도 안 함.
- [ ] **Reddit r/selfhosted + r/opensource**(§2.5–2.6) — 10% 룰, 서브 규칙 사전 확인.
- [ ] **X 빌드인퍼블릭 클립** 푸시 시작(§4 마이크로 클립).
- [ ] 목표: 초기 스타차트 스파이크로 모멘텀 시드.

### T+6~8주 단계 3 — 2차 패스 (메시지 샤프닝)
- [ ] 1차에서 가장 반응 좋았던 메시지("local-first" / "no-cloud" / "edit by text")로 **제목 다듬어 HN/Reddit 2차**.
  (Onlook 사례: 2차 HN "local-first" 제목 +1,000 스타.)
- [ ] r/LocalLLaMA, r/VideoEditing/r/podcasting(Descript 난민 앵글) 확장.

### 단계 4 — 본 런치 (Product Hunt)
- [ ] **온보딩 매끄러워지고 폴리시된 데모 준비된 뒤에만.** PH는 완성도 채널.
- [ ] (이상적 트리거: Phase 3 자연어 편집 MVP 공개 = 최강 PH 타이밍.)
- [ ] 헌터 섭외 + 런칭일 X 동시 푸시.

### 상시 가드레일
- [ ] "완전 자율 AI 편집"·"AI가 알아서 다 편집" 카피 **금지**. 항상 "제안→확인→승인→렌더", 그리고 NL은 roadmap.
- [ ] "open-source CapCut" 문구 **금지**(OpenCut 소유). "local-first AI editor that edits by text" 소유.
- [ ] 텔레메트리 도입 **금지** — 측정은 공개 신호만(§5).

---

## 2. 채널별 게시물 실제 초안 / Ready-to-post drafts

> 게시 전 치환: `<REPO_URL>` = GitHub 주소(예 `https://github.com/<org>/dawn-cut`),
> `<GIF_URL>`, `<YT_URL>`. 아직 git remote 없음 — 런치 게이트에서 확정.

### 2.1 Show HN — 제목 + 본문 (English)

**Title (pick one, ≤80 chars, no marketing fluff):**
```
Show HN: dawn-cut – local video editor, edit by text, whisper.cpp + ffmpeg, no cloud
```
대안 / alternates:
```
Show HN: dawn-cut – edit video like a document, 100% on your machine, MIT
Show HN: dawn-cut – open-source video editor with a deterministic, testable edit core
```

**URL field:** `<REPO_URL>` (the repo — NOT a marketing site).

**First comment (post immediately as the author, this is where HN reads):**
```
Hi HN, I'm building dawn-cut, an open-source (MIT) desktop video editor whose
goal is simple: your footage never leaves your machine, and you edit by text
instead of by dragging clips.

What works today (this is a PoC, and I want to be upfront about that):

- Word-level transcription with whisper.cpp, fully local. Korean *eojeol*
  (word+particle) are reconstructed losslessly from whisper tokens.
- Text-based editing: delete a word range in the transcript and the matching
  footage is cut and rippled gaplessly.
- Automatic silence removal and a conservative Korean filler lexicon.
- Auto subtitles (with keyword emphasis) exported to SRT, auto chapters,
  glossary substitution, and image/sticker/GIF overlays with keyframe motion.
- The interesting part for this crowd: the editing core is pure TypeScript
  (it's forbidden from importing electron/fs/child_process, enforced by
  dependency-cruiser). Time is integer microseconds with half-open [start,end)
  intervals. Every edit is a serializable EditCommand applied by a single
  applyCommand() reducer, each verb backed by one Zod schema that also derives
  a JSON-Schema manifest. The timeline compiles to a deterministic EDL that the
  ffmpeg sidecar renders, and invariant validators prove the transcript↔timeline
  roundtrip, the EDL contiguity, and subtitle ordering after every command. So
  edits are undoable, replayable, and auto-checkable rather than opaque.

There's a reproducible end-to-end run under demo-output/ (real whisper.cpp +
ffmpeg): a 23.6s clip transcribed, text-edited and silence-trimmed to 17.3s,
exported with a toggleable soft subtitle track + SRT + a reusable .dawn project.

Why I'm building it: the popular "AI video editors" make you choose between
privacy and assistance — cloud tools take your footage, local tools can't think.
I want a local-first editor with a deterministic, verifiable core that a machine
*could* eventually drive.

That last part is the roadmap, not today: a local LLM planner (llama.cpp,
grammar-constrained) that turns "cut the dead air and caption the key points"
into validated EditCommands you dry-run and approve before render — plus an MCP
server so external agents can drive it. 0% of that NL layer is built yet. The
core it would stand on is what's real now.

Repo + architecture notes: <REPO_URL>
Happy to answer anything about the EDL design, the Korean eojeol reconstruction,
or why I went canvas-raster for subtitles (no libass dependency).
```
> 톤 가이드: 기술 디테일로 리드(EDL·µs·Zod·어절), PoC 솔직히 인정, NL은 명시적으로 "roadmap, not today".
> 절대 영업 어조 금지. 모든 댓글에 24h 상주.

### 2.2 Product Hunt — *단계 4 전용(온보딩/데모 폴리시 후)*

**Name:** dawn-cut
**Tagline (≤60 chars):**
```
Open-source video editor — edit by text, never uploads
```
**Description:**
```
dawn-cut is a free, open-source (MIT) desktop video editor where your footage
never leaves your machine. Transcribe locally with whisper.cpp, then edit like
a document: delete a sentence and the footage is cut. Auto silence removal,
keyword-emphasis subtitles to SRT, auto chapters, and image/sticker/GIF
overlays — all rendered by a local ffmpeg pipeline. No account, no watermark,
no subscription, no cloud.

Under the hood: a deterministic, fully testable edit core. Every edit is a
serializable command applied by one reducer, validated against invariants, and
compiled to an Export Decision List so the same edit always renders the same
output.

Roadmap (in the open): a 100%-local LLM planner that proposes edits from plain
language — you review the timeline/EDL and approve before render — and an MCP
server so external agents can drive the editor. The deterministic core that
makes that safe is already here.
```
**First comment (maker):** Show HN 본문 축약 + "what's real today vs roadmap" 표 링크 + 도그푸딩 메타("이 데모는 dawn-cut으로 편집").
**Topics:** Video, Open Source, Privacy, Design Tools, Artificial Intelligence (단, AI는 roadmap임을 description에 명시).

### 2.3 GeekNews 긱뉴스 "Show" (한국어) — 한국 1차 비치헤드

**제목 (택1):**
```
dawn-cut – 로컬에서 도는 오픈소스 비디오 에디터 (whisper.cpp 자동자막, 무제한·무료, MIT)
```
대안:
```
dawn-cut – 영상을 문서처럼 편집, 데이터는 내 PC 밖으로 안 나감 (whisper.cpp + ffmpeg, MIT)
dawn-cut – Vrew급 한국어 자동자막을 로컬·무제한·무료·오픈소스로
```

**본문:**
```
안녕하세요. 오픈소스(MIT) 데스크톱 비디오 에디터 dawn-cut을 만들고 있습니다.
목표는 두 가지입니다 — (1) 영상이 내 노트북을 한 바이트도 떠나지 않는다,
(2) 드래그가 아니라 '텍스트로' 편집한다.

지금 실제로 되는 것 (솔직히 아직 PoC 단계입니다):

- whisper.cpp 로컬 단어 단위 전사. 한국어는 어절(단어+조사)을 whisper 토큰에서
  무손실로 재조립합니다. 클라우드에 안 올립니다.
- 텍스트 기반 편집: 전사에서 단어 구간을 지우면 해당 영상이 잘리고 gapless로
  당겨집니다.
- 자동 무음 제거 + 한국어 필러(어, 음 등) 감지(보수적 정확매칭).
- 자동 자막(키워드 강조) → SRT export, 자동 챕터, 용어집 치환, 이미지/스티커/GIF
  오버레이(키프레임 모션 포함, ffmpeg로 합성).
- 엔지니어링 디테일: 편집 코어는 순수 TypeScript이고 electron/fs/child_process를
  import하지 못하게 dependency-cruiser로 강제합니다. 시간은 정수 마이크로초,
  [start,end) 반열린 구간. 모든 편집이 직렬화 가능한 EditCommand이고, 단일
  applyCommand() 리듀서가 적용합니다. verb마다 Zod 스키마 1개가 타입·런타임 검증·
  JSON-Schema 매니페스트를 한 소스에서 만듭니다. 타임라인은 결정적 EDL로 컴파일되어
  ffmpeg sidecar가 렌더하고, 적용 직후 불변식 검증으로 전사↔타임라인 일치, EDL
  연속성, 자막 정렬을 확인합니다. 그래서 편집이 되돌리기·재현·자동검증 가능합니다.

demo-output/ 에 실제 whisper+ffmpeg 엔드투엔드 결과가 들어 있습니다(23.6초 →
무음/텍스트 편집 후 17.3초, 토글 가능한 soft 자막 트랙 + SRT + .dawn 프로젝트).

왜 만드나: 인기 있는 'AI 비디오 에디터'들은 프라이버시 아니면 AI 지원 중 하나만
줍니다. 클라우드 도구는 내 영상을 가져가고, 로컬 도구는 '생각'을 못 합니다. 저는
결정적이고 검증 가능한 코어 위에, 언젠가 기계가 구동할 수 있는 로컬 퍼스트
에디터를 원합니다.

그 마지막 부분은 오늘이 아니라 로드맵입니다: "죽은 시간 자르고 핵심에 자막 달아줘"
같은 한국어 한 문장을 검증된 EditCommand로 바꿔주는 로컬 LLM 플래너(llama.cpp,
문법 제약 디코딩)와, 외부 에이전트가 구동하는 MCP 서버 — 이건 아직 0% 구현입니다.
지금 실재하는 건 그 위에 설 결정적 편집 코어입니다.

repo + 아키텍처 노트: <REPO_URL>
EDL 설계, 한국어 어절 재조립, libass 없이 canvas로 자막 래스터화한 이유 등 무엇이든
답하겠습니다.
```
> 긱뉴스 군중은 기술 디테일 환영. 리드 후크는 "Vrew급 자동자막인데 로컬·무제한·무료",
> 보조는 CapCut 약관 해독제. NL은 명시적으로 roadmap.

### 2.4 Reddit r/selfhosted (English)

**Title:**
```
dawn-cut: a local-first, open-source video editor — your footage never uploads (whisper.cpp + ffmpeg, MIT)
```
**Body:**
```
I've been building dawn-cut, an MIT-licensed desktop video editor for people who
don't want their footage on someone else's GPU. Everything runs on your machine:
zero telemetry, no account, no watermark, no subscription, nothing uploaded.

What works today (it's an early PoC, being honest):
- Local word-level transcription via whisper.cpp (Korean supported, eojeol-aware).
- Edit by text: delete words in the transcript → the footage is cut + rippled.
- Automatic silence removal, filler detection.
- Auto subtitles (keyword emphasis) → SRT, auto chapters, glossary, and
  image/sticker/GIF overlays, all composited by a local ffmpeg pipeline.
- Project save/open (.dawn) with undo/redo.

The thing I'm proud of for a self-hosting crowd: the edit core is pure,
deterministic TypeScript with an EDL (export decision list) as the IR, so the
same edit always renders the same output, and invariants are checked after every
command. No cloud round-trips anywhere in the editing path.

Roadmap (not built yet, flagging it honestly): a 100%-local LLM planner
(llama.cpp) that proposes edits from natural language for you to review and
approve, plus an MCP server. Today it's all manual/text-based.

Repo: <REPO_URL>
Would love feedback from folks who run things locally — especially on packaging
and the whisper model footprint.
```
> 10% 룰 준수: 이 서브에서 평소 진성 참여 후 게시. 규칙(self-promo 빈도) 사전 확인.

### 2.5 Reddit r/opensource (English)

**Title:**
```
dawn-cut — MIT-licensed video editor with a deterministic, fully tested edit core (build-in-public)
```
**Body:**
```
Sharing an open-source (MIT) project I'm building in public: dawn-cut, a
local-first desktop video editor. It edits video like a document — delete a
sentence in the transcript, the footage disappears — and nothing leaves your
machine.

For the OSS-engineering crowd, the part I think is interesting:
- The editing core is pure TypeScript, structurally forbidden from importing
  electron/fs/child_process (enforced by dependency-cruiser).
- Time is integer microseconds, half-open [start,end) intervals — no float drift.
- Every edit is a serializable EditCommand applied by one applyCommand() reducer;
  each verb is backed by a single Zod schema that produces the TS type, the
  runtime guard, and a JSON-Schema manifest from one source of truth.
- The timeline compiles to a deterministic EDL; invariant validators run after
  every command (transcript↔timeline sync, EDL contiguity, subtitle ordering).
- Unit + property tests gate every milestone (`pnpm verify`).

Working today: local whisper.cpp transcription (incl. Korean), text-based cutting,
silence removal, SRT subtitles + keyword emphasis, chapters, overlays, save/open.

Roadmap, openly flagged: a local LLM planner that turns plain language into those
validated commands (you approve the diff before render) and an MCP server for
external agents. None of the NL layer is built yet — the deterministic core it
needs is.

Repo + design docs: <REPO_URL>
Contributors welcome — there are "good first issue" tickets. Feedback on the
command-bus design especially appreciated.
```

### 2.6 한국 커뮤니티 (아카라이브 영상편집/유튜버, 클리앙) — 오가닉 공유

> 톤: 영업 아님, "이런 거 만들었는데 써보실 분" 진성 공유. 1인 채널주 페인(자막 시간) 직격.
```
제목: 자막 작업 시간 줄이려고 만든 오픈소스 로컬 비디오 에디터 (무료, 데이터 안 올라감)

자막 다는 데 영상당 1~2시간 쓰는 게 아까워서 dawn-cut이라는 오픈소스 에디터를
만들고 있습니다. 전부 내 PC에서 돌고(whisper.cpp), 클라우드에 안 올라가고, 구독·
워터마크·계정 전부 없습니다.

- 자동 자막(한국어 어절 단위) → 자막 위에서 글자 지우면 그 부분 영상이 잘립니다.
- 자동 무음 제거, 필러('어','음') 감지.
- 키워드 강조 자막, 자동 챕터, 스티커/GIF 오버레이.
- 결과물 + SRT + 프로젝트 파일로 저장.

아직 초기(PoC)라 거칠지만, 자막/무음컷 워크플로는 실제로 됩니다. '한국어로 말하면
AI가 알아서 편집'은 다음 단계 로드맵이고 아직 없습니다 — 지금은 직접 텍스트로
편집하는 단계입니다.

데모/코드: <REPO_URL>
한국어 자막 품질이나 써보고 불편한 점 알려주시면 반영하겠습니다.
```

### 2.7 X / Twitter — 런치 스레드 (빌드인퍼블릭)

```
1/ dawn-cut: an open-source video editor where your footage never leaves your
machine. Edit video like a document — delete a sentence, the clip vanishes.
100% local. No account, no watermark, no subscription. MIT. 🧵 <GIF_URL>

2/ Transcription runs locally with whisper.cpp (Korean eojeol reconstructed
losslessly). Auto silence removal, keyword-emphasis subtitles → SRT, chapters,
overlays. Nothing uploaded, ever.

3/ The part I care about: a deterministic, testable edit core. Integer-µs time,
serializable EditCommands, one Zod schema per verb, an EDL as the IR — so the
same edit always renders the same output and is auto-verifiable.

4/ Roadmap, in the open: a 100%-local LLM planner that proposes edits from plain
language — you review the timeline/EDL, then render — plus an MCP server. Not
built yet. The core that makes it safe is.

5/ It's an early PoC and I'm building in public. (This clip was edited in
dawn-cut itself.) Repo + docs: <REPO_URL>
```

---

## 3. 리스트 등재 문구 / List-submission blurbs

> 각 리스트의 카테고리/포맷 규칙을 PR 전 확인. URL/배지는 해당 리스트 컨벤션에 맞춤.

### 3.1 awesome-selfhosted (Software › Media Streaming / Video, 또는 Note-taking 인접)
```
- [dawn-cut](<REPO_URL>) - Local-first desktop video editor. Word-level
  transcription (whisper.cpp), text-based cutting, automatic silence removal,
  keyword-emphasis subtitles (SRT), and image/sticker overlays — 100% on your
  machine, no account, no telemetry. ([Demo](<REPO_URL>#demo)) `MIT` `Electron`
```
> 규칙: 한 줄 설명, 알파벳순 위치, 라이선스/언어 태그, demo/source 링크. self-hosted 적합성
> 근거 = "로컬에서 도는 데스크톱 앱, 데이터 미전송".

### 3.2 awesome-video (Editing / Tools 카테고리)
```
- [dawn-cut](<REPO_URL>) - Open-source (MIT) local video editor: word-level
  whisper.cpp transcription, text-based editing, silence removal, keyword-emphasis
  subtitles, deterministic EDL export rendered by ffmpeg.
```

### 3.3 awesome / OSS-alternatives (e.g. awesome-oss-alternatives, "open-source alternatives" lists)
```
- **dawn-cut** — open-source, local-first alternative to CapCut / Descript /
  Vrew for transcript-based video editing. Word-level local transcription
  (whisper.cpp, incl. Korean), edit-by-text, auto silence removal, subtitles to
  SRT. No cloud, no account, no watermark, no subscription. `MIT`
```
> "open-source CapCut" 단독 표현은 OpenCut 소유 → "open-source, local-first alternative to
> CapCut / Descript / Vrew"로 복수 비교군 사용(STRATEGY §8 가드레일).

### 3.4 기타 후보 (저비용 복리)
- `awesome-whisper` (whisper.cpp 활용 앱) — "Desktop video editor using whisper.cpp for word-level, Korean-aware transcription."
- `awesome-electron` (앱 섹션) — "Local-first video editor; pure-TS deterministic edit core."
- `awesome-privacy` / `awesome-localllama`(있다면) — "Zero-telemetry video editor; transcription stays local."
- `awesome-korean` / 한국어 OSS 목록 — 한국어 어절 재조립 STT 강조.

---

## 4. 히어로 GIF 컨셉 / Hero GIF spec

> 목적: README 첫 화면·X·긱뉴스·PH에서 재사용하는 **단일 30초 이하 와우 자산**. dawn-cut으로 직접 제작(도그푸딩).
> 제약: 오늘 실재하는 기능만 등장 — **NL 프롬프트 입력 장면은 넣지 않는다**(roadmap이므로). 텍스트편집·무음컷·키워드강조자막만으로 와우를 만든다.

**스토리보드 (≤30s, 무음 자동재생 가정 → 텍스트 오버레이로 설명):**
1. **0–4s** — 러프 화면녹화 원본 재생, 좌상단 라벨 "raw recording · 0:23". (말이 늘어지는 구간이 보이게.)
2. **4–10s** — 전사 패널 등장, 어절 단어 단위로 채워짐. 오버레이 텍스트: "transcribed locally — whisper.cpp, nothing uploaded".
3. **10–16s** — 전사에서 문장 한 줄을 드래그 선택 → Delete. 타임라인이 즉시 당겨짐(gapless ripple). 오버레이: "delete a sentence → the footage is cut".
4. **16–22s** — "Remove silences" 한 번 클릭 → 무음 구간들이 타임라인에서 사라지고 길이 0:23 → 0:17로 줄어드는 카운터 애니메이션. 오버레이: "auto silence removal".
5. **22–28s** — 결과 프리뷰에 **키워드 강조 자막**이 올라간 화면, 핵심 단어가 색/굵기로 강조. 오버레이: "keyword-emphasis subtitles · export SRT".
6. **28–30s** — 잠금 프레임: 로고 + "100% local · no account · no watermark · MIT" + repo URL.

**변형:**
- **영문 자막 버전**(글로벌 README/HN/PH/X). 오버레이 텍스트 영어.
- **한국어 내레이션 버전**(1차 타겟 P1용, 긱뉴스/한국 유튜브). 자막·오버레이 한국어, "데이터는 내 PC 밖으로 안 나갑니다".
- **before/after 분할 정지컷**(소셜 썸네일): 좌 "raw 0:23 / 늘어진 말", 우 "tight 0:17 / captioned".

**제작 메타(모든 채널에서 반복):** "이 GIF는 dawn-cut으로 직접 편집했습니다 / Edited in dawn-cut itself."

**산출 사양:** 폭 ≤ 1200px, 12–15fps, 루프, < 8MB(README 로딩). 소스 클립은 `demo-output/`의 실제 산출물 재사용 가능(ui-*.png, edited.mp4가 이미 존재).

**마이크로 클립 시리즈(X, 기능당 1개):**
- "delete a sentence, the clip vanishes" (텍스트편집).
- 무음 일괄 제거 before/after.
- 키워드강조자막 프리셋.
- (Phase 2 이후) 펀치인 줌 / 색보정 — *기능 실재 후에만 제작*.
- (Phase 3 이후) 자연어 프롬프트 → 제안 EDL diff — *NL 레이어 실재 후에만, 그 전까지 제작 금지*.

---

## 5. 지표 / Metrics

> 측정조차 프라이버시 약속을 안 깬다 — **제품 내 텔레메트리 금지, 공개 신호만**(MARKETING §8, STRATEGY §7).

### North Star
- **장기 진짜 채택:** 주간 활성 export 사용자수(영상을 끝까지 만든 사람).
- **PoC 초기 프록시:** **GitHub stars**(모멘텀 신호) — 측정 인프라 부담 0, 프라이버시 일관.

### 깔때기별 지표 (런치 추적 대시보드)
| 단계 | 지표 (공개 신호) | 초기 목표 / 판단 기준 |
|---|---|---|
| 인지 | GitHub stars, X 임프레션, HN/긱뉴스 프론트 도달, Reddit 업보트 | 1차 런치 스파이크로 스타차트 시드 |
| 관심 | GitHub traffic insights(repo views/uniques), README GIF 클릭, 채널 클릭스루 | 런치당 트래픽 스파이크 측정 |
| 시도 | release 다운로드 수, clone 수, 첫 실행 이슈/질문 유입 | 다운로드 추이 우상향 |
| 전환 | (프록시) "내가 만든 결과물" 멘션·이슈, demo 재현 보고 | 초기엔 정성 신호 수집 |
| 유지 | 재방문, 기여자 수, 이슈/PR 처리 | 90+ 기여자(OpenCut 벤치) 장기 |
| 입소문 | Awesome 리스트 등재 수, 외부 멘션, 사용자 데모 리포스트 | 등재 3건+ → 점증 |

### 런치별 A/B 기록 (필수)
각 런치(긱뉴스/HN/Reddit/2차)마다 **사용한 제목·리드 메시지 변형**과 그 후 24–72h 스타 증가를 표로 기록.
다음 패스에서 승자 메시지("local-first" vs "no-cloud" vs "edit by text")에 올인.

| 런치 | 채널 | 사용한 제목/리드 | 게시 후 72h Δ stars | 메모 |
|---|---|---|---|---|
| L1 | 긱뉴스 | (기입) | | |
| L2 | Show HN | (기입) | | |
| L3 | Reddit | (기입) | | |
| L4 | HN 2차 | (기입) | | |

### 측정 원칙
- 공개 신호 위주(GitHub stars/traffic, release 다운로드 카운트, 채널 임프레션).
- 제품 내 지표가 꼭 필요하면 **명시적 opt-in + 로컬 집계만** — 프라이버시 약속을 깨면 메시지 신뢰가 붕괴(STRATEGY §8 리스크).
- "메시지 변형 → 스타 증가" 상관을 런치마다 누적해 카피를 진화시킨다.

---

## 부록 — 카피 뱅크 (바로 사용) / Copy bank

**헤더 / Headers**
- EN: "Your video never leaves your machine. Edit it like a document."
- KO: "영상이 내 노트북을 떠나지 않습니다. 문서처럼 편집하세요."

**서브 / Sub**
- EN: "Delete a sentence — the clip vanishes. 100% local. No account, no watermark, no subscription."
- KO: "문장을 지우면 그 장면이 사라집니다. 100% 로컬, 무계정·무워터마크·무구독."

**배지 / Badges:** `100% local` · `no account` · `no watermark` · `no subscription` · `MIT`

**투명성(에이전트 비전, 항상 roadmap 명시) / Transparency line:**
- EN: "Roadmap: the AI proposes the edit, you review the EDL/timeline, then render — all local. The verifiable core is already here."
- KO: "로드맵: AI가 편집을 제안하면 EDL/타임라인을 확인하고 렌더합니다 — 전부 로컬. 검증 가능한 코어는 이미 있습니다."

**도그푸딩 메타 / Dogfooding tag:** "Edited in dawn-cut itself. / 이 영상은 dawn-cut으로 편집했습니다."
