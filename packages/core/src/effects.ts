/**
 * 클립 이펙트 → ffmpeg 필터 표현식 빌더 (순수 TS).
 *
 * 두 가지 "와우" 이펙트를 ffmpeg 8.x 필터 문자열로 변환한다:
 *  - 펀치인 줌(punch-in zoom): `zoompan` 으로 from→to 배율을 시간 선형보간.
 *  - 색보정(color grading): `eq`/`curves` 프리셋을 intensity(0~1)로 가중.
 *
 * 이 모듈은 모델(데이터) → 문자열(필터)만 담당한다. EDL 세그먼트에 어떤
 * 이펙트를 언제 붙일지 결정하고 filter_complex 그래프에 배선하는 일은
 * 메인(렌더 파이프라인) 쪽 책임이다. 따라서 여기서 만든 fragment 는
 * 단일 비디오 스트림에 체인으로 연결 가능한 형태(라벨 없음)로 반환한다.
 *
 * 결정성: 동일 입력 → 동일 문자열. 부동소수 출력은 고정 자릿수로 포맷한다.
 * 가드: 음수/0-division/범위를 모두 클램프하여 ffmpeg 가 깨지지 않게 한다.
 */

/** 펀치인(또는 펀치아웃) 줌. from→to 배율을 [startUs,endUs) 구간에서 선형보간. */
export interface ZoomEffect {
  kind: 'zoom';
  /** 시작 배율(>=1 권장. 1=원본). */
  from: number;
  /** 종료 배율(>=1 권장). from<to=줌인, from>to=줌아웃. */
  to: number;
  /** 프로그램 시간 시작(µs, 포함). */
  startUs: number;
  /** 프로그램 시간 끝(µs, 미포함). */
  endUs: number;
}

/** 색보정 프리셋 적용. intensity 로 효과 강도를 0(원본)~1(프리셋 풀강도) 가중. */
export interface ColorEffect {
  kind: 'color';
  preset: 'warm' | 'cool' | 'punch' | 'cinematic' | 'flat';
  /** 0~1. 생략 시 1. 0이면 사실상 패스스루(null 필터). */
  intensity?: number;
}

export type ClipEffect = ZoomEffect | ColorEffect;

/** 부동소수를 결정적 고정 자릿수로. -0 정규화. */
const num = (n: number, digits = 4): string => {
  const v = Number.isFinite(n) ? n : 0;
  const s = v.toFixed(digits);
  return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s;
};

