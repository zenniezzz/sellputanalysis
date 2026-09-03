/** CSV export of a screened result (plan §8.4). */

import type { ScreenedRow } from './apply.js';

const COLUMNS: [string, (r: ScreenedRow) => string | number | null][] = [
  ['score', (r) => r.score],
  ['symbol', (r) => r.symbol],
  ['occSymbol', (r) => r.occSymbol.trim()],
  ['expiration', (r) => r.expiration],
  ['dte', (r) => r.dte],
  ['strike', (r) => r.strike],
  ['moneynessPct', (r) => r.moneynessPct],
  ['bid', (r) => r.bid],
  ['ask', (r) => r.ask],
  ['mid', (r) => r.mid],
  ['entryCredit', (r) => r.entryCredit],
  ['midCredit', (r) => r.midCredit],
  ['spreadPct', (r) => r.spreadPct],
  ['volume', (r) => r.volume],
  ['openInterest', (r) => r.openInterest],
  ['iv', (r) => r.iv],
  ['ivRank', (r) => r.ivRank],
  ['ivPctile', (r) => r.ivPctile],
  ['putSkew25d', (r) => r.putSkew25d],
  ['ivVsFitted', (r) => r.ivVsFitted],
  ['delta', (r) => r.delta],
  ['gamma', (r) => r.gamma],
  ['thetaDay', (r) => r.thetaDay],
  ['dailyDecay', (r) => r.dailyDecay],
  ['vega', (r) => r.vega],
  ['decayYield', (r) => r.decayYield],
  ['breakeven', (r) => r.breakeven],
  ['bePct', (r) => r.bePct],
  ['probItm', (r) => r.probItm],
  ['pop', (r) => r.pop],
  ['emDistance', (r) => r.emDistance],
  ['displayCapital100', (r) => r.displayCapital100],
  ['displayAnnRoc', (r) => r.displayAnnRoc],
  ['positionBp', (r) => r.positionBp],
  ['ev100', (r) => r.ev100],
  ['maxLoss100', (r) => r.maxLoss100],
  ['evToMaxloss', (r) => r.evToMaxloss],
  ['creditToMaxloss', (r) => r.creditToMaxloss],
  ['sigmaF', (r) => r.sigmaF],
  ['assignmentWatch', (r) => (r.assignmentWatch ? 1 : 0)],
  ['flags', (r) => Object.entries(r.modelCaution).filter(([, v]) => v).map(([k]) => k).join('|')],
];

function cell(v: string | number | null): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function screenedRowsToCsv(rows: ScreenedRow[]): string {
  const header = COLUMNS.map(([name]) => name).join(',');
  const body = rows.map((r) => COLUMNS.map(([, get]) => cell(get(r))).join(',')).join('\n');
  return `${header}\n${body}\n`;
}
