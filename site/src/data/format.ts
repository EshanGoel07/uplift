// Number formatting. Inputs are fractions; outputs use a true minus sign (U+2212).

const MINUS = '−';

const signed = (x: number, digits: number, forceSign = true): string => {
  const v = Number(x.toFixed(digits));
  const abs = Math.abs(v).toFixed(digits);
  if (v === 0) return (forceSign ? '+' : '') + abs;
  return (v < 0 ? MINUS : forceSign ? '+' : '') + abs;
};

/** 0.72727 -> "72.7%" */
export const pct = (frac: number, digits = 1): string => `${(frac * 100).toFixed(digits)}%`;

/** -0.00649 -> "−0.6" (percentage points, signed) */
export const pts = (frac: number, digits = 1): string => signed(frac * 100, digits);

/** -0.00649 -> "−0.6 pts" */
export const ptsLabel = (frac: number, digits = 1): string => `${pts(frac, digits)} pts`;

/** (-0.05844, 0.04545) -> "−5.8 to +4.5" */
export const ci = (lo: number, hi: number, digits = 1): string => `${pts(lo, digits)} to ${pts(hi, digits)}`;

/** points already in points: -3.2 -> "−3.2" */
export const signedPoints = (p: number, digits = 1): string => signed(p, digits);

/** 0.0312 -> "$0.0312"; 21.31 -> "$21.31" */
export const usd = (x: number, digits?: number): string => {
  const d = digits ?? (x < 1 ? 4 : 2);
  return `$${x.toFixed(d)}`;
};

export const int = (n: number): string => n.toLocaleString('en-US');
