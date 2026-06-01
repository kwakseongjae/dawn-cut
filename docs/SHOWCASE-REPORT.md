# dawn-cut 쇼케이스 리포트 — 와우 평가·격차·프로덕션 추천

> 작성 기준: repo 코드 직접 검증 + 메인 루프 육안 관찰 + 3렌즈 리서치 종합.
> 모든 "있음/없음" 판정에 `파일:심볼` 근거를 붙였다. 과장 없이 정직하게(색보정 subtle 약점 포함) 기술한다.
> 용도: 사용자 최종 검수 및 프로덕션 우선순위 판단.

> **⟳ 구현 현황 업데이트 (이번 이터레이션 — 본 리포트의 최우선 권고를 바로 반영):**
> - **★① 애니메이션 자막 = 구현 완료.** `subtitles.ts`에 어절 타이밍 보존(`SubtitleCue.words`) + `captionFrames(cue, 'reveal'|'karaoke')` 추가, `SubtitleStyle.animation` 필드(+Zod 스키마 +GBNF styleKey)로 command bus·LLM 플래너에 노출. 갤러리 cook이 **10 cue → 34 reveal 프레임**으로 단어가 말과 함께 또박또박 등장. (drawSubtitle은 정적 유지 — cue를 다중 PNG 프레임으로 펼쳐 기존 오버레이 합성을 그대로 재사용. 예측대로 신규 렌더 엔진 불필요.)
> - **색보정 강도 정정 = 완료.** §3에서 지적한 cinematic 코드↔문서 불일치(`colorFilter()`가 1.2/0.85로 약하게 렌더)를 테이블 의도값(contrast 1.30/sat 0.70, lift 0.06/high 0.92)으로 정렬 → 코드·문서 일치 + 더 강한 시네마틱.
> - **★② 강한 1탭 auto-enhance = `vivid` 프리셋 구현 완료.** 고채도(1.6)+약대비+웜틸트 '화사 보정'. effects/edit-command/grammar/UI 드롭다운("화사하게 vivid·1탭")에 노출. 색프리셋 6종. (적응형 강도(signalstats)는 사이드카 분석패스 필요 → 잔여.)
> - **★③ 스타일 팩 템플릿 = 구현 완료.** `templates.ts`의 `STYLE_PACKS`(6종: 바이럴펀치/먹방시즐/뷰티글로우/골든아워/시티나이트/토크클린) — 각 팩 = **plan(EditCommand[] 묶음)**(자막스타일+애니 + 색 + 말버릇). 워크플로 설계·스키마 검증, 전 팩 dryRun 클린. command bus로 적용 → GUI·LLM·MCP 공유. (UI 1클릭 버튼 + 앱 export의 자막 애니 반영 = 잔여 productization.)
> - 아래 본문은 *작성 시점* 기준 진단이다. 위 항목(애니 자막·cinematic·vivid·스타일 팩)은 이제 "있음"으로 갱신됐다 — **P0 3개 모두 코어 구현 완료.**

---

## 1. 요약 (TL;DR)

- **지금 가장 강한 와우 = 자동 자막 파이프라인이다.** STT(한국어 large-v3-turbo, 어절 타임스탬프) → `transcriptToCues`(쇼츠형 짧은 cue) → `drawSubtitle`(koreanShorts 프리셋 + 노란 키워드 강조) → PNG 번인이 끝까지 결정적으로 작동한다. cook 갤러리(raw 클립 → 자막+색보정 쇼츠)가 이 강점을 가장 잘 보여준다.
- **가장 큰 약점 = 색보정이 절제(subtle)됐고, "움직임"이 없다.** 색 5프리셋은 tasteful하나 캐주얼 시청자에 즉각 와우가 약하고(`effects.ts`의 cinematic 코드 경로는 문서 프리셋보다 더 약함 — §3 주석 참조), 자막은 전부 **정적 PNG 한 장**이라 CapCut류의 단어별 등장/카라오케/pop-in이 전혀 없다.
- **결정적 발견: 애니메이션 자막을 만들 데이터·합성 엔진이 이미 90% 깔려 있다.** 어절별 `from`/`to`(whisper.ts)와 멀티키프레임·이징·rotation·blend 오버레이 합성기(`overlay.ts`)가 존재한다. 막힌 곳은 단 두 군데 — (a) `transcriptToCues`가 cue를 join 문자열로 평탄화해 단어 타이밍을 버림, (b) `drawSubtitle`이 진행도 `t`를 안 받는 정적 함수.
- **구조적 해자 = command bus(9 verb) + MCP + 감사로그.** Vrew/CapCut에 없는 "자연어 1프롬프트 → 결정적·감사가능 편집"이 이미 동작한다. 단기 와우(애니 자막)와 장기 비전(AI 자동 편집)이 같은 파이프라인 위에 얹힌다.
- **권고 한 줄:** **① 애니메이션 자막(단어별 reveal/karaoke) + ② 강한 1탭 auto-enhance** 두 개에 집중하라. 둘 다 기존 아키텍처를 거의 그대로 재사용하며(신규 엔진 불필요), 갤러리 와우를 즉시 끌어올린다.

