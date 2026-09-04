import { describe, expect, it } from 'vitest';
import type { IngestionRun, SnapshotMeta } from '@pss/pipeline';
import { evaluateRunAlerts } from './alerts.js';

function meta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    id: 'id-1',
    runId: '2026-09-04-1000-scheduled',
    createdAt: '2026-09-04T10:00:00Z',
    snapshotDay: '2026-09-04',
    runType: 'scheduled',
    status: 'good',
    dataCompleteness: 1,
    scoreBasis: 'cross_sectional',
    metricSchemaVersion: 1,
    ratesAsOf: '2026-09-04',
    universeHash: 'abc123',
    provider: 'cboe-delayed',
    displayDelayed: true,
    filterDefaults: {} as SnapshotMeta['filterDefaults'],
    ...overrides,
  };
}

function run(overrides: Partial<IngestionRun> = {}): IngestionRun {
  return {
    runId: '2026-09-04-1000-scheduled',
    startedAt: '2026-09-04T10:00:00Z',
    finishedAt: '2026-09-04T10:05:00Z',
    namesOk: 50,
    namesFailed: 0,
    contractsPriced: 2000,
    ivSolveFailures: 0,
    candidatesFound: 30,
    greekXcheckMedianAbsPct: 1.2,
    status: 'good',
    ...overrides,
  };
}

describe('evaluateRunAlerts', () => {
  it('fires nothing for a healthy run', () => {
    expect(evaluateRunAlerts(meta(), run())).toEqual([]);
  });

  it('fires ingestion_failed (critical) when status is failed', () => {
    const alerts = evaluateRunAlerts(meta({ status: 'failed' }), run({ status: 'failed' }));
    expect(alerts.map((a) => a.code)).toContain('ingestion_failed');
    expect(alerts.find((a) => a.code === 'ingestion_failed')?.severity).toBe('critical');
  });

  it('fires completeness_low (critical) below 40%', () => {
    const alerts = evaluateRunAlerts(meta({ dataCompleteness: 0.39 }), run());
    expect(alerts.map((a) => a.code)).toContain('completeness_low');
    // exactly at the threshold does not fire
    expect(evaluateRunAlerts(meta({ dataCompleteness: 0.4 }), run()).map((a) => a.code)).not.toContain(
      'completeness_low',
    );
  });

  it('fires run_slow (warning) past 12 minutes', () => {
    const slow = run({ startedAt: '2026-09-04T10:00:00Z', finishedAt: '2026-09-04T10:12:01Z' });
    const alerts = evaluateRunAlerts(meta(), slow);
    expect(alerts.map((a) => a.code)).toContain('run_slow');
    expect(alerts.find((a) => a.code === 'run_slow')?.severity).toBe('warning');

    const onTime = run({ startedAt: '2026-09-04T10:00:00Z', finishedAt: '2026-09-04T10:12:00Z' });
    expect(evaluateRunAlerts(meta(), onTime).map((a) => a.code)).not.toContain('run_slow');
  });

  it('fires greek_xcheck_high (warning) above 5%', () => {
    const alerts = evaluateRunAlerts(meta(), run({ greekXcheckMedianAbsPct: 5.01 }));
    expect(alerts.map((a) => a.code)).toContain('greek_xcheck_high');
    expect(evaluateRunAlerts(meta(), run({ greekXcheckMedianAbsPct: 5 })).map((a) => a.code)).not.toContain(
      'greek_xcheck_high',
    );
  });

  it('ignores a null greek cross-check rather than alerting', () => {
    const alerts = evaluateRunAlerts(meta(), run({ greekXcheckMedianAbsPct: null }));
    expect(alerts.map((a) => a.code)).not.toContain('greek_xcheck_high');
  });

  it('can fire multiple alerts at once', () => {
    const alerts = evaluateRunAlerts(
      meta({ dataCompleteness: 0.1 }),
      run({ greekXcheckMedianAbsPct: 9, finishedAt: '2026-09-04T10:15:00Z' }),
    );
    expect(alerts.map((a) => a.code).sort()).toEqual(['completeness_low', 'greek_xcheck_high', 'run_slow'].sort());
  });
});
