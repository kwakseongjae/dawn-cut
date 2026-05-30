# dawn-cut 마케팅 플랜

> 한 줄 정의: **영상이 내 노트북을 떠나지 않는, 텍스트와 프롬프트로 편집하는 유일한 오픈소스 AI 비디오 에디터.**
> 영문: *The only open-source video editor where the AI edits for you — and your footage never leaves your machine.*

이 문서는 dawn-cut을 PoC 상태에서 바로 런칭 가능한 OSS 그로스 계획으로 옮기기 위한 실행 문서다.
핵심 전제: **dawn-cut 자체로 모든 마케팅 영상을 만든다(도그푸딩).** 데모는 외부 NLE로 편집하지 않는다.
원본 러프 영상 → dawn-cut에서 자연어 한 문장 → 자막·컷·줌 → 그대로 출력한 클립이 마케팅 자산의 1급 산출물이다.

---

## 0. 전략 요약 (왜 지금, 왜 우리)

dawn-cut은 두 개의 시장 검증된 흐름이 교차하는 자리에 있다.

1. **CapCut 약관 백래시 (2025-06-12)** — CapCut이 사용자 콘텐츠(얼굴·음성 생체정보 포함)에 영구·전세계·취소불가 라이선스를 주장. 크리에이터가 능동적으로 탈출구를 찾는 중. dawn-cut의 "100% 로컬, 무계정, 무텔레메트리"는 기능이 아니라 **구조로 된 해독제**다.
2. **OpenCut의 궤적 검증** — "오픈소스 CapCut" 포지션(45K+ stars, 1년 미만)이 실수요임을 증명. 단 OpenCut은 STT 단어 타임스탬프·텍스트기반편집·에이전트 제어가 없다. 그 빈칸이 dawn-cut의 자리다.

여기에 2026 에이전트 편집 트렌드 리서치의 결론이 정확히 맞물린다: **채택을 이기는 도구는 "제로 입력 블랙박스"가 아니라, 검토 가능한 중간표현(EDL/타임라인)을 노출하는 도구**다. dawn-cut은 결정적 EDL을 이미 보유 → 이것을 숨기지 말고 헤드라인으로 내세운다.

| 경쟁자 | 그들이 주는 것 | 못 주는 것 = 우리 자리 |
|---|---|---|
| CapCut | 강력한 무료 편집 + 효과 | 데이터 주권(생체정보 라이선스 주장), 워터마크, 온라인 종속 |
| Vrew | 동급 한국어 자동자막 | 로컬·무제한·무료·오픈소스 (Vrew는 클라우드 + 월 export 제한 + 구독) |
| Descript | 텍스트 기반 편집("문장 지우면 영상 사라짐") | 로컬·무과금·무크레딧 (Descript은 클라우드 + 크레딧) |
| OpenCut | 손으로 편집하는 범용 타임라인 NLE | STT 단어타임스탬프·텍스트편집·결정적 EDL·에이전트 제어 |

**핵심 해자(조합):** 프라이버시/로컬(축 A)과 자연어 에이전트 편집(축 B)을 **동시에** 가진 제품이 시장에 사실상 없다. 클라우드 SaaS는 B만, 로컬 OSS는 A만. dawn-cut은 양립.

> 주의: "open-source CapCut"은 OpenCut이 소유한 문구다. 우리는 그 표현을 쓰지 않고 **"local-first AI editor that edits by text and by prompt"**를 소유한다.

---

## 1. 포지셔닝 메시지

### 메시지 계층 (리드 → 보조 → 비전)

1. **리드 (CapCut 해독제):**
   - 한국어: "영상이 내 노트북을 한 바이트도 떠나지 않습니다. 계정·워터마크·구독 없이."
   - English: "Your video never leaves your machine. No account, no watermark, no subscription."
2. **보조 (Descript 언어 현지화):**
   - 한국어: "문서처럼 영상을 편집하세요 — 문장을 지우면 그 장면이 사라집니다."
   - English: "Edit video like a document — delete a sentence, the clip vanishes."
