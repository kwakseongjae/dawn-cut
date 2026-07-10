// 타임라인 눈금(ruler) 스케일 — 순수 함수. 줌 레벨에 따라 "사람이 읽기 좋은" 주눈금
// 간격(0.1s~10m 단계)을 골라 틱 목록을 만든다. UI/테스트 공용(DOM 무관).

export interface RulerTick {
  us: number;
  major: boolean;
  /** 주눈금에만 존재 — M:SS(짧으면 M:SS.d) */
  label?: string;
}

/** 사람이 읽기 좋은 간격 사다리(µs). 0.1s → 10m. */
const STEP_LADDER_US = [
  100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 15_000_000, 30_000_000,
  60_000_000, 120_000_000, 300_000_000, 600_000_000,
] as const;

/** 주눈금 간 최소 픽셀(라벨이 겹치지 않는 밀도). */
export const MIN_MAJOR_PX = 72;

/** 트랙 폭(px)과 길이(µs)에서 주눈금 간격을 고른다. 폭/길이 0 이하면 0. */
export function chooseTickStep(
  durationUs: number,
  trackPx: number,
  minMajorPx = MIN_MAJOR_PX,
): number {
  if (durationUs <= 0 || trackPx <= 0) return 0;
  const usPerPx = durationUs / trackPx;
  const minStepUs = usPerPx * minMajorPx;
  for (const step of STEP_LADDER_US) if (step >= minStepUs) return step;
  return STEP_LADDER_US[STEP_LADDER_US.length - 1] ?? 0;
}

/** 틱 시각 라벨 — 1s 미만 간격이면 소수 1자리(M:SS.d), 1h 넘으면 H:MM:SS. */
export function fmtTick(us: number, stepUs: number): string {
  const totalSec = us / 1e6;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const sec =
    stepUs < 1_000_000 ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * 눈금 목록. 주눈금 = step 간격(라벨 포함), 보조눈금 = step/5 (8px 이상 확보될 때만).
 * 마지막 주눈금은 duration을 넘지 않는다(트랙 밖 라벨 방지).
 */
export function rulerTicks(
  durationUs: number,
  trackPx: number,
  minMajorPx = MIN_MAJOR_PX,
): RulerTick[] {
  const step = chooseTickStep(durationUs, trackPx, minMajorPx);
  if (step <= 0) return [];
  const minor = step / 5;
  const minorPx = (minor / durationUs) * trackPx;
  const useMinor = minorPx >= 8;
  const ticks: RulerTick[] = [];
  const unit = useMinor ? minor : step;
  for (let t = 0, i = 0; t <= durationUs; t = ++i * unit) {
    const major = !useMinor || i % 5 === 0;
    ticks.push({ us: Math.round(t), major, label: major ? fmtTick(t, step) : undefined });
  }
  return ticks;
}
