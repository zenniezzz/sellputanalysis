import { describe, expect, it } from 'vitest';
import { normalizeDate, parseOratsIvHistoryCsv } from './iv-backfill.js';

describe('normalizeDate', () => {
  it('accepts ISO, US slash and compact forms', () => {
    expect(normalizeDate('2026-09-02')).toBe('2026-09-02');
    expect(normalizeDate('9/2/2026')).toBe('2026-09-02');
    expect(normalizeDate('20260902')).toBe('2026-09-02');
    expect(normalizeDate('garbage')).toBeNull();
  });
});

describe('parseOratsIvHistoryCsv', () => {
  it('maps ORATS column aliases to IvSample', () => {
    const csv = [
      'ticker,tradeDate,iv30d,orHv20d,orHv1yr,slope',
      'AAPL,2026-08-31,0.271,0.244,0.301,-0.018',
      'AAPL,09/01/2026,0.268,0.240,0.300,-0.017',
      'MSFT,2026-08-31,0.221,0.200,0.255,-0.012',
    ].join('\n');
    const out = parseOratsIvHistoryCsv(csv);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      symbol: 'AAPL',
      date: '2026-08-31',
      atmIv30d: 0.271,
      hv20: 0.244,
      hv252: 0.301,
      putSkew25d: -0.018,
      source: 'orats_backfill',
    });
    expect(out[1]!.date).toBe('2026-09-01');
  });

  it('skips malformed rows and tolerates missing optional columns', () => {
    const csv = ['symbol,date,iv_30', 'AAPL,2026-08-31,0.25', 'BAD,,', 'MSFT,2026-08-31,not-a-number'].join('\n');
    const out = parseOratsIvHistoryCsv(csv);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ symbol: 'AAPL', hv20: null, hv252: null, putSkew25d: null });
  });

  it('throws on an unrecognized header', () => {
    expect(() => parseOratsIvHistoryCsv('a,b,c\n1,2,3')).toThrow();
  });
});
