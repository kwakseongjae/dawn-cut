// 타임라인 필름스트립·파형 매핑 — 순수 함수(DOM 무관). 소스 좌표(µs)의 썸네일/피크를
// 클립 블록의 %-좌표로 사상한다. 클립 좌표계가 %라 줌과 무관하게 정확(B1과 동일 철학).

export interface FilmSlice {
  /** 썸네일 인덱스(0-base, thumbs 배열 인덱스) */
  index: number;
  leftPct: number;
  widthPct: number;
}

/**
 * 클립의 소스 구간 [sourceStartUs, sourceEndUs)에 걸치는 썸네일 조각들.
 * 경계 썸네일은 블록 밖으로 삐져나가는 leftPct(<0 가능)로 반환 — 렌더 쪽 overflow:hidden이 크롭.
 */
export function filmstripSlices(
  thumbIntervalUs: number,
  thumbCount: number,
  sourceStartUs: number,
  sourceEndUs: number,
): FilmSlice[] {
  const len = sourceEndUs - sourceStartUs;
  if (thumbIntervalUs <= 0 || thumbCount <= 0 || len <= 0) return [];
  const out: FilmSlice[] = [];
  const first = Math.max(0, Math.floor(sourceStartUs / thumbIntervalUs));
  for (let i = first; i < thumbCount && i * thumbIntervalUs < sourceEndUs; i++) {
    out.push({
      index: i,
      leftPct: ((i * thumbIntervalUs - sourceStartUs) / len) * 100,
      widthPct: (thumbIntervalUs / len) * 100,
    });
  }
  return out;
}

/** 클립 소스 구간의 피크 슬라이스(0..1) — maxPoints 이하로 다운샘플(구간 max 보존). */
export function peakSlice(
  peaks: number[],
  peaksPerSec: number,
  sourceStartUs: number,
  sourceEndUs: number,
  maxPoints = 400,
): number[] {
  if (peaks.length === 0 || peaksPerSec <= 0 || sourceEndUs <= sourceStartUs) return [];
  const from = Math.max(0, Math.floor((sourceStartUs / 1e6) * peaksPerSec));
  const to = Math.min(peaks.length, Math.ceil((sourceEndUs / 1e6) * peaksPerSec));
  const slice = peaks.slice(from, to);
  if (slice.length <= maxPoints) return slice;
  // 버킷 max 다운샘플 — 피크는 평균 내면 뭉개진다.
  const out: number[] = [];
  const bucket = slice.length / maxPoints;
  for (let b = 0; b < maxPoints; b++) {
    const s = Math.floor(b * bucket);
    const e = Math.min(slice.length, Math.max(s + 1, Math.floor((b + 1) * bucket)));
    let m = 0;
    for (let i = s; i < e; i++) if ((slice[i] ?? 0) > m) m = slice[i] ?? 0;
    out.push(m);
  }
  return out;
}

/**
 * 중앙 대칭 파형 area path. viewBox "0 0 N 2"(중심 y=1) + preserveAspectRatio:none 전제 —
 * 줌으로 블록 폭이 변해도 SVG가 CSS 스케일만 되므로 재계산이 없다.
 */
export function wavePathD(peaks: number[]): string {
  if (peaks.length === 0) return '';
  const MIN = 0.04; // 무음도 가는 심지로 보이게
  const upper = peaks.map((p, i) => `L${i} ${(1 - Math.max(MIN, p)).toFixed(3)}`).join('');
  const lower = [...peaks]
    .map((p, i) => `L${i} ${(1 + Math.max(MIN, p)).toFixed(3)}`)
    .reverse()
    .join('');
  return `M0 1${upper}${lower}Z`;
}
