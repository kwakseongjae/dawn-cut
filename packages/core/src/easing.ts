/** Named easing curves (subset of CSS / Material): power-based, expressible in ffmpeg. */
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back';

// back(오버슈트) 계수 — CSS easeOutBack(c1=1.70158)과 동일. 쇼츠 팝인의 '통통' 느낌.
const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;

/** Map a linear progress u (an ffmpeg-expression substring in [0,1]) to an eased value. */
export function easeExpr(easing: Easing, u: string): string {
  switch (easing) {
    case 'linear':
      return u;
    case 'easeIn':
      return `pow(${u},2)`;
    case 'easeOut':
      return `(1-pow(1-${u},2))`;
    case 'easeInOut':
      return `(3*pow(${u},2)-2*pow(${u},3))`;
    case 'back':
      // easeOutBack: 1 + c3*(u-1)^3 + c1*(u-1)^2 — 1을 살짝 넘었다가 정착(오버슈트).
      return `(1+${BACK_C3}*pow(${u}-1,3)+${BACK_C1}*pow(${u}-1,2))`;
  }
}

/** Numeric reference implementation (for unit tests and the CSS preview layer). */
export function easeNumber(easing: Easing, u: number): number {
  const c = Math.min(1, Math.max(0, u));
  switch (easing) {
    case 'linear':
      return c;
    case 'easeIn':
      return c * c;
    case 'easeOut':
      return 1 - (1 - c) * (1 - c);
    case 'easeInOut':
      return 3 * c * c - 2 * c * c * c;
    case 'back':
      return 1 + BACK_C3 * (c - 1) ** 3 + BACK_C1 * (c - 1) ** 2;
  }
}
