/**
 * Ingestion-run alert thresholds (plan §10.7). Pure — evaluates a completed
 * run against the four thresholds that are derivable from the run's own
 * recorded fields; the other two §10.7 alerts (missed-run dead-man's switch,
 * read-API 5xx rate) aren't run-level and are covered elsewhere — see
 * docs/runbook.md "On-call" for where each of the six lives.
 */
import type { IngestionRun, SnapshotMeta } from '@pss/pipeline';

export type AlertSeverity = 'critical' | 'warning';

export interface RunAlert {
  code: 'ingestion_failed' | 'completeness_low' | 'run_slow' | 'greek_xcheck_high';
  severity: AlertSeverity;
  message: string;
}

/** plan §10.7 thresholds, named so a threshold change is a one-line diff. */
export const ALERT_THRESHOLDS = {
  /** completeness < 40% */
  minCompleteness: 0.4,
  /** run > 12 min */
  maxDurationMs: 12 * 60_000,
  /** greek cross-check median abs % > 5% */
  maxGreekXcheckPct: 5,
};

export function evaluateRunAlerts(meta: SnapshotMeta, run: IngestionRun): RunAlert[] {
  const alerts: RunAlert[] = [];

  if (meta.status === 'failed') {
    alerts.push({
      code: 'ingestion_failed',
      severity: 'critical',
      message: `ingestion failed (run ${meta.runId})`,
    });
  }

  if (meta.dataCompleteness < ALERT_THRESHOLDS.minCompleteness) {
    alerts.push({
      code: 'completeness_low',
      severity: 'critical',
      message: `data completeness ${(meta.dataCompleteness * 100).toFixed(0)}% < ${ALERT_THRESHOLDS.minCompleteness * 100}% (run ${meta.runId})`,
    });
  }

  const durationMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  if (Number.isFinite(durationMs) && durationMs > ALERT_THRESHOLDS.maxDurationMs) {
    alerts.push({
      code: 'run_slow',
      severity: 'warning',
      message: `run took ${(durationMs / 60_000).toFixed(1)} min > ${ALERT_THRESHOLDS.maxDurationMs / 60_000} min (run ${meta.runId})`,
    });
  }

  if (run.greekXcheckMedianAbsPct != null && run.greekXcheckMedianAbsPct > ALERT_THRESHOLDS.maxGreekXcheckPct) {
    alerts.push({
      code: 'greek_xcheck_high',
      severity: 'warning',
      message: `greek cross-check ${run.greekXcheckMedianAbsPct.toFixed(2)}% > ${ALERT_THRESHOLDS.maxGreekXcheckPct}% (run ${meta.runId})`,
    });
  }

  return alerts;
}
