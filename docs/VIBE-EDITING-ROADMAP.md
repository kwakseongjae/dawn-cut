# 바이브 영상 편집 고도화 계획 — Palmier Pro 등장 이후 (2026-07)

> 트리거: "바이브 편집을 CapCut 수준 UX/UI와 함께 제공하려면?" + Palmier Pro 레퍼런스 분석 요청.
> 실사 기준: v0.1.10 (커밋 a455b6c), UI/에셋 축 + 엔진 축 병렬 정밀 인벤토리.

---

## 0. 한 줄 결론

**dawn-cut의 바이브 '엔진'(명령 버스·dry-run·감사)은 경쟁자보다 앞서 있으나, 바이브 '표면'(채팅 UI·라이브 브리지·동사 어휘)과 NLE '기본기'(타임라인 조작·전환·배속·멀티트랙 체감)가 부재하다.** 엔진의 신뢰 구조를 유지한 채 표면과 기본기를 채우는 것이 이번 고도화의 본질이다.

---

## 1. 레퍼런스: Palmier Pro — 시장이 바뀌었다

| 항목 | 내용 |
|---|---|
| 정체 | "The video editor built for AI" — YC S24, **2026-06 중순 출시, 3주 만에 ⭐10.2k** |
| 스택 | **Swift 네이티브 + Metal GPU**, macOS 26(Tahoe)/Apple Silicon 전용 |
| 라이선스 | **GPL-3.0** → 코드 차용 절대 금지(우리는 MIT). UX 개념만 참고 |
| 편집 | 멀티트랙 타임라인, 트림/분할/재정렬, 스피드 조정, 멀티캠 |
| 생성 | **타임라인 위에서 AI 생성**(Seedance/Kling/Nano Banana Pro/Veo/Grok) — 클립별 프롬프트·모델·레퍼런스 추적, 재생성/변형. 크레딧 과금(= 수익모델) |
| 에이전트 | **앱 내 채팅 에이전트** + 외부 MCP(`http://127.0.0.1:19789/mcp`, Claude/Cursor/Codex) |
| 내보내기 | MP4(H.264/H.265/ProRes) + **NLE XML(Premiere/Resolve 상호운용)** |

### Palmier의 에이전트 도구 어휘 (소스 실측, ~49개)

`Sources/PalmierPro/Agent/Tools/ToolDefinitions.swift`에서 직접 추출:

- **프로젝트/타임라인**: getProjects, open/new/closeProject, getTimeline, inspectTimeline, createTimeline, setActiveTimeline, setProjectSettings, exportProject
- **미디어**: getMedia, inspectMedia, searchMedia, importMedia, organizeMedia
- **클립 조작**: addClips, insertClips, moveClips, removeClips, manageTracks, splitClips, rippleDeleteRanges, setClipProperties, **setKeyframes**, applyLayout, syncClips
- **멀티캠**: manageMulticam, changeCam, getMulticam
- **전사 기반**(⚠ 우리 웨지 침범): getTranscript, **removeWords, removeSilence**, detectBeats
- **텍스트/자막**: addTexts, updateText, addCaptions
- **색/이펙트/오디오**: applyColor, inspectColor, applyEffect, denoiseAudio
- **생성형**: listModels, generateVideo/Image/Audio, upscaleMedia
- **기타**: undo, sendFeedback, **readSkill**(에이전트 스킬 개념)

### 우리에게 주는 함의

1. **"에이전트가 조작하는 에디터" 카테고리가 검증됐다** — 3주 ⭐10.2k. 우리 방향이 맞았고, 이제 속도 싸움.
2. **전사 기반 편집(removeWords/removeSilence)까지 이미 들어감** — "Vrew 영역 + 에이전트"만으로는 차별화 수명이 짧다.
3. **Palmier의 빈틈** = 우리의 모트: ① 승인 흐름 부재(툴이 바로 상태 변경, undo뿐) — 우리는 dry-run→diff→명령별 토글→승인→해시체인 감사. Digital Trends도 "AI에게 편집 결정을 맡기는 신뢰"를 핵심 우려로 지목. ② GPL-3.0(기업 임베드 어려움) vs 우리 MIT. ③ macOS 26 전용(구형 Mac 배제). ④ 생성 크레딧 = 클라우드 종속 vs 우리 로컬+BYOK. ⑤ 한국어 특화 없음.
4. **테이블 스테이크 확인**: 멀티트랙, 키프레임, 라이브 에이전트 브리지, ProRes/NLE XML은 이 카테고리의 기본기가 됐다.