/** [lo,hi] 범위로 클램프(NaN/Infinity 방어 포함). */
const clamp = (n: number, lo: number, hi: number): number => {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * 펀치인 줌 필터 fragment 를 만든다 (`zoompan`).
 *
 * zoompan 은 출력 프레임 번호 `on` 으로 z(배율)/x/y 를 매 프레임 평가한다.
 * 구간 길이를 프레임 수 `D = round(dur * fps)` 로 환산하고, 진행도
 * `p = clip(on/(D-1), 0, 1)` 로 from→to 를 선형보간한다(결정적).
 * 화면 중앙을 고정점으로 유지하기 위해 x/y 는 (iw - iw/zoom)/2 공식을 쓴다.
 *
 * 가드:
 *  - from/to 는 1 미만이면 1로 클램프(zoompan 은 축소 미지원 → 검은 테두리 방지).
 *  - 두 배율 모두 상한(8x)으로 클램프.
 *  - dur<=0 또는 D<2 이면 단일 프레임 정적 줌(0-division 방지).
 *
 * @param e   줌 이펙트 모델
 * @param fps 출력 프레임레이트(>0). EDL.fps 와 일치시켜야 시간이 맞는다.
 * @returns   `zoompan=...` 단일 필터(라벨 없음). 비디오 스트림에 체인 연결.
 */
export function zoomFilter(e: ZoomEffect, fps: number): string {
  const ZMAX = 8;
  const from = clamp(e.from, 1, ZMAX);
  const to = clamp(e.to, 1, ZMAX);
  const f = clamp(fps, 1, 1000);

  const durUs = e.endUs - e.startUs;
  const durSec = durUs > 0 ? durUs / 1_000_000 : 0;
  // 출력 프레임 수. 최소 1.
  const frames = Math.max(1, Math.round(durSec * f));
  const D = Math.max(1, frames);

  // 진행도 p ∈ [0,1]. D<2 면 정적(분모 0 방지).
  const denom = D - 1;
  const p = denom > 0 ? `(min(on,${denom})/${denom})` : '0';
  // z = from + (to-from)*p  (정적이면 from 상수)
  const zExpr =
    from === to || denom <= 0 ? num(from) : `(${num(from)}+(${num(to)}-${num(from)})*${p})`;

  // 중앙 고정: x = (iw - iw/zoom)/2, y 동일. zoom 변수는 zoompan 내부 z 값.
  // zoompan 표현식 안에서 'zoom' 은 현재 z 를 가리킨다.
  const xExpr = '(iw-iw/zoom)/2';
  const yExpr = '(ih-ih/zoom)/2';

  // d=1: 입력 1프레임당 출력 1프레임(트리밍된 세그먼트에 1:1 매핑).
  // s(출력크기)는 생략 → zoompan 이 입력 해상도를 그대로 사용(인플레이스 줌).
  // fps 옵션으로 출력 레이트를 명시(결정적).
  return `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:fps=${f}`;
}

/**
 * 색보정 프리셋 정의 테이블.
 *
 * 각 값은 intensity=1(풀강도)일 때의 ffmpeg 필터 문자열이다. intensity 가중은
 * colorFilter() 가 동적으로 수행하므로, 여기 문자열은 "참조용 풀강도 표현"이다.
 * 토큰으로 `eq`(밝기/대비/채도/감마) 또는 `curves`(톤 커브)를 쓴다.
 *
 *  - warm:      따뜻한 톤(레드/그린 게인↑, 블루 게인↓) — curves.
 *  - cool:      차가운 톤(블루↑, 레드↓) — curves.
 *  - punch:     대비+채도 강조(쇼츠/유튜브 썸네일 느낌) — eq.
 *  - cinematic: 대비↑ 채도↓ 약한 리프트(필름룩) — eq + curves.
 *  - flat:      Log 풍의 평탄화(대비↓ 채도↓, 그레이딩 여지) — eq.
 */
export const COLOR_PRESETS: Record<ColorEffect['preset'], string> = {
  warm: "curves=r='0/0 0.5/0.58 1/1':g='0/0 0.5/0.5 1/1':b='0/0 0.5/0.42 1/1'",
  cool: "curves=r='0/0 0.5/0.42 1/1':g='0/0 0.5/0.5 1/1':b='0/0 0.5/0.58 1/1'",
  punch: 'eq=contrast=1.30:saturation=1.40:brightness=0.02',
  cinematic: "eq=contrast=1.30:saturation=0.70,curves=all='0/0.06 0.5/0.5 1/0.92'",
  flat: 'eq=contrast=0.82:saturation=0.78:gamma=1.05',
};

/**
 * 색보정 필터 fragment 를 만든다 (`eq` 또는 `curves` 프리셋, intensity 가중).
 *
 * intensity(0~1)는 "원본 ↔ 풀강도 프리셋" 사이의 선형 보간으로 해석한다.
 *  - eq 계열: 1을 항등으로 보는 파라미터(contrast/saturation/gamma)는
 *    `1 + (full-1)*k`, 0을 항등으로 보는 파라미터(brightness)는 `full*k` 로 가중.
 *  - curves 계열: 중간점(0.5)의 변위를 `0.5 + (full-0.5)*k` 로 가중하여 끌어당김.
 *
 * 가드:
 *  - intensity 는 [0,1] 로 클램프. NaN/음수 → 0(=패스스루), >1 → 1.
 *  - intensity≈0 이면 빈 효과 대신 무해한 항등 필터 `eq=contrast=1` 을 반환
 *    (체인에서 빈 문자열로 끊기지 않게).
 *  - 알 수 없는 preset 은 flat 으로 폴백.
 *
 * @param e 색 이펙트 모델
 * @returns `eq=...` 또는 `eq=...,curves=...` 단일 필터 체인(라벨 없음).
 */
export function colorFilter(e: ColorEffect): string {
  const k = clamp(e.intensity ?? 1, 0, 1);
  const preset: ColorEffect['preset'] = e.preset in COLOR_PRESETS ? e.preset : 'flat';

  if (k <= 0) return 'eq=contrast=1'; // 패스스루(항등) — 체인 안전

  switch (preset) {
    case 'punch':
      return eqWeighted({ contrast: 1.3, saturation: 1.4, brightness: 0.02 }, k);
    case 'flat':
      return eqWeighted({ contrast: 0.82, saturation: 0.78, gamma: 1.05 }, k);
    case 'cinematic': {
      const eq = eqWeighted({ contrast: 1.2, saturation: 0.85 }, k);
      // 약한 리프트(블랙을 0.04로) + 하이라이트 살짝 누름.
      const lift = num(0 + (0.04 - 0) * k, 4);
      const high = num(1 + (0.96 - 1) * k, 4);
      const curve = `curves=all='0/${lift} 0.5/0.5 1/${high}'`;
      return `${eq},${curve}`;
    }
    case 'warm':
      return warmCoolCurve('warm', k);
    case 'cool':
      return warmCoolCurve('cool', k);
  }
}

/** eq 파라미터를 intensity 가중하여 `eq=...` 문자열 생성. */
function eqWeighted(
  full: { contrast?: number; saturation?: number; brightness?: number; gamma?: number },
  k: number,
): string {
  const parts: string[] = [];
  // 1을 항등으로 보는 곱셈 파라미터들.
  if (full.contrast != null) parts.push(`contrast=${num(1 + (full.contrast - 1) * k)}`);
  if (full.saturation != null) parts.push(`saturation=${num(1 + (full.saturation - 1) * k)}`);
  if (full.gamma != null) parts.push(`gamma=${num(1 + (full.gamma - 1) * k)}`);
  // 0을 항등으로 보는 덧셈 파라미터.
  if (full.brightness != null) parts.push(`brightness=${num(full.brightness * k)}`);
  return `eq=${parts.join(':')}`;
}

/** warm/cool 톤 커브를 중간점 변위 기준으로 intensity 가중. */
function warmCoolCurve(tone: 'warm' | 'cool', k: number): string {
  // 풀강도 중간점(0.5 입력에 대한 출력). warm=R/G↑ B↓, cool=반대.
  const fullR = tone === 'warm' ? 0.58 : 0.42;
  const fullB = tone === 'warm' ? 0.42 : 0.58;
  const r = num(0.5 + (fullR - 0.5) * k, 4);
  const g = '0.5'; // 그린은 항등 유지
  const b = num(0.5 + (fullB - 0.5) * k, 4);
  return `curves=r='0/0 0.5/${r} 1/1':g='0/0 0.5/${g} 1/1':b='0/0 0.5/${b} 1/1'`;
}

/**
 * 이펙트 하나를 적절한 빌더로 디스패치하는 편의 함수.
 * zoom 은 fps 가 필요하므로 인자로 받는다(color 는 무시).
 */
export function effectFilter(e: ClipEffect, fps: number): string {
  return e.kind === 'zoom' ? zoomFilter(e, fps) : colorFilter(e);
}
