/** Named easing curves (subset of CSS / Material): power-based, expressible in ffmpeg. */
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

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
  }
}
