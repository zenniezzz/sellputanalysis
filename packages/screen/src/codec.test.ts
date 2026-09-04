import { describe, expect, it } from 'vitest';
import { filtersFromQuery, filtersToQuery } from './codec.js';
import { DEFAULT_FILTERS, type ScreenFilters } from './filters.js';

describe('filter codec', () => {
  it('an empty query yields the defaults', () => {
    expect(filtersFromQuery(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });

  it('round-trips a customized filter set', () => {
    const custom: ScreenFilters = {
      ...DEFAULT_FILTERS,
      dteMin: 30,
      dteMax: 60,
      deltaLo: 0.2,
      minAnnRoc: 0.2,
      capitalBasis: 'regt',
      maxBuyingPowerPerPosition: 25000,
      excludeSymbols: ['TSLA', 'COIN'],
      sectors: ['TECHNOLOGY'],
      hideIvProxy: true,
      sort: 'annRoc',
      columns: 'all',
    };
    const back = filtersFromQuery(new URLSearchParams(filtersToQuery(custom).toString()));
    expect(back).toEqual(custom);
  });

  it('omits defaults from the query string', () => {
    const q = filtersToQuery({ ...DEFAULT_FILTERS, dteMin: 30 });
    expect(q.toString()).toBe('dteMin=30');
  });

  it('clamps out-of-range values', () => {
    const f = filtersFromQuery(new URLSearchParams('deltaLo=9&deltaHi=9&minOpenInterest=-5&maxSpreadPct=99'));
    expect(f.deltaLo).toBe(0.5);
    expect(f.deltaHi).toBe(0.5);
    expect(f.minOpenInterest).toBe(0);
    expect(f.maxSpreadPct).toBe(0.25);
  });

  it('repairs an inverted band', () => {
    const f = filtersFromQuery(new URLSearchParams('dteMin=50&dteMax=20'));
    expect(f.dteMin).toBe(20);
    expect(f.dteMax).toBe(50);
  });

  it('repairs an inverted underlying-price band', () => {
    const f = filtersFromQuery(new URLSearchParams('minUnderlyingPrice=200&maxUnderlyingPrice=50'));
    expect(f.minUnderlyingPrice).toBe(50);
    expect(f.maxUnderlyingPrice).toBe(200);
  });

  it('clamp then band-repair: a huge deltaLo lands at deltaHi and pushes deltaHi to its max', () => {
    const f = filtersFromQuery(new URLSearchParams('deltaLo=9'));
    expect(f.deltaLo).toBe(0.35); // swapped with the default deltaHi
    expect(f.deltaHi).toBe(0.5);
  });

  it('ignores an unknown enum value', () => {
    expect(filtersFromQuery(new URLSearchParams('capitalBasis=bogus')).capitalBasis).toBe('csp');
  });
});
