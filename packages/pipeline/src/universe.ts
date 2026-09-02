/**
 * Universe source (plan stage B, §4.3).
 *
 * M1: a curated list of liquid optionable US names + major ETFs, standing in for
 * the OCC daily volume file. The pipeline fetches chains for the whole list and
 * ranks by in-window put volume, so a rough seed list is sufficient. Swap
 * `StaticUniverseSource` for an OCC-file-backed source without touching the
 * pipeline.
 */

export interface UniverseCandidate {
  symbol: string;
  sector: string;
  isLeveraged: boolean;
  isInverse: boolean;
  isAdr: boolean;
}

export interface UniverseSource {
  list(limit: number): Promise<UniverseCandidate[]>;
}

const S = (symbol: string, sector: string, extra: Partial<UniverseCandidate> = {}): UniverseCandidate => ({
  symbol,
  sector,
  isLeveraged: false,
  isInverse: false,
  isAdr: false,
  ...extra,
});

export const DEFAULT_UNIVERSE: UniverseCandidate[] = [
  // broad ETFs
  S('SPY', 'ETF-Broad'), S('QQQ', 'ETF-Broad'), S('IWM', 'ETF-Broad'), S('DIA', 'ETF-Broad'),
  // sector / thematic ETFs
  S('XLF', 'ETF-Sector'), S('XLE', 'ETF-Sector'), S('SMH', 'ETF-Sector'), S('GDX', 'ETF-Sector'),
  S('ARKK', 'ETF-Sector'), S('SLV', 'ETF-Commodity'), S('GLD', 'ETF-Commodity'), S('USO', 'ETF-Commodity'),
  S('TLT', 'ETF-Rates'), S('HYG', 'ETF-Credit'), S('EEM', 'ETF-Intl'), S('FXI', 'ETF-Intl'),
  // mega-cap tech
  S('AAPL', 'Technology'), S('MSFT', 'Technology'), S('NVDA', 'Semiconductors'), S('AMD', 'Semiconductors'),
  S('AVGO', 'Semiconductors'), S('INTC', 'Semiconductors'), S('MU', 'Semiconductors'), S('QCOM', 'Semiconductors'),
  S('GOOGL', 'Communication'), S('META', 'Communication'), S('NFLX', 'Communication'), S('DIS', 'Communication'),
  S('AMZN', 'Consumer-Disc'), S('TSLA', 'Consumer-Disc'), S('HD', 'Consumer-Disc'), S('NKE', 'Consumer-Disc'),
  S('SBUX', 'Consumer-Disc'), S('MCD', 'Consumer-Disc'), S('LOW', 'Consumer-Disc'),
  // financials
  S('JPM', 'Financials'), S('BAC', 'Financials'), S('WFC', 'Financials'), S('GS', 'Financials'),
  S('MS', 'Financials'), S('C', 'Financials'), S('SCHW', 'Financials'), S('V', 'Financials'), S('MA', 'Financials'),
  // health / staples / industrials / energy
  S('UNH', 'Healthcare'), S('JNJ', 'Healthcare'), S('LLY', 'Healthcare'), S('PFE', 'Healthcare'),
  S('MRK', 'Healthcare'), S('ABBV', 'Healthcare'),
  S('XOM', 'Energy'), S('CVX', 'Energy'), S('OXY', 'Energy'), S('SLB', 'Energy'),
  S('BA', 'Industrials'), S('CAT', 'Industrials'), S('GE', 'Industrials'), S('UPS', 'Industrials'),
  S('KO', 'Staples'), S('PEP', 'Staples'), S('PG', 'Staples'), S('WMT', 'Staples'), S('COST', 'Staples'),
  // high-IV single names
  S('COIN', 'Crypto-adjacent'), S('MARA', 'Crypto-adjacent'), S('MSTR', 'Crypto-adjacent'),
  S('PLTR', 'Technology'), S('SOFI', 'Financials'), S('CVNA', 'Consumer-Disc'), S('SMCI', 'Technology'),
  S('UBER', 'Technology'), S('SNAP', 'Communication'), S('RIVN', 'Consumer-Disc'),
  // leveraged / inverse — must be filtered out by applyUniverseFilters
  S('TQQQ', 'ETF-Leveraged', { isLeveraged: true }),
  S('SQQQ', 'ETF-Inverse', { isInverse: true }),
  S('SOXL', 'ETF-Leveraged', { isLeveraged: true }),
];

export class StaticUniverseSource implements UniverseSource {
  constructor(private readonly items: UniverseCandidate[] = DEFAULT_UNIVERSE) {}
  async list(limit: number): Promise<UniverseCandidate[]> {
    return this.items.slice(0, limit);
  }
}

export interface UniverseFilterConfig {
  excludeLeveragedInverse: boolean;
}

export function applyUniverseFilters(
  candidates: UniverseCandidate[],
  config: UniverseFilterConfig = { excludeLeveragedInverse: true },
): UniverseCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.symbol)) return false;
    seen.add(c.symbol);
    if (config.excludeLeveragedInverse && (c.isLeveraged || c.isInverse)) return false;
    return true;
  });
}
