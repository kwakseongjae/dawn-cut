# Cycle-0 STT 한국어 어절 게이트 — 판정 및 구현 스펙 (2026-05-29)

## 1. 게이트 판정: PASS_WITH_FIXES

어절 재조립 **알고리즘** 게이트는 통과한다. base **모델** 어휘정확도는 별개 이슈로 분리 판단(게이트 질문 B).

### 실측 재현 (조작 없음 확인)
- 전략 A 프로토타입 `/tmp/eojeol-A-natural.mjs` 직접 재실행 → 보고된 수치 비트 단위 일치: positional 42.86%(12/28), **LCS word-accuracy 75.00%(21/28)**, mojibake **0**.
- 전략 C 프로토타입 `/tmp/eojeol-C-linguistic.mjs` 재실행 → 92.86%(26/28) 재현.
- 내가 작성한 보정 프로덕션 함수를 `artifacts/stt-spike/natural.json`에 node로 실행 → 어절 27개, T-INV-2/3/4 위반 **0**, mojibake **0**, LCS 75.00%, zero-width '이' 5500000→5501000µs 클램프, '몸' confidence 0.134로 플래그. 레포 `tsconfig.base.json`(strict + noUncheckedIndexedAccess)로 `tsc` 통과(exit 0).

### 왜 PASS인가
머지 알고리즘 자체 결함은 **0개**다. char-accuracy 96.59%(3 char-edit/88)이고 그 3개(`.`→`?`, 무음→몸)와 word 불일치 7건은 **전부 base 모델 토큰스트림 산물**(어휘오인식, 모델 머지 '만들어줍니다', 모델 띄어쓰기 '한 번'/'써보세요', 구두점 선택). 알고리즘은 whisper 토큰 경계를 무손실 충실 재현한다(whole-stream decode = 원문 완벽복원).

### 왜 FIXES인가 (적대검증이 잡은 실재 break)
1. **(중대)** 전략 A: 여는 구두점(`"`, `(`) 드롭 → 비대칭 괄호. 무손실 깨짐.
2. **(중대)** 전략 B: 비단조 offset(whisper 타임스탬프 리셋/환각) 무가드 → T-INV-2 위반 노출.
3. **★(중대)** 전략 C: 보조용언 분리가 **over-fit 머신**. matchAux 직접 재현 결과 명사 **'바보'→'바|보'**, 비교격 **'저보다'→'저|보다'**, **'가보다'→'가|보다'** 오분리(false positive), 정작 ㅘ/ㅝ 중성의 정당한 **'와주세요'/'줘봐'는 못 잡음**(false negative). 92.86%는 단일 13.7s 클립 신기루.
4. (경미) 다중 선행공백 잔존, zero-width 토큰 from==to, 특수토큰 brittleness([A-Z]만 매칭, id 미활용).

→ 전부 winningTsCode에 반영해 수정 완료(실측 검증).

## 2. 권장 알고리즘: 전략 A (C 거부, B 보류)

- **A 채택**: 자연모드(-ml 제거) + tokens[] leading-space(▁) 머지. 무손실, per-token offsets 존재(바이트 재조립 불필요), 문장 경계 보존, 단순. 5개 break 국소 수정으로 프로덕션 가능.
- **C 거부**: 92.86%는 매력적이나 보조용언 규칙이 실사용 한국어를 적극 손상. 형태소 분석기(mecab-ko/khaiii) 없이 프로덕션 불가. C의 베이스(=A)만 가치 있음.
- **B 보류**: latin-1 바이트 재조립은 무손실이나 자연모드에선 불필요, 문장 경계 소실, 비단조 무가드. '-ml 1 못 바꿀 때' 비상 fallback로만.

보정 함수는 A 베이스 + ID/구두점 흡착 견고화(C가 옳게 한 부분) + 비단조 클램프(B 검증서 배운 것)를 단일 함수로 통합.

## 3. 모델 전략 (단계적)

