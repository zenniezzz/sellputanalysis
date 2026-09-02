/**
 * Strike pre-filter (plan §4.1 stage D): only price puts whose strike is within a
 * moneyness band of spot, so stage D is bounded to ~30–50 strikes per expiration
 * rather than the whole chain.
 */
export function inStrikeWindow(strike: number, spot: number, loFrac = 0.6, hiFrac = 1.05): boolean {
  return strike >= loFrac * spot && strike <= hiFrac * spot;
}
