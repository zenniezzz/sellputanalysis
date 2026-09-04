'use client';

import type { SnapshotMeta } from '@pss/pipeline';

/** Application-state banners (plan §8.9). */
export function StatusBanner({ meta }: { meta: SnapshotMeta }) {
  const banners: { cls: string; text: string }[] = [];

  const ageMs = Date.now() - new Date(meta.createdAt).getTime();
  const ageHrs = ageMs / 3_600_000;

  if (meta.status === 'failed') {
    banners.push({ cls: 'bad', text: `Last ingestion failed — showing the most recent good snapshot (${meta.runId}).` });
  } else if (meta.status === 'degraded') {
    banners.push({
      cls: 'warn',
      text: `Degraded snapshot — only ${(meta.dataCompleteness * 100).toFixed(0)}% of the universe priced.`,
    });
  }

  if (meta.scoreBasis !== 'reference') {
    banners.push({
      cls: 'info',
      text:
        meta.scoreBasis === 'cross_sectional'
          ? 'Scores are relative to today’s results — the 1-year reference distribution is still accruing.'
          : 'Scores blend the accruing reference distribution with today’s cross-section.',
    });
  }

  if (ageHrs > 20) {
    banners.push({ cls: 'warn', text: `This snapshot is ${Math.round(ageHrs)} h old — run a fresh one.` });
  }

  if (banners.length === 0) return null;
  return (
    <>
      {banners.map((b, i) => (
        <div key={i} className={`statusbar ${b.cls}`}>
          {b.text}
        </div>
      ))}
    </>
  );
}
