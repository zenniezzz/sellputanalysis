'use client';

import { useState } from 'react';
import type { ScreenedRow } from '@pss/screen';

export function LogTradeButton({
  row,
  snapshotRunId,
  signedIn,
}: {
  row: ScreenedRow;
  snapshotRunId: string;
  signedIn: boolean;
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  if (!signedIn) {
    return <span style={{ color: 'var(--ink-faint)', fontSize: 11 }}>Sign in to log a paper trade</span>;
  }

  async function log() {
    if (row.entryCredit == null || row.breakeven == null) return;
    setState('saving');
    const res = await fetch('/api/trades', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        snapshotRunId,
        occSymbol: row.occSymbol,
        symbol: row.symbol,
        expiration: row.expiration,
        strike: row.strike,
        multiplier: row.multiplier,
        contracts: 1,
        entryCredit: row.entryCredit,
        entrySpot: row.spot,
        breakeven: row.breakeven,
        modeledPop: row.pop,
        modeledProbItm: row.probItm,
        modeledEv100: row.ev100,
        sigmaF: row.sigmaF,
        delta: row.delta,
        dteAtEntry: row.dte,
      }),
    });
    setState(res.ok ? 'done' : 'error');
    setTimeout(() => setState('idle'), 3000);
  }

  return (
    <button className="btn" onClick={log} disabled={state === 'saving' || state === 'done'}>
      {state === 'done' ? '✓ logged' : state === 'error' ? 'error' : state === 'saving' ? '…' : 'Log paper trade'}
    </button>
  );
}