---

## 2. 갤러리 평가 (output/gallery/, before|after)

메인 루프가 실제 유튜브 쇼츠로 렌더·육안 확인한 결과를 기능×장르 관점에서 한 줄평.

| 클립 | 장르 / 적용 | 한 줄 평 (정직) |
|---|---|---|
| **scenic** | 해안 일몰 드론 / cinematic | 대비·무드가 확 살아 인상적. **단 grade가 절제(subtle)** — colorFilter의 cinematic은 contrast 1.2/sat 0.85로 문서 프리셋(1.30/0.70)보다 약해 "필름룩"이 은은한 수준. 자연 풍경이라 약한 보정도 그럴듯하지만 캐주얼 와우는 약함. |
| **city** | 야경 / punch | punch(contrast 1.30·sat 1.40)는 5프리셋 중 가장 셈. 야경 네온이 살아남. 그래도 "1탭으로 확 산다"는 임팩트까진 못 감 — 적응형 강도가 없어 일률 적용. |
| **beauty** | 메이크업 세로 9:16 / warm | 피부톤 따뜻하게 ↑. **그러나 subtle** — warm은 중간점 게인 미세 이동(curves)이라 변화 폭이 작다. 9:16 세로지만 **자동 리프레이밍/safe-area는 미적용**(원본이 이미 세로였을 뿐). |
| **food** | 먹방 / warm | 음식이 먹음직스럽게 보정됨. 장르-프리셋 매칭은 좋으나 역시 절제. |
| **pet** | 코기 / warm | warm 의도대로 따뜻. **단 데모 하니스가 pet를 `mode:'color'`로 구성해 자동 자막을 적용하지 않았다**(gallery.test.ts) — 원본에 한/영 자막이 깔려 있던 것과는 별개. 즉 dawn-cut 최강점(자동 자막)이 데모 구성상 빠진 케이스. 자막 강점을 보이려면 pet도 caption 모드로 돌리면 된다(원본 자막과 겹침은 감수). |
| **cook** | 레시피 / **자동 자막 ~10 cue(STT 의존, koreanShorts·키워드 강조) + warm** | **★ 가장 강한 와우.** raw 클립 → 자막+색보정 쇼츠로 완성. dawn-cut의 차별점(STT→cue→번인 결정 파이프라인)이 전부 동작한 유일한 클립. **결론: 자막이 들어간 cook이 우리 데모의 대표 샷이어야 한다.** 여기에 애니메이션만 더하면 CapCut 격차의 절반이 메워진다(→ 이번 이터레이션에서 reveal 애니 적용 완료, 상단 배너 참조). (cue 수는 `maxWordsPerCue:4·maxCharsPerCue:13` 기준 STT 결과에 따라 변동 — "약 10"은 1회 관측치.) |

**갤러리 종합 관찰:** (1) 색보정 단독은 장르 적합하나 SUBTLE → 즉각 와우 약함(→ cinematic 강도 정정 완료). (2) 자동 자막이 현재 유일·최강 차별점(데모는 자막 없는 raw 음성 소스를 골라야 강점이 산다). (3) 데모 ROI는 "색보정 더 보여주기"가 아니라 "자막에 움직임 더하기"에 있다(→ reveal 애니 적용 완료).

---

## 3. 와우 격차 분석

판정 = 코드 교차검증 결과. 임팩트/난이도는 리서치+육안 종합, dawn-cut 적합도는 기존 아키텍처 재사용 가능성.

| 기능 | 현재 상태 (코드 근거) | 와우 임팩트 | 구현 난이도 | dawn-cut 적합도 |
|---|---|---|---|---|
| **애니메이션 자막 (단어별 reveal/karaoke/pop-in)** | **없음.** 자막=정적 PNG 1장(`draw.ts:drawSubtitle`, 진행도 인자 없음). `transcriptToCues`가 단어 타이밍을 join 문자열로 버림(`subtitles.ts:54`). `karaoke\|reveal\|pop-in` grep 0건. 단 어절 `from/to`(whisper.ts)·`emphasisColor` 정적 강조·`easing.ts`는 **이미 보유**. | ★★★★★ | **중** | **최상** — 데이터·이징·오버레이 합성 90% 완비. cue당 N프레임 PNG 시퀀스로 확장하면 됨(결정성 유지). |
| **강한 1탭 auto-enhance** | **없음.** `enhance\|auto-fix\|one-tap` grep 0건. 색보정은 명시 5프리셋만(`effects.ts:COLOR_PRESETS`). cinematic은 코드상 contrast 1.2(문서 1.30)로 **오히려 약함**. | ★★★★ | **하~중** | **최상** — `applyColorgrade` verb 그대로, `vivid` 프리셋 추가 + intensity 적응형(`signalstats` 평균밝기) 정도. 길이 불변 유지. |
| **자막 정확도 보정 UX (저신뢰 강조 + glossary)** | **부분.** `applyGlossary` verb·어절 `confidence`는 **이미 있음**(edit-command.ts, whisper.ts). UI에서 저신뢰 어절 시각 표시는 없음. | ★★★ | **하~중** (주로 UI) | **상** — Vrew의 명시적 약점(고유명사 오인식) 직접 공략. 코어 준비됨. |
| **9:16 자동 리프레이밍 + 자막 safe-area** | **없음.** `reframe\|crop\|aspect\|9:16\|tracking` grep 0건. frameW/H는 probe값 그대로. | ★★★★ | **중**(정적 center-crop) / **상**(얼굴추적) | **중** — 정적 크롭은 EDL+필터로 가능, 화자추적은 사이드카 신규 검출 필요. |
| **전환 (transition / xfade)** | **없음.** `xfade\|crossfade` 소스 0건(매치는 amix `dropout_transition` 뿐). `renderEdl`은 hard-cut concat. | ★★★ | **중** | **중** — 단일 concat 전제를 깨고 그래프 재구성 필요. |
| **비트싱크 컷 / 펀치인** | **없음.** `beat\|onset\|tempo\|bgm` grep 0건. 오디오는 program + TTS amix만. | ★★★~★★★★ | **중~상** | **중** — 사이드카에 onset 검출 필요. "비트에 applyZoom 펀치인"이 컷보다 구현 쉽고 효과적. |
| **인트로 훅 (3초)** | **없음**(전용 코드). 범용 텍스트 오버레이+`applyZoom`으로 수동 가능. | ★★★~★★★★ | **하** | **상** — 신규 엔진 불필요, 기존 verb 조합 템플릿. |
| **스티커/이모지 모션** | **부분.** `drawEmoji`/`drawBadge` PNG + 오버레이 키프레임/이징/rotation/blend는 **코어 구현**(`overlay.ts`, types.ts kind: sticker). **단 UI 인스펙터 노출은 `to.x`/`to.y` + `rotation`까지** — 이징·멀티키프레임·blend는 코어/프로젝트 IO에만 있고 UI 편집 미노출(index.tsx). | ★★★ | **하~중** | **상** — 엔진 완비, 병목은 에셋 큐레이션·UI 노출. |
| **템플릿/프리셋 팩** | **없음**(복합 묶음). 색 5 + 자막 7 프리셋 개별로만 존재(`COLOR_PRESETS`, `SUBTITLE_PRESETS`). | ★★★★ | **하** | **최상** — 코드보다 큐레이션. 자막애니+색+훅을 1클릭 JSON으로 묶음. |
| **B-roll 자동 삽입** | **수동 부분 / 자동 없음.** `kind:'video'` 오버레이 합성은 됨(overlay.ts). 자동 선택·배치 로직 없음. | ★★~★★★ | **상** | **하** — 외부 스톡 API·라이선스·매칭. 초기 범위 밖. |
| **AI 보이스/더빙** | **부분.** TTS 사이드카(macOS say/Piper) 보이스오버 mix는 됨(ffmpeg index.ts adelay+amix). | ★★ | **중** | **중** — 편집보다 생성. 우선순위 낮음. |

---

## 4. 프로덕션 추천 (지금 / 다음 / 나중)

### ★ 핵심 권고 — 가장 ROI 높은 1~2개

