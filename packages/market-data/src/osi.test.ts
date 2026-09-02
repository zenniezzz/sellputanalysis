import { describe, expect, it } from 'vitest';
import { parseOptionSymbol, toOccSymbol } from './osi.js';

describe('parseOptionSymbol', () => {
  it('parses the compact CBOE form', () => {
    expect(parseOptionSymbol('AAPL240920P00185000')).toEqual({
      root: 'AAPL',
      expiration: '2024-09-20',
      right: 'P',
      strike: 185,
    });
  });

  it('parses a fractional strike', () => {
    expect(parseOptionSymbol('SPY251219C00512500').strike).toBe(512.5);
  });

  it('parses the padded 21-char form', () => {
    const p = parseOptionSymbol('AAPL  240920P00185000');
    expect(p.root).toBe('AAPL');
    expect(p.strike).toBe(185);
  });

  it('round-trips through toOccSymbol', () => {
    const parsed = parseOptionSymbol('NVDA260116P00090000');
    const occ = toOccSymbol(parsed);
    expect(occ).toHaveLength(21);
    expect(parseOptionSymbol(occ)).toEqual(parsed);
  });

  it('throws on garbage', () => {
    expect(() => parseOptionSymbol('not-a-symbol')).toThrow();
  });
});
