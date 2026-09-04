/**
 * Paper-trade model (plan §1.2, §13.1, milestone M6.5).
 *
 * A paper trade freezes what the screener modeled for one short put at the
 * moment the user "would have sold" it. On close it records the actual outcome,
 * so the calibration harness can score the model against reality.
 */

export type TradeOutcome = 'expired_otm' | 'assigned' | 'closed_early' | 'rolled';

export interface PaperTrade {
  id: string;
  userId: string | null;
  createdAt: string;
  snapshotRunId: string;

  occSymbol: string;
  symbol: string;
  expiration: string;
  strike: number;
  multiplier: number;
  contracts: number;

  /** Modeled at entry — frozen. Per share unless noted. */
  entryCredit: number;
  /** The user's actual fill, if they recorded one; null ⇒ assume the modeled credit. */
  actualFillCredit: number | null;
  entrySpot: number;
  breakeven: number;
  modeledPop: number | null;
  modeledProbItm: number | null;
  modeledEv100: number | null;
  sigmaF: number | null;
  delta: number | null;
  dteAtEntry: number;

  /** Outcome — null until closed. */
  closedAt: string | null;
  outcome: TradeOutcome | null;
  terminalSpot: number | null;
  /** Per share — price paid to buy the put back (closed_early / rolled). */
  exitCredit: number | null;
  /** Per contract. */
  realizedPnl100: number | null;
  notes: string | null;
}

export interface OpenTradeInput {
  snapshotRunId: string;
  occSymbol: string;
  symbol: string;
  expiration: string;
  strike: number;
  multiplier?: number;
  contracts?: number;
  entryCredit: number;
  actualFillCredit?: number | null;
  entrySpot: number;
  breakeven: number;
  modeledPop?: number | null;
  modeledProbItm?: number | null;
  modeledEv100?: number | null;
  sigmaF?: number | null;
  delta?: number | null;
  dteAtEntry: number;
  notes?: string | null;
}

export interface CloseTradeInput {
  outcome: TradeOutcome;
  terminalSpot?: number | null;
  exitCredit?: number | null;
  notes?: string | null;
}

/** Realized P&L per contract for a short put, given the close details. */
export function realizedPnl100(trade: PaperTrade, close: CloseTradeInput): number {
  const credit = trade.actualFillCredit ?? trade.entryCredit;
  const m = trade.multiplier;
  switch (close.outcome) {
    case 'expired_otm':
      return credit * m;
    case 'assigned': {
      // put assigned: you buy stock at K; P&L = credit − (K − S_T)
      const sT = close.terminalSpot ?? trade.strike;
      return (credit - Math.max(trade.strike - sT, 0)) * m;
    }
    case 'closed_early':
    case 'rolled': {
      const exit = close.exitCredit ?? 0;
      return (credit - exit) * m;
    }
  }
}

export function applyClose(trade: PaperTrade, close: CloseTradeInput, at: string): PaperTrade {
  return {
    ...trade,
    closedAt: at,
    outcome: close.outcome,
    terminalSpot: close.terminalSpot ?? null,
    exitCredit: close.exitCredit ?? null,
    realizedPnl100: realizedPnl100(trade, close),
    notes: close.notes ?? trade.notes,
  };
}