**① 애니메이션 자막 (단어별 reveal / karaoke 하이라이트 / pop-in) — 와우 高 · 난이도 中.**
가장 ROI가 높다. CapCut의 1순위 와우이고, 무음 시청 80% 환경에서 "스크롤을 멈추게 하는" 동력이다. 메인 루프도 "가장 강한 차별점은 자동 자막"이라 했으니, 여기에 움직임만 더하면 즉각 와우.
- **아키텍처 적합성(왜 中 난이도인가):** 인프라가 거의 다 있다. 어절별 `from/to`는 `whisper.ts`가 주고, `easing.ts`에 4종 이징이 있고, 자막은 이미 `kind:'subtitle'` PNG 오버레이로 합성된다(ui `rasterizeSubtitle` → `kind:'subtitle'`). **막힌 두 군데만 뚫으면 된다:**
  - (a) `subtitles.ts:transcriptToCues`가 `text: group.map(t=>t.text).join(' ')`로 단어 타이밍을 버린다(line 54). cue에 `words: {text,startUs,endUs}[]`를 보존하도록 확장.
  - (b) `draw.ts:drawSubtitle`이 정적 1프레임이다. **cue당 다중 PNG 프레임**(활성 단어가 바뀌는 시점마다 1장)으로 래스터하면, 기존 1000×150 캔버스·`emphasisColor` 강조·번인 경로를 **그대로 재사용**한다. karaoke=활성 단어를 emColor로, reveal=미등장 단어 미표시, pop-in=오버레이 `to.scale`+easeOut.
  - 새 verb 불필요하거나 `setSubtitleStyle`에 `animation: 'wordReveal'|'karaoke'|'popIn'` 한 필드 추가로 끝.
- **검증 데모:** cook 클립(이미 10 cue 자동자막)에 karaoke를 입혀 before/after를 갱신하면 대표 샷이 강화된다.

**② 강한 1탭 auto-enhance — 와우 高 · 난이도 下~中.**
갤러리가 지적한 "색보정 subtle" 약점을 직접 해소한다. 저노력·고임팩트.
- **아키텍처 적합성:** `applyColorgrade` verb·`colorFilter` intensity 가중이 이미 있다. 필요한 건 (a) 더 과감한 `vivid` 프리셋(punch + 약한 `unsharp` + vignette), (b) **콘텐츠 적응형 intensity** — 사이드카 `signalstats`로 평균 밝기/대비 측정 → 어두우면 brightness/contrast 자동 상향. 길이 불변이라 안전. **현재 cinematic 코드(1.2)가 문서(1.30)보다 약한 불일치도 이참에 정리** 권장.

### 지금 올릴 것 (P0 — 즉시, 데이터 보유, 저~중 난이도)
1. **애니메이션 자막** (위 ①). — 단일 기능으로 CapCut 격차 절반 해소.
2. **강한 1탭 auto-enhance** (위 ②). — subtle 약점 직접 해결, 갤러리 임팩트 직결.
3. **스타일 팩 템플릿 (1클릭 쇼츠 스타일)** — 코드 거의 없이 큐레이션. 위 ①②+색+훅을 묶은 JSON 프리셋. command bus 조합이라 즉시 가능하고, cook 갤러리 와우를 "제품"으로 만든다.

### 다음 (P1 — 한국 숏폼 필수, 중간 노력)
4. **9:16 자동 리프레이밍(정적 center/rule-of-thirds 크롭부터) + 자막 safe-area 기본값** — Vrew/CapCut 기본 제공. 없으면 한국 숏폼 탈락 요인. 얼굴추적은 P2로 분리.
5. **자막 정확도 보정 UX** — 저신뢰 어절(whisper `confidence`) transcript 시각 표시 → 교정을 glossary로 학습. Vrew 약점(고유명사) 공략. 주로 UI.
6. **인트로 훅 템플릿** — 첫 3초 볼드 풀스크린 텍스트 + `applyZoom` 펀치인. 기존 verb 조합, 저난이도.

### 나중 (P2 — 무겁거나 비전 의존)
7. **전환(dissolve부터)** — `renderEdl` 그래프 재구성 필요(현 concat 전제 깨짐).
8. **비트싱크 펀치인** — 사이드카 onset 검출. "비트에 줌"이 "비트에 컷"보다 쉽고 효과적.
9. **B-roll/효과음/BGM 물량** — 외부 라이선스·검색·매칭. **물량 정면승부는 비효율**, ⑤(자연어 자동화)로 우회 권장.

---

## 5. 사용성 체크리스트 (실사용 관점)

