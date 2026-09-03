import { compareTable, compareToCsv } from '@/app/lib/compare-shape';
import { resolveComparison } from '@/app/lib/compare-rows';

export const dynamic = 'force-dynamic';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * GET ?ids=<comparisonId>&format=csv|html
 *   csv  → transposed CSV (content-disposition: attachment)
 *   html → standalone print-friendly document; use the browser's Print → Save as PDF
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get('ids') ?? '').split(',')[0]?.trim();
  const format = url.searchParams.get('format') ?? 'html';
  if (!id) return new Response('ids required', { status: 400 });

  const resolved = await resolveComparison(id);
  if (!resolved) return new Response('not found', { status: 404 });

  const { rows, meta, frozen } = resolved;
  const stamp = `comparison-${frozen.id.slice(0, 8)}`;

  if (format === 'csv') {
    return new Response(compareToCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${stamp}.csv"`,
      },
    });
  }

  const table = compareTable(rows);
  const created = new Date(frozen.createdAt).toISOString().slice(0, 16).replace('T', ' ');

  const headCells = table.contracts
    .map((c) => `<th scope="col">${esc(c.label)}</th>`)
    .join('');

  const seenGroups = new Set<string>();
  const bodyRows = table.rows
    .map((r) => {
      let groupHdr = '';
      if (!seenGroups.has(r.group)) {
        seenGroups.add(r.group);
        groupHdr = `<tr class="group"><th scope="rowgroup" colspan="${
          table.contracts.length + 1
        }">${esc(r.group)}</th></tr>`;
      }
      const dir = r.higherBetter == null ? '' : r.higherBetter ? ' ▲' : ' ▼';
      const cells = r.cells
        .map((c) => `<td class="${c.best ? 'best' : ''}">${esc(c.formatted)}</td>`)
        .join('');
      return `${groupHdr}<tr><th scope="row">${esc(r.label)}<span class="dir">${dir}</span></th>${cells}</tr>`;
    })
    .join('');

  const missingNote = resolved.missing.length
    ? `<p class="warn">Not in this snapshot: ${esc(resolved.missing.join(', '))}</p>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(stamp)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #16211d; background: #fff; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { color: #55655e; font-size: 12px; margin-bottom: 14px; }
  .meta code { font: 11px ui-monospace, Menlo, Consolas, monospace; }
  .print-hint { background: #eef2f0; border: 1px solid #d5ded9; border-radius: 6px; padding: 8px 10px; font-size: 12px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font: 12px/1.3 ui-monospace, Menlo, Consolas, monospace; }
  th, td { padding: 5px 10px; text-align: right; border-bottom: 1px solid #d5ded9; white-space: nowrap; }
  thead th { background: #eef2f0; font-weight: 600; }
  th[scope="row"] { text-align: left; font-weight: 500; color: #55655e; }
  tr.group th { text-align: left; background: #fff; text-transform: uppercase; letter-spacing: .06em; font-size: 10px; color: #8a9a92; padding-top: 12px; border-bottom: none; }
  td.best { background: #d6efe5; font-weight: 700; color: #0f5c45; }
  .dir { color: #8a9a92; font-size: 10px; }
  .warn { color: #a23c2b; font-size: 12px; }
  .disclaimer { margin-top: 22px; color: #8a9a92; font-size: 11px; max-width: 70ch; }
  @media print {
    body { padding: 0; }
    .print-hint { display: none; }
    thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td.best { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr { break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>Frozen put comparison</h1>
  <div class="meta">
    Snapshot <code>${esc(meta.runId)}</code> · frozen ${esc(created)} UTC · ${table.contracts.length} contract${
      table.contracts.length === 1 ? '' : 's'
    }
  </div>
  <div class="print-hint">To save as PDF: use your browser's <strong>Print</strong> dialog and choose <strong>Save as PDF</strong>. Best-in-row values are shaded.</div>
  ${missingNote}
  <table>
    <thead><tr><th scope="col">Metric</th>${headCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <p class="disclaimer">
    Screening tool, not investment advice. Selling puts — cash-secured or on margin — carries
    substantial loss potential if the underlying falls sharply. This is a frozen snapshot; data may be delayed or stale.
  </p>
</body>
</html>`;

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