| 단계 | 조치 | 근거(실측/리서치) |
|---|---|---|
| Phase 0 | 백엔드 유지(whisper.cpp+Metal+flash-attn) | CMakeCache GGML_METAL=ON, 런타임 'use gpu=1','flash attn=1','M5 Pro'. CoreML/faster-whisper/MLX 전부 비권장 |
| **1순위** | base→**large-v3-turbo**(~1.6GB) | 로컬 실측: '몸→무음' 교정, '한번'·구두점 복원. 18분 ~30s. '교정필요'→'경미검수' 전환 |
| 대안 | 한국어 medium 파인튜닝 GGML(royshilkrot 사전변환 우선, 또는 seastar105 zeroth CER 1.48% 변환+q5_0 ~515MB) | 유튜브 잡음 일반화는 voice.wav 검증 필수 |
| 운영 | 사이드카 warm-keep + VAD(vendored silero) | 모델 로드 per-call 회피, 무음 선제거 |

가속(CoreML/MLX/faster-whisper)은 **추격하지 말 것**: 이미 Metal GPU 풀가속, 18분이 fire-and-forget(base 15s/turbo 30s).

## 4. 구현 계획

### packages/core/src/whisper.ts (신규, 순수 TS)
`whisperNaturalToWords(json, {mediaId, makeId?, msToUs?, minDurationUs?}) → Word[]`. node 의존 0, 결정적 id, T-INV-2/3/4 보장. (winningTsCode 참조). index.ts에 `export * from './whisper.js';` 추가.

### sidecar/stt/src/index.ts 변경
- L47~59: `-ml`,`'1'` 삭제(자연모드). `-ojf`(full json) 유지.
- L67~86: 수동 Word 루프 → `whisperNaturalToWords(json, {mediaId})` 한 줄. randomUUID/isWordToken 제거.
- L13~14: 모델 기본값 large-v3-turbo 또는 한국어 GGML 검토(별도 PR).
- 자연모드 출력은 유효 UTF-8 → readFile 'utf8' 정상. ml1.json 바이트파편 문제 원천 해소.

## 5. 추가할 테스트
- **core 단위**: 레퍼런스 어절 복원(27개), T-INV-2(비단조 입력 클램프), T-INV-3(zero-width '이' 클램프), T-INV-4, mojibake 0, 특수토큰 견고성(id≥50257/대소문자/<|..|>), 여는 구두점 무손실, 다중공백, **영문/숫자 혼용('DawnCut','v2','2026년')**, 결정적 id, confidence 플래그, **C over-split 회귀 가드('바보'/'저보다' 1어절 유지)**, buildTranscriptModel+validateTranscript 통합.
- **통합**: g2-stt 자연모드 갱신(recall≥0.90, id 'fixture:wN'), g2-stt-korean 신규(voice.wav mojibake 0, LCS baseline 기록).

## 6. 포지셔닝 함의

알고리즘 PASS로 "자막 깨짐"은 완전 해결 → Vrew 대안의 **필요조건** 충족. 그러나 base word LCS 75%(위치 42.86%)는 무검수 자동자막엔 부족 → 현 정직한 포지셔닝은 **"로컬·프라이버시·제로비용 특화 보완재 + 자동초안→사람 검수"**. 차별점 3개 모두 실측 뒷받침: 100% 로컬(프라이버시/비용 0), 18분 ~30s(M5 Pro 36~72x), confidence 기반 저신뢰 어절 자동 하이라이트('몸' 0.134)='AI가 의심구간 짚어주는 검수기' 서사. **large-v3-turbo/한국어 medium 교체로 '몸·한번·구두점' 교정 시 "대안" 포지셔닝 전환 가능** — 모델 업그레이드가 트리거.

## 7. 다음 단계
1. core/src/whisper.ts + 테스트 머지(이번 게이트 산출물, 즉시).
2. sidecar -ml 제거 + 함수 연결, g2-stt 자연모드 갱신.
3. large-v3-turbo 다운로드 옵션 + voice.wav 재측정 PR → LCS/어휘 개선 정량화 → 포지셔닝 재판정.
4. (장기) 영문/다화자/긴오디오/잡음 클립으로 일반화 측정(현 N=4문장 한정, 신뢰구간 넓음).