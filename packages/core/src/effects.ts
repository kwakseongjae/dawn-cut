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

/** 색보정 프리셋 이름. */
export type ColorPreset = 'warm' | 'cool' | 'punch' | 'cinematic' | 'flat' | 'vivid';

/** 명시적 eq 파라미터(자동 보정이 계산해 기록하는 값). 1=항등(밝기는 0=항등). */
export interface ColorEq {
  contrast?: number;
  saturation?: number;
  brightness?: number;
  gamma?: number;
}

/**
 * 색보정 적용. 두 모드:
 *  - preset: 명명된 프리셋을 intensity(0~1)로 가중(기존 동작).
 *  - eq: 명시적 eq 파라미터를 직접 적용(자동 보정 등 '계산된 그레이드'). preset보다 우선한다.
 */
export interface ColorEffect {
  kind: 'color';
  preset?: ColorPreset;
  /** 0~1. 생략 시 1. 0이면 사실상 패스스루(null 필터). eq 모드에도 가중으로 적용된다. */
  intensity?: number;
  /** 명시적 eq 파라미터. 있으면 preset 대신 이걸 적용(자동 보정 결과를 EDL에 그대로 기록). */
  eq?: ColorEq;
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
export const COLOR_PRESETS: Record<ColorPreset, string> = {
  warm: "curves=r='0/0 0.5/0.58 1/1':g='0/0 0.5/0.5 1/1':b='0/0 0.5/0.42 1/1'",
  cool: "curves=r='0/0 0.5/0.42 1/1':g='0/0 0.5/0.5 1/1':b='0/0 0.5/0.58 1/1'",
  punch: 'eq=contrast=1.30:saturation=1.40:brightness=0.02',
  cinematic: "eq=contrast=1.30:saturation=0.70,curves=all='0/0.06 0.5/0.5 1/0.92'",
  flat: 'eq=contrast=0.82:saturation=0.78:gamma=1.05',
  // vivid: '1탭 화사 보정' — 채도 강하게 + 약한 대비/리프트 + 살짝 웜틸트(음식/인물/풍경 두루 '확 산다').
  vivid:
    "eq=contrast=1.15:saturation=1.60:brightness=0.03,curves=r='0/0 0.5/0.54 1/1':b='0/0 0.5/0.46 1/1'",
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

  // eq 모드(자동 보정 등 계산된 그레이드): 명시적 파라미터를 직접 가중 적용. preset보다 우선.
  if (e.eq) {
    if (k <= 0) return 'eq=contrast=1';
    const out = eqWeighted(e.eq, k);
    return out === 'eq=' ? 'eq=contrast=1' : out; // 정의된 파라미터가 없으면 항등(체인 안전)
  }

  const preset: ColorPreset = e.preset && e.preset in COLOR_PRESETS ? e.preset : 'flat';

  if (k <= 0) return 'eq=contrast=1'; // 패스스루(항등) — 체인 안전

  switch (preset) {
    case 'punch':
      return eqWeighted({ contrast: 1.3, saturation: 1.4, brightness: 0.02 }, k);
    case 'flat':
      return eqWeighted({ contrast: 0.82, saturation: 0.78, gamma: 1.05 }, k);
    case 'cinematic': {
      // COLOR_PRESETS.cinematic 테이블(contrast 1.30 / saturation 0.70 / 리프트 0.06·하이라이트 0.92)과
      // 정확히 일치시킨다. 이전 코드가 1.2/0.85로 약하게 렌더돼 결과가 'subtle'했던 불일치를 교정.
      const eq = eqWeighted({ contrast: 1.3, saturation: 0.7 }, k);
      const lift = num(0 + (0.06 - 0) * k, 4);
      const high = num(1 + (0.92 - 1) * k, 4);
      const curve = `curves=all='0/${lift} 0.5/0.5 1/${high}'`;
      return `${eq},${curve}`;
    }
    case 'warm':
      return warmCoolCurve('warm', k);
    case 'cool':
      return warmCoolCurve('cool', k);
    case 'vivid': {
      // 강한 채도/약한 대비/리프트 + 가벼운 웜 커브. punch보다 채도↑·대비↓로 '화사하게 산다'.
      const eq = eqWeighted({ contrast: 1.15, saturation: 1.6, brightness: 0.03 }, k);
      const r = num(0.5 + (0.54 - 0.5) * k, 4);
      const b = num(0.5 + (0.46 - 0.5) * k, 4);
      const curve = `curves=r='0/0 0.5/${r} 1/1':b='0/0 0.5/${b} 1/1'`;
      return `${eq},${curve}`;
    }
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
 * ffmpeg signalstats 가 측정한 영상 통계(적응형 자동 보정의 입력).
 * 휘도는 0~255, 채도는 signalstats SATAVG 스케일(실측상 평이한 영상 ≈ 5~60).
 */
export interface VideoStats {
  /** 평균 휘도(YAVG, 0~255). */
  yavg: number;
  /** 최저 휘도(YMIN, 0~255). */
  ymin: number;
  /** 최고 휘도(YMAX, 0~255). */
  ymax: number;
  /** 평균 채도(SATAVG). */
  satavg: number;
}

const round3 = (n: number): number => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);

/**
 * '1탭 자동 보정' — 측정된 영상 통계를 보기 좋은 eq 파라미터로 매핑하는 순수 함수.
 *
 * 설계 원칙:
 *  - 결정적: 동일 통계 → 동일 출력(round3로 부동소수 고정).
 *  - 항상 개선 방향: contrast/saturation/gamma ≥ 1, 어두우면 밝히고, 둔하면 화사하게.
 *  - 안전 클램프: 어떤 입력에도 과보정으로 화면이 깨지지 않게 상·하한을 둔다.
 *
 * 매핑(실측 보정):
 *  - 밝기: 평균 휘도를 목표(132)로 끌어올리되 가산값을 [-0.10, 0.16]로 제한.
 *  - 대비: 휘도 분포가 좁으면(플랫) 키우고, 넓으면 건드리지 않음(1.0~1.30).
 *  - 채도: 둔한 영상(낮은 SATAVG)일수록 더 화사하게(1.0~1.50).
 *  - 감마: 어둡거나 그림자가 뭉개졌을 때만 중간톤을 살짝 들어올림(1.0~1.18).
 *
 * 결과는 applyAutoEnhance verb의 eq로 ColorEffect에 기록되어 EDL이 정확한 값을
 * 재현한다(길이 불변=비파괴). colorFilter(eq)가 ffmpeg `eq=` 로 렌더한다.
 */
export function autoEnhanceParams(stats: VideoStats): ColorEq {
  const yavg = clamp(stats.yavg, 0, 255);
  const ymin = clamp(stats.ymin, 0, 255);
  const ymax = clamp(stats.ymax, ymin + 1, 255);
  const satavg = clamp(stats.satavg, 0, 255);

  // 밝기(가산): 목표 132로 끌되 과보정 방지.
  const brightness = clamp(((132 - yavg) / 255) * 0.55, -0.1, 0.16);
  // 대비(곱셈): 분포가 좁을수록 키우고 1.0 미만으로는 내리지 않음.
  const spread = (ymax - ymin) / 255;
  const contrast = clamp(1 + (0.8 - spread) * 0.55, 1.0, 1.3);
  // 채도(곱셈): SATAVG 64를 '충분'으로 보고, 둔할수록 더 화사하게.
  const saturation = clamp(1 + (1 - satavg / 64) * 0.4, 1.0, 1.5);
  // 감마(곱셈): 어둡거나 그림자가 뭉개졌을 때만 중간톤 리프트.
  const gamma = yavg < 115 || ymin < 10 ? clamp(1 + (120 - yavg) / 700, 1.0, 1.18) : 1.0;

  return {
    contrast: round3(contrast),
    saturation: round3(saturation),
    brightness: round3(brightness),
    gamma: round3(gamma),
  };
}

/**
 * 이펙트 하나를 적절한 빌더로 디스패치하는 편의 함수.
 * zoom 은 fps 가 필요하므로 인자로 받는다(color 는 무시).
 */
export function effectFilter(e: ClipEffect, fps: number): string {
  return e.kind === 'zoom' ? zoomFilter(e, fps) : colorFilter(e);
}