3. **비전 (build-in-public 후크):**
   - 한국어: "한국어로 말하면 AI가 컷·자막·줌을 제안합니다. 타임라인을 눈으로 확인하고, 렌더하세요."
   - English: "Tell it what to cut in plain language. It proposes, you see the timeline, then render."

### 글로벌 vs 한국 메시지 분기

| | 글로벌 (HN / PH / Reddit / X) | 한국 (긱뉴스 / 유튜브 / 커뮤니티) |
|---|---|---|
| 1순위 후크 | "Your footage never leaves your machine" (프라이버시·로컬) | "Vrew급 자동자막인데 로컬·무제한·무료·오픈소스" |
| 2순위 후크 | "edit by text and by prompt" (에이전트 차별화) | CapCut 약관 우려 해독제 + "구독·워터마크 없음" |
| 신뢰 후크 | "AI proposes, you review the EDL, then render" (투명한 IR) | "내 데이터를 한 바이트도 안 보냄" + MIT 오픈소스 |
| 톤 | 기술적·솔직 (PoC임을 명시 = 신뢰 자산) | 실용적·"작업 시간 단축" 체감 중심 |

**카피 원칙:** 기능 나열로 시작하지 않는다. 항상 *negative-space promise*(없는 것: 클라우드·워터마크·구독·계정)로 리드한다 — OpenCut이 증명한 헤드라인 공식.

---

## 2. 타겟 페르소나별 후크

### P1 — 한국어 정보형 롱폼 1인 채널주 (1차 비치헤드)
- 프로필: 강의·리뷰·지식 채널, 주 1~2회 업로드, 자막 작업이 병목, Vrew 구독료/제한에 불만, 데이터 업로드 찜찜.
- 페인: 자막 다는 데 영상당 1~2시간. Vrew 무료 월 30분 export 한계. 효과 리소스 부족.
- 후크: **"긴 영상 자막, AI가 어절 단위로 달고 무음 자동 컷. 로컬에서, 무제한, 공짜로."**
- 채널: 긱뉴스 Show, 한국 유튜브 워크스루.

### P2 — 프라이버시·자기호스팅 성향 개발자/크리에이터 (글로벌 비치헤드)
- 프로필: r/selfhosted·r/LocalLLaMA 거주, 텔레메트리·클라우드 업로드 거부, whisper.cpp/llama.cpp 이미 친숙.
- 페인: CapCut 데이터 주권, SaaS 락인, 크레딧 과금.
- 후크: **"whisper.cpp + local TTS, zero telemetry. Your footage never uploads. MIT."**
- 채널: Show HN, r/LocalLLaMA, r/selfhosted.

### P3 — Descript 난민 / 텍스트기반 편집 신봉자 (글로벌 확장)
- 프로필: 텍스트로 영상 편집하는 워크플로에 이미 길들여짐, Descript 크레딧 개편·롤오버 폐지에 반발.
- 페인: 구독·크레딧, 클라우드 종속, 교차발화 전사 약점.
- 후크: **"Edit-by-text, but it never leaves your laptop and costs nothing."**
- 채널: X(build-in-public), r/podcasting, r/VideoEditing.

### P4 — OSS 기여자 / 빌드인퍼블릭 관찰자
- 프로필: 잘 만든 OSS 아키텍처에 끌림, 결정적 EDL·property test·데이터계약 같은 엔지니어링 디테일에 반응.
- 후크: **"Deterministic EDL + property tests so AI edits are reproducible and auto-verifiable."**
- 채널: Show HN 댓글, GitHub README "How it works" 섹션, X.

---

## 3. 채널 전략

