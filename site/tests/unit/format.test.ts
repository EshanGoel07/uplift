import { describe, expect, it } from 'vitest';
import { ci, pct, pts, ptsLabel, usd } from '../../src/data/format';

describe('formatters', () => {
  it('formats fractions as percentages', () => {
    expect(pct(0.72727)).toBe('72.7%');
    expect(pct(0.69481)).toBe('69.5%');
  });
  it('formats differences as signed points with a true minus', () => {
    expect(pts(-0.00649)).toBe('−0.6');
    expect(pts(0.00649)).toBe('+0.6');
    expect(pts(0)).toBe('+0.0');
    expect(pts(-0.0001)).toBe('+0.0');
    expect(ptsLabel(-0.03247)).toBe('−3.2 pts');
  });
  it('formats intervals', () => {
    expect(ci(-0.05844, 0.04545)).toBe('−5.8 to +4.5');
    expect(ci(-0.09091, 0.01299)).toBe('−9.1 to +1.3');
  });
  it('formats money', () => {
    expect(usd(0.0312)).toBe('$0.0312');
    expect(usd(21.31)).toBe('$21.31');
  });
});