출처: [palmier.io](https://www.palmier.io/) · [GitHub palmier-io/palmier-pro](https://github.com/palmier-io/palmier-pro) · [YC Launch](https://www.ycombinator.com/launches/QtT-palmier-pro-an-open-source-video-editor-your-agents-can-operate) · [Digital Trends](https://www.digitaltrends.com/cool-tech/this-new-video-editor-lets-claude-work-directly-on-your-timeline/) · [eesel 분석](https://www.eesel.ai/blog/what-is-palmier-ai-video-editor)

### 1-b. 레퍼런스 2: ChatCut Codex 플러그인 (2026-07 확인)

"Codex가 풀 비디오 에디터가 됐다"로 홍보되는 [ChatCut](https://chatcut.io/)의 실체(설치 페이지·플러그인 리포 실측):

- **본체는 클라우드 웹 NLE**(app.chatcut.io, 크레딧 과금·Pro 내보내기) — Codex 안의 에디터는 **Codex 데스크톱 앱의 인앱 브라우저에 웹앱을 띄운 것**. 에이전트는 ChatCut **클라우드 MCP**(OAuth 로그인) + 인앱 브라우저 컨트롤로 조작. 로컬 의존성은 ffmpeg(PATH)뿐.
- **"플러그인" = git 리포 하나**([ChatCut-Inc/agent-plugin](https://github.com/ChatCut-Inc/agent-plugin)): `.agents/plugins/marketplace.json` + `.codex-plugin/plugin.json` + `.mcp.json` + `skills/*/SKILL.md`(asset-import/모션그래픽/export/image-gen/music/known-errors) + hooks. **스토어 심사·오피셜 승인 없음** — `plugin marketplace add <git url>`이 전부.
- **"URL 읽으면 설치" 패턴**: 설치 페이지 자체가 에이전트 지시문("If you are a Codex agent reading this file…" + 실행 계약·자가보고 요구). 온보딩 마찰을 에이전트가 흡수하는 설계.
- **UX 시사점(사용자가 원하는 플로우로 확인됨)**: 좌측 채팅(작업 진행 서사 + 결과 썸네일 + "Open in editor") + 우측 풀 NLE(시간 눈금·줌 슬라이더·멀티트랙 MG/V2/V1/A1·필름스트립·파형·하단 "Tell AI what changes to make" 입력). → 우리 A2(채팅 패널)·B1/B2(타임라인 v2)의 목표 화면.
- **dawn-cut 적용**: Claude Code도 동일한 플러그인 체계(git 마켓플레이스+MCP+skills)를 지원 → **A3(라이브 브리지) 완성 후 A6(플러그인 패키징)로 동일 원문장 온보딩 재현 가능.** 차이는 우리 에디터가 클라우드 웹앱이 아니라 **로컬 네이티브 앱**이라는 것(프라이버시·무크레딧 = 우위).

---

## 2. CapCut 2026 기준선 (UX/기능)

- 멀티트랙 + **키프레임 그래프 에디터**(이징 커브 직접 편집)
- 이펙트/템플릿/전환 **5만+ 라이브러리** + 트렌드 동기화 템플릿(틱톡/릴스에서 지금 도는 포맷)
- **자연어→이펙트 생성기**("glitch transition with neon colors")
- 스피드 램프, 크로마키, 자동 자막 100+ 언어, 필터, 무료 음악/효과음
- 무료 티어: 컷/분할/멀티트랙/키프레임/1080p 내보내기 전부 포함

출처: [CapCut Desktop](https://www.capcut.com/tools/desktop-video-editor) · [BIGVU 리뷰 2026](https://bigvu.tv/blog/capcut-desktop-review-2026-features-pricing-smart-alternatives/) · [CapCut 기능 가이드](https://capcutguide.com/capcut-video-editor-features-guide/)

---

## 3. dawn-cut 현황 실사 (v0.1.10)

### 3-1. UI 표면

- 레이아웃: 툴바 / (복구배너) / 좌레일 56px + 도크 290px + 프리뷰 + 자막·대본 380px / 4트랙 타임라인 214px / 상태바
- 패널 4종: 미디어(드롭·프록시 배지), 음성·TTS(BYOK 3키, 던 보이스 4종, 스타일·속도), 스티커·GIF(이모지 12+모션 12+배지 8), 효과·색보정(자동보정, 프리셋 7, 리프레임 3)
- 자막·대본 패널: 번인 토글, 스타일 팩, 프리셋 갤러리, 애니 5종, 9-앵커, 검수 도구(말버릇/저신뢰/사전/챕터), 어절 클릭 컷·더블클릭 교정
- 프리뷰: 오버레이 드래그/리사이즈/속성(회전·투명도·타이밍·이동 애니), 자막 드래그, 리프레임 마스크
- 단축키: CapCut 표준(⌘B/Q/W/JKL) 포함 18종
- 내보내기 9종(MP4 4해상도·2fps/GIF/MP3/SRT)

**갭(없음 명시)**: 타임라인 **줌/시간눈금/썸네일/파형/클립 드래그·트림 없음**(비디오 컷은 대본·키보드로만). **간단↔고급 인앱 토글 없음**(`DAWN_ADVANCED=1` 환경변수 전용) → 일반 실행에선 **NL 바·승인 카드·감사로그가 아예 안 보임**. B-roll 6종은 에셋만 있고 노출 패널 없음.

### 3-2. 에셋

모션 스티커 12(GIF)+2(알파 mov), 절차 배경 6종 — 전부 저작권 제로 자체 생성. **CapCut 5만+ 대비 볼륨 자체가 카테고리 미달**; 큐레이션·검색·태그 없음.

### 3-3. 바이브 편집 표면

- **GUI**: NL 바(`"말버릇 빼줘"` 등) → 플래너(클라우드 sonnet-4.6 → 로컬 LLM → 룰 폴백) → dry-run diff → **명령별 체크박스 부분 승인** → 해시체인 감사. 설계는 Palmier보다 우수하나 **advanced 게이트에 숨겨져 있음**.
- **MCP 서버**(`apps/mcp`, 11툴): open_project/state_summary/command_manifest/plan/dry_run/apply/save_project/audit_log/find_words/find_silences/render. **헤드리스(.dawn 파일) 전용 — 실행 중 GUI와 라이브 브리지 없음**.
- **CLI 에이전트**(scripts/): promo-agent(자연어+에셋→쇼츠 양산), 템플릿 3종, grok 에셋 생성 — **전부 앱 밖 터미널 전용**.

### 3-4. 엔진 점검 — 두 질문에 대한 정직한 답

**Q1. CapCut/Final Cut급 편집 엔진인가? → 아니오.**

| 축 | 상태 |
|---|---|
| 렌더 정확성 | ✅ ffmpeg 기반 결정적 렌더(색보정·줌·오버레이·키프레임·이징·블렌드·자막 번인 실렌더, VideoToolbox, ±1frame 규약) |
| 타임라인 표현력 | ❌ **단일 비디오 트랙·단일 소스**. 전환(xfade) 없음, 배속(atempo/setpts) 없음, 오디오 덕킹 없음, PIP/음악 트랙 없음, 모션그래픽 없음 |
| 실시간성 | ❌ 프리뷰 = HTML `<video>` + CSS 근사. **키프레임 모션·블렌드·회전·줌·자막 pop은 프리뷰에서 재생 불가**(렌더해야 보임). 합성 프레임 WYSIWYG 아님 |
| 스케일 | ❌ 파형/썸네일 없음, 30분+ 롱폼 최적화 없음(컷마다 필터 노드 — 필터그래프 폭증). 프리뷰 프록시만 있음 |

**Q2. 바이브 편집 엔진을 장착했는가? → 구조는 예(경쟁 우위), 범위는 아니오.**

- ✅ 구조: 직렬화 EditCommand 버스 + Zod 단일 진실원천 + 적용 후 불변식 게이트 + dry-run/diff/부분 승인 + 해시체인 감사 + MCP. **"AI 편집을 검증·재현·감사할 수 있다"는 구조는 Palmier에도 없다.**
- ❌ 범위: 동사 14개(플래너 노출은 안전 7개) vs Palmier 49개. 에이전트가 오버레이 추가·텍스트·보이스오버·전환·배속·에셋 생성·클립 배치를 **말할 수 없다**. 라이브 브리지 부재로 "앱을 보며 에이전트와 대화"가 불가.

---

## 4. 고도화 계획

원칙: **모트(결정적 버스·불변식·승인·감사) 위에 쌓는다.** 어휘 확장은 전부 EditCommand 동사로(우회 금지). 멀티트랙은 주 트랙(전사 동기) 1개를 유지하고 부속 레이어(오버레이 모델 연장)로 체감을 먼저 확보 — SYNC-INV 붕괴 없이.

### Phase A — 바이브를 1급 시민으로 (표면, 최고 ROI)

| # | 작업 | 내용 | 연관 |
|---|---|---|---|
| A1 | **advanced 게이트 철거 → 인앱 모드** | NL 바·승인 카드·감사로그를 기본 노출(또는 설정 토글). 환경변수 게이트 제거 | 신규 |
| A2 | **NL 바 → 채팅 패널 승격** | 좌레일 5번째 패널 '어시스턴트': 대화 맥락 유지, 제안→diff 카드→승인이 대화 흐름 안에, 타임라인 변경분 하이라이트 | #14 확장 |
| A3 | **앱↔MCP 라이브 브리지** | 실행 중인 GUI 세션에 MCP 연결(Palmier처럼 localhost) — Claude Code/Desktop이 열려 있는 프로젝트를 실시간 편집, 변경은 승인 카드 경유 | README 미완 항목 |
| A4 | **동사 확장 1차 (14→25±)** | addOverlay/updateOverlay/removeOverlay, addVoiceover, addText(수기자막), addBroll(배경), setSpeed, addTransition, moveVoice/trimVoice — 전부 dry-run 가능하게 | #18, #9, #8 |
| A5 | **promo-agent 앱 내 통합** | 멀티 에셋 인박스 + "OO 홍보영상 만들어줘" → 템플릿 연출 → 승인 카드 → 타임라인 반영 | #18 |

### Phase B — 타임라인 NLE 기본기 (CapCut 체감 격차)

| # | 작업 | 내용 | 연관 |
|---|---|---|---|
| B1 | **타임라인 v2**: 줌(⌘휠)+시간 눈금+가로 스크롤 | CapCut 체감의 절반 | 신규 |
| B2 | **썸네일 필름스트립 + 오디오 파형** | ffmpeg 배치 추출(프록시에서), 캐시 | 신규 |
| B3 | **비디오 클립 드래그 트림/리플** | trimClip 동사 신설 → GUI 드래그가 버스 경유(사람=에이전트 동일 버스 유지) | 신규 |
| B4 | **전환**: crossfade/dip-to-black — xfade 길이 정산형 동사 | #8 | 
| B5 | **배속**: setSpeed(구간, 배속) — setpts+atempo, 자막 타임스탬프 재계산 | #9 |
| B6 | **오디오 덕킹**: BGM 대비 보이스 sidechaincompress | 신규 |
| B7 | **음악(BGM) 트랙**: 오디오 오버레이 모델(음원 파일+볼륨+루프) — amix 3입력 확장 | 신규 |

### Phase C — 프리뷰 WYSIWYG (단계적, 재작성 회피)

| 단계 | 내용 |
|---|---|
| C1 (즉효) | CSS로 재현 가능한 것 전부: 키프레임 모션→CSS animation/transform, 회전→transform, 블렌드→mix-blend-mode, 자막 pop→CSS 키프레임, 줌→transform scale. "렌더해야 보임" 목록 대부분 해소 |
| C2 (중기) | canvas/WebCodecs 합성 프리뷰 — 전환·정확한 색까지 프레임 단위 WYSIWYG. 멀티소스 도입 시점에 착수 |
| C3 (비권장/보류) | 네이티브 Metal 엔진(Palmier 길) = 사실상 재작성. Electron 유지 결정과 충돌 — 하지 않는다 |

### Phase D — 에셋·템플릿 생태계

- B-roll 패널 신설(assets/broll 6종 노출 + 무드 태그), 모션 스티커 12→30종(#10)
- 프로모 템플릿을 앱 템플릿 갤러리로(추후 서버 배급 구조는 유지 결정대로)
- 생성형 에셋 동사: generateImage/generateSticker (grok CLI/BYOK 어댑터) — Palmier처럼 크레딧 장사가 아니라 **BYOK 로컬 철학 유지**
- CC0 실사 배경 수집(Pexels API)

### Phase E — 상호운용·프로급 출력 (Palmier 파리티)

- ProRes 내보내기(prores_ks 이미 보유 — 프리셋만 추가), H.265(VideoToolbox hevc)
- FCPXML/EDL 내보내기(Premiere/Resolve 핸드오프) — "장난감 아님" 신호
- SRT/VTT 가져오기(#13)

### 우선순위 권고 (사이클 단위)

1. **A1+A2** (바이브 노출 — 지금 가장 싸고 가장 티 남)
2. **A4+B4+B5** (동사 확장 + 전환 + 배속 — 에이전트가 말할 수 있는 것의 급팽창)
3. **A3** (라이브 MCP 브리지 — Palmier 파리티의 핵심)
4. **B1+B2+B3** (타임라인 v2 — CapCut 체감)
5. **C1** (프리뷰 CSS 파리티), **A5**(프로모 통합), **B6+B7**(오디오)
6. **D, E** 병행

---

## 5. 포지셔닝 재확인

Palmier = "생성이 타임라인에 산다"(클라우드 크레딧, GPL, macOS 26, 영어권).
**dawn-cut = "신뢰할 수 있는 바이브 편집"** — 승인·diff·감사로그가 UI에 보이는 유일한 에이전트 에디터 + 영상이 기기를 떠나지 않음 + 한국어 최고 품질(어절 재조립+turbo) + MIT. 생성형은 BYOK 어댑터로 따라가되, 신뢰 구조와 한국어·로컬을 정면에 세운다.