- **자막 가독성:** koreanShorts(strokeWidth 12·fontWeight 800·반투명 bg 0.32)는 밝은 화면에서도 읽힌다 — 양호. 단 캔버스가 1000×150 고정이라 큰 글씨 + 긴 cue면 잘릴 수 있음 → `maxCharsPerCue` 낮게(~12-16) 강제하는 가드 권장.
- **자막 위치/safe-area:** 현재 하단 중앙 고정(cy=h*0.6). 9:16에서 플랫폼 UI(우측 버튼/해시태그)에 가릴 수 있음 → safe-area 기본 여백을 프리셋에 넣어라.
- **세로 영상:** 자동 리프레이밍 없음. 가로 소스를 세로로 올리면 그대로 패딩/잘림. 정적 center-crop verb라도 시급.
- **1탭 워크플로:** 자연어 1프롬프트(LLM 플래너→dryRun→승인)는 동작하나, 색보정 강도가 고정이라 "더 세게"가 안 됨 → 적응형 intensity + "강도 슬라이더"가 즉효.
- **색보정 강도:** **5프리셋 모두 절제됨.** cinematic은 코드(1.2)가 문서(1.30)보다 약하기까지 함. `vivid` 프리셋 + 적응형 강도로 "확 산다"는 before/after를 확보하라.
- **데모 입력 선택:** pet처럼 원본에 이미 자막 있는 소스는 우리 최강점(자동자막)이 죽는다. 데모는 **자막 없는 raw 음성 소스**(cook류)를 골라라.

---

## 6. 비전 정렬 ("자연어 → AI가 알아서 편집", P3/P4)

dawn-cut의 비전은 자연어로 AI가 command bus/MCP를 구동해 영상을 알아서 편집하는 것이다. 위 추천 기능들은 이 비전과 다음처럼 맞물린다:

- **command bus가 단일 진실원천.** 사람 GUI(store)와 AI(MCP·LLM 플래너)가 정확히 같은 9 verb를 구동하고, 적용 후 불변식(`validateState`)으로 게이트되며, 감사 해시체인(`audit.ts`)에 남는다. 신규 기능은 **새 verb 1~2개로 추가**되면 GUI·AI·MCP에 동시 노출된다(Zod 1스키마 → TS타입+런타임가드+JSON-Schema 파생).
- **애니메이션 자막 = 새 파라미터(`animation`)일 뿐.** `setSubtitleStyle` patch에 한 필드 추가하면(이번 이터레이션에서 추가 완료), LLM 플래너(`PLANNER_VERBS`에 이미 setSubtitleStyle 포함)가 "자막 단어별로 톡톡 튀게" 같은 자연어를 곧장 plan으로 만들 수 있다. **즉 와우 기능이 동시에 AI가 고를 수 있는 도구가 된다.** (단, 모델0 `rule-planner`는 자막 스타일/애니를 의도적으로 미합성하므로 — rule-planner.ts 주석 — 자막 애니의 자연어 구동은 P3 **LLM 플래너 경로에 한정**된다. 또 자막 렌더 경로는 PNG 오버레이 번인이 기본이며, 별도 소프트 SRT(`mov_text`) mux 경로도 있으나 애니메이션과는 무관.)
- **auto-enhance = 적응형이라 AI 친화적.** 콘텐츠 적응형 intensity는 "알아서 보정"의 전형 — AI가 clipId 없이 `applyColorgrade`만 부르면 사이드카가 밝기 측정해 강도를 결정. 비전의 "알아서"와 정확히 일치.
- **스타일 팩 = AI가 고르는 plan 묶음.** "1클릭 쇼츠 스타일"은 곧 `EditCommand[]` 시퀀스(자막애니+색+훅)다. LLM 플래너/MCP가 장르를 보고 적절한 팩을 통째로 emit → dryRun 미리보기 → 승인. **템플릿을 코드가 아니라 plan으로 표현**하면 사람과 AI가 같은 자산을 공유한다.
- **MCP(P4)가 외부 AI 진입점.** `command_manifest → dry_run → apply → save`를 외부 에이전트가 호출. 위 기능들이 verb/파라미터로 추가되는 한, MCP 표면이 자동 확장되어 "외부 AI가 dawn-cut으로 쇼츠를 알아서 만든다"는 비전이 점진 실현된다.
- **에셋 물량 우회 전략과 정합.** Vrew의 해자(에셋 물량)를 물량으로 못 이긴다. 대신 **command bus + 어절 타임스탬프 + MCP**라는 dawn-cut 고유 자산을 레버리지해 "적은 에셋도 AI가 적재적소" 쪽으로 가는 것이 비전다운 차별화다.

---