### GitHub (홈베이스 — README가 곧 랜딩페이지)
- README 첫 화면에 데모 GIF(원본 → 자연어 한 문장 → 타이트한 자막 컷)가 와야 한다. 현재 README는 시각 자산 0, 아키텍처로 리드 → **재작성 필수(섹션 5 참조).**
- Awesome-Self-hosted / Awesome-OSS-alternatives / Awesome-video 리스트 등재(복리·저비용, 가장 먼저).
- star-history 배지 + 키워드강조자막 스크린샷 추가.

### Show HN (글로벌 기술 군중)
- 규칙 엄수: `Show HN:` 접두, 구체적·비영업적 제목, 링크는 **마케팅 사이트가 아니라 repo**, 이미지 포함, 저자가 모든 댓글에 응답, **절대 업보트 요청·링크 공유 금지**(HN 링 탐지 강력).
- 제목 예시: `Show HN: dawn-cut – local AI video editor, edits by text, runs whisper.cpp + ffmpeg on your machine`
- 기술 군중에 먹히는 디테일을 리드: whisper 단어 타임스탬프, 결정적 EDL, libass-free canvas 자막 래스터화, 한국어 어절 재조립.
- **PoC임을 솔직히 밝히는 것이 신뢰 자산.**

### Product Hunt (온보딩 매끄러워진 뒤 마지막)
- 폴리시된 데모 영상 + 사전 기대감 빌드업 후에만. PH는 "완성도" 채널.
- 헌터 섭외 + 런칭일 X 동시 푸시.

### 긱뉴스 GeekNews (한국 1차 비치헤드 — 한국판 HN)
- "Show" 섹션 글 1건 = 한국판 Show HN. 월 ~20만 방문 + 4,000+ 기업 Slackbot + 월요일 Weekly 뉴스레터로 정확히 우리 타겟에 도달.
- 리드 메시지: "Vrew급 자동자막인데 로컬·무제한·무료·오픈소스" + CapCut 약관 해독제.
- 기술 디테일도 환영받는 군중이므로 EDL·결정성·한국어 어절 처리 언급.

### Reddit (10% 룰 엄수: 90% 진성 참여, 10% 홍보)
- r/LocalLLaMA (self-promo <10%) → "whisper.cpp + local TTS, no cloud" 앵글.
- r/selfhosted → "zero telemetry, footage never uploads".
- r/opensource (210K, 제한적 홍보 허용) + r/SideProject → MIT·빌드인퍼블릭 앵글.
- r/VideoEditing·r/podcasting → Descript 난민 텍스트편집 앵글.
- 서브레딧별 규칙 사전 확인 필수.

### 한국 커뮤니티 (긱뉴스 외 보조, 오가닉)
- 아카라이브 영상편집/유튜버 채널, 클리앙, 디시 영상편집 갤러리 — 스팸 아닌 진성 공유.
- 후크: "자막 작업 시간 단축" 체감 + "데이터 안 올라감".

### YouTube (한국 우선, 워크스루)
- 한국어 내레이션 워크스루(5~8분): 실제 러프 영상을 dawn-cut으로 자막·컷하는 전 과정.
- 도그푸딩 메타: **"이 영상의 자막과 컷도 dawn-cut으로 만들었습니다"**를 영상 말미에 명시.

### X / Twitter (build-in-public 엔진)
- Screen Studio·Onlook이 증명한 공식: **아름다운 before/after 데모 클립을 기능 출시마다 1개씩** 올린다.
- 데모 클립 = 1급 산출물. 러프 영상 → 자연어 한 문장 → 타이트한 자막 컷.
- "shippable feature 1개 = 클립 1개" 리듬 유지.

---

## 4. 데모 영상 컨셉 (= 도그푸딩, dawn-cut으로 직접 제작)

> 모든 데모는 dawn-cut으로 편집한다. 이것이 가장 강력한 증거다 — "우리는 우리 도구로 우리 영상을 만든다."

### 히어로 클립 (<30초, README/X/PH/긱뉴스/유튜브에 재사용)
- 구성: 러프 화면녹화 원본 → 자연어 한 문장 입력 → (1) 키워드강조자막 + (2) 무음컷 + (가능 시) (3) 펀치인줌 → 타이트한 결과물.
- before/after 분할 또는 빠른 컷으로 변환의 "와우"를 30초 안에.
- **한국어 내레이션 버전 별도 제작**(1차 타겟 P1용).
- 영문 자막 버전(글로벌용).

### 워크스루 영상 (5~8분, 유튜브)
- 실제 채널주 시나리오: 20분 강의 러프 → 자막 자동 + 필러/무음 제거 + 키워드강조 → export.
- 데이터가 로컬에 머무는 것을 강조(네트워크 끊고 시연 = 강한 프루프).
- 말미 도그푸딩 메타 명시.

### 마이크로 클립 시리즈 (X용, 기능당 1개)
- "delete a sentence, the clip vanishes" 텍스트편집 클립.
- 키워드강조자막 프리셋 클립.
- 무음 일괄 제거 before/after.
- (Phase 3 이후) 자연어 프롬프트 → 제안된 타임라인 diff 보여주는 클립 = 에이전트 차별화 증거.

### 도그푸딩 내러티브
모든 채널에서 반복할 메타 메시지: **"이 데모/이 채널의 모든 영상은 dawn-cut으로 편집했습니다."**
- 신뢰: 만든 도구를 직접 쓴다.
- 콘텐츠 복리: 마케팅 영상 제작 자체가 제품 QA + 새 데모 자산.

---

## 5. README / 랜딩 후크 (런치 전 최우선 작업)

현재 README(38줄, 시각 0, 아키텍처로 리드)는 캡처해야 할 순간에 비해 부족하다. 재정렬:

```
1. 1줄 가치제안 + 자동재생 데모 GIF      ← 첫 화면 안에 반드시
2. 배지행: no cloud / no watermark / no subscription · MIT · star-history
3. 60초 퀵스타트
4. 키워드강조자막 스크린샷
5. "How the AI editing works" 한 문단
   (whisper 단어 타임스탬프 → EDL → 결정적 렌더) ← HN/긱뉴스 군중에 어필
6. Why (OpenCut 대비 포지션) + Architecture
7. PoC 상태 솔직 명시
```

### 후크 카피 뱅크
- (헤더) "Your video never leaves your machine. The AI edits it for you."
- (한국어 헤더) "영상이 내 노트북을 떠나지 않습니다. AI가 대신 편집합니다."
- (서브) "Edit video like a document — delete a sentence, the clip vanishes."
- (배지) `100% local` · `no account` · `no watermark` · `no subscription` · `MIT`
- (투명성) "AI proposes the edit. You see the EDL/timeline. You tweak. Then render."

---

## 6. 런치 시퀀스 (소프트 → 스타부스트 → 런치)

> 원칙: **지금(PoC) 시작한다.** Onlook·OpenCut 모두 버그 있는 초기에 런칭. 완벽은 불필요, 모멘텀(스타차트)이 중요. 반복적이다.

### 단계 0 — 토대 (런치 전, 1~2주)
- README를 랜딩페이지로 재작성(섹션 5).
- 히어로 데모 클립(한/영) 제작(섹션 4).
- Awesome 리스트 등재(복리·저비용).
- 키워드강조자막 원클릭 프리셋 제품화(이미 어절/per-cue 보유 — 즉시 가능한 ROI top).

### 단계 1 — 소프트 런치 (한국 비치헤드)
- 긱뉴스 "Show" 글 1건 + 한국 유튜브 워크스루.
- 1차 타겟(P1)에 정밀 도달. 피드백 수집(특히 어떤 메시지가 스타를 끄는가).
- 한국 커뮤니티 오가닉 공유(아카라이브/클리앙).

### 단계 2 — 스타부스트 (글로벌 1차)
- Show HN(구체적 기술 제목, repo 링크, 이미지, 저자 댓글 상주, 업보트 요청 금지).
- r/LocalLLaMA + r/selfhosted(10% 룰).
- X build-in-public 클립 푸시 시작.
- **목표: 초기 스타차트 스파이크로 모멘텀 시드.**

### 단계 3 — 2차 패스 (메시지 샤프닝, ~6~8주 후)
- 1차에서 가장 반응 좋았던 메시지("local-first" / "no-cloud AI" / "edit by prompt")로 제목을 다듬어 HN/Reddit 2차.
- Onlook 사례: 2차 HN이 "local-first" 강조 제목으로 +1,000 스타.

### 단계 4 — 본 런치 (Product Hunt)
- 온보딩 매끄러워지고 폴리시된 데모 영상 준비된 뒤에만.
- (Phase 3 자연어 편집 MVP가 나오면 = 최강의 PH 런칭 타이밍.)

### 메시지 A/B 추적
각 런치마다 어떤 메시지 변형이 스타를 끄는지 측정 → 다음 패스에서 승자에 올인.

---

## 7. 콘텐츠 캘린더 골격

> 리듬: **shippable feature 1개 = 데모 클립 1개.** 빌드인퍼블릭이 콘텐츠 엔진이자 제품 QA.

### 주간 기본 리듬
- 월: 긱뉴스 Weekly 노출 체크 + 주간 빌드 회고(X 1포스트).
- 화~목: 진행 중 기능 빌드인퍼블릭(X), 진성 커뮤니티 참여(Reddit 10% 룰).
- 금: 그 주 shippable 기능의 데모 클립 1개 발행(X + repo).
- 격주: 유튜브 워크스루 또는 마이크로 클립 묶음.

### 분기 마일스톤 정렬 (master 로드맵 Phase 연동)
| 시기 | 콘텐츠 테마 | 정렬된 Phase |
|---|---|---|
| 런치 ~6주 | 텍스트편집 + 자막 + 무음컷 (현 자산) | Phase 0~1 |
| ~3개월 | dry-run/diff 미리보기 + 펀치인줌/색보정 데모 | Phase 2 |
| ~5개월 | 자연어 프롬프트 → 제안 타임라인 (에이전트 MVP) | Phase 3 — **PH 런칭 트리거** |
| ~7개월 | MCP 서버 + OTIO export 상호운용 | Phase 4 |

### 상시 콘텐츠 유형
- before/after 클립(가장 공유성 높음).
- "How it works" 기술 스레드(EDL/결정성 — P4 기여자 유입).
- CapCut 약관 비교 교육 콘텐츠(P1·P2 유입, 시의성).
- 사용자 제작 결과물 리포스트(소셜 프루프).

---

## 8. 측정 지표

### North Star
**주간 활성 export 사용자수** (실제 영상을 끝까지 만든 사람 = 진짜 채택). 단 PoC 초기엔 측정 인프라 부담 → 프록시로 **GitHub stars(모멘텀 신호)** 사용.

### 깔때기별 지표
| 단계 | 지표 | 초기 목표(예시) |
|---|---|---|
| 인지 | GitHub stars, X 임프레션, 긱뉴스/HN 프론트 도달 | 1차 런치 스파이크로 스타차트 시드 |
| 관심 | repo 방문 → README 데모 GIF 조회, 클릭스루 | 런치당 트래픽 스파이크 측정 |
| 시도 | release 다운로드 / clone, 첫 실행 | 다운로드 추이 |
| 전환 | **첫 export 완료**(실제 영상 산출) | 다운로드 대비 export 비율 |
| 유지 | 재방문 export, 기여자 수, 이슈/PR | 90+ 기여자(OpenCut 벤치) 장기 |
| 입소문 | Awesome 리스트 등재, 외부 멘션, 사용자 데모 리포스트 | 등재 수 + 멘션 수 |

### 측정 원칙 (프라이버시 일관성 유지)
- **무텔레메트리가 포지셔닝의 핵심** → 제품 내 사용자 추적을 강요하지 않는다. 측정은 **공개 신호**(GitHub stars/traffic insights, release 다운로드 카운트, 채널 임프레션) 위주.
- 제품 내 지표가 필요하면 **명시적 opt-in + 로컬 집계만**(프라이버시 약속을 깨면 메시지 신뢰 붕괴 — 섹션 9 리스크).
- 런치별로 "메시지 변형 → 스타 증가" 상관을 기록해 카피를 진화시킨다.

---

## 9. 마케팅 리스크 & 가드레일

- **과대주장 금지:** "완전 자율 AI 편집"으로 마케팅하면 신뢰 붕괴(2026 리서치: 자율 도구도 trim 정밀도·환각 한계). 항상 **"AI가 제안 → 당신이 EDL/타임라인 확인 → 승인 → 렌더"**로 프레이밍. 블랙박스 아님이 강점.
- **OpenCut 문구 회피:** "open-source CapCut"은 OpenCut 소유. 우리는 "local-first AI editor that edits by text and by prompt"를 소유.
- **OpenCut 잠식 헤지:** UI로 싸우지 말고 "결정적 EDL + property test + 데이터계약" 검증가능 신뢰성을 추가 해자로. 극단적으로 dawn-cut core/EDL/MCP를 "편집 두뇌 레이어"로 상호운용 포지션도 가능.
- **한국어 STT 증명 필요:** Vrew의 자막 UX 완성도에 밀리면 비치헤드 상실. whisper large-v3-turbo가 동급임을 **공개 검증 데모**로 증명. 자막 프리셋 다양성에 투자.
- **프라이버시 일관성:** 텔레메트리 도입 유혹을 거부. 측정조차 프라이버시 약속과 충돌하지 않게(섹션 8).
- **솔직함 = 자산:** PoC 상태를 숨기지 않는다. HN/긱뉴스에서 솔직함은 신뢰 자산.

---

## 부록 A — 카피 스니펫 (바로 사용)

**Show HN 제목 후보**
- `Show HN: dawn-cut – local AI video editor that edits by text (whisper.cpp + ffmpeg, no cloud)`
- `Show HN: dawn-cut – edit video like a document, 100% on your machine, MIT`

**긱뉴스 Show 제목 후보**
- `dawn-cut – 로컬에서 돌아가는 오픈소스 AI 비디오 에디터 (Vrew급 자동자막, 무제한·무료)`
- `dawn-cut – 영상을 문서처럼 편집, 데이터는 내 PC 밖으로 안 나감 (whisper.cpp + ffmpeg, MIT)`

**X 클립 캡션 후보**
- "Raw 18-min recording → one sentence → tight captioned cut. All local. No upload. (Edited in dawn-cut itself.)"
- "Vrew는 클라우드에 올립니다. dawn-cut은 안 올립니다. 자막은 똑같이 자동. (이 클립도 dawn-cut으로 편집했습니다.)"

**Product Hunt 태그라인**
- "The open-source AI video editor that edits by prompt — and never uploads your footage."

---

## 부록 B — 채널별 첫 행동 체크리스트

- [ ] README 재작성 + 히어로 GIF 임베드 (섹션 5)
- [ ] 히어로 데모 클립 한/영 2종 (dawn-cut으로 제작)
- [ ] Awesome-Self-hosted / Awesome-OSS-alternatives / Awesome-video PR
- [ ] 키워드강조자막 원클릭 프리셋 제품화
- [ ] 긱뉴스 Show 초안 + 한국 유튜브 워크스루
- [ ] Show HN 초안(구체적 기술 제목, repo 링크, 이미지)
- [ ] r/LocalLLaMA · r/selfhosted 진성 참여 시작(런치 전 평판 축적)
- [ ] X build-in-public 계정 활성화 + 첫 데모 클립
- [ ] star-history 배지 + GitHub traffic insights 모니터링 셋업
