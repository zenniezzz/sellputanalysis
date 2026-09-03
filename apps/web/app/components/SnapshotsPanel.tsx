'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SnapshotMeta } from '@pss/pipeline';
import type { SnapshotBookmarkDto } from '../lib/types';
import type { SnapshotDiff } from '../lib/diff';
import { DiffView } from './DiffView';

const selectStyle: React.CSSProperties = {
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  color: 'var(--ink)',
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: 12,
};

export function SnapshotsPanel({ signedIn }: { signedIn: boolean }) {
  const [bookmarks, setBookmarks] = useState<SnapshotBookmarkDto[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshBookmarks = useCallback(async () => {
    const res = await fetch('/api/bookmarks');
    const json = (await res.json()) as { bookmarks?: SnapshotBookmarkDto[] };
    setBookmarks(json.bookmarks ?? []);
  }, []);

  useEffect(() => {
    void fetch('/api/snapshots')
      .then((r) => r.json())
      .then((json: { snapshots?: SnapshotMeta[] }) => {
        const list = (json.snapshots ?? []).slice(0, 15);
        setSnapshots(list);
        if (list.length >= 2) {
          setA(list[1].runId);
          setB(list[0].runId);
        } else if (list.length === 1) {
          setA(list[0].runId);
          setB(list[0].runId);
        }
      })
      .catch(() => setError('failed to load snapshots'));
  }, []);

  useEffect(() => {
    if (signedIn) void refreshBookmarks();
  }, [signedIn, refreshBookmarks]);

  const runDiff = useCallback(async () => {
    if (!a || !b) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/snapshots/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
      const json = await res.json();
      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'diff failed');
        setDiff(null);
      } else {
        setDiff(json as SnapshotDiff);
      }
    } catch {
      setError('diff failed');
      setDiff(null);
    } finally {
      setLoading(false);
    }
  }, [a, b]);

  useEffect(() => {
    void runDiff();
  }, [runDiff]);

  async function deleteBookmark(id: string) {
    await fetch(`/api/bookmarks/${id}`, { method: 'DELETE' });
    await refreshBookmarks();
  }

  return (
    <div className="snapshots-panel">
      <section style={{ marginBottom: 20 }}>
        <h3
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            color: 'var(--ink-faint)',
          }}
        >
          Frozen screens
        </h3>
        {!signedIn ? (
          <p className="sub" style={{ color: 'var(--ink-dim)', fontSize: 12 }}>
            Sign in to freeze and revisit screens.
          </p>
        ) : bookmarks.length === 0 ? (
          <p className="sub" style={{ color: 'var(--ink-dim)', fontSize: 12 }}>
            No frozen screens yet. Use the Freeze button on the Candidates tab.
          </p>
        ) : (
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th className="sym">Name</th>
                  <th className="sym">Snapshot</th>
                  <th className="sym">Frozen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bookmarks.map((bm) => (
                  <tr key={bm.id}>
                    <td className="sym">{bm.name}</td>
                    <td className="sym">
                      <a href={`/?${bm.filterQuery}`}>{bm.snapshotRunId}</a>
                    </td>
                    <td className="sym">{new Date(bm.createdAt).toLocaleString()}</td>
                    <td>
                      <button className="btn" onClick={() => void deleteBookmark(bm.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            color: 'var(--ink-faint)',
          }}
        >
          Compare snapshots
        </h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
            A (prev){' '}
            <select style={selectStyle} value={a} onChange={(e) => setA(e.target.value)}>
              {snapshots.map((s) => (
                <option key={s.runId} value={s.runId}>
                  {s.snapshotDay} · {s.runId} ({s.status})
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
            B (next){' '}
            <select style={selectStyle} value={b} onChange={(e) => setB(e.target.value)}>
              {snapshots.map((s) => (
                <option key={s.runId} value={s.runId}>
                  {s.snapshotDay} · {s.runId} ({s.status})
                </option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => void runDiff()}>
            {loading ? '…' : 'Diff'}
          </button>
        </div>

        {error && <p style={{ color: 'var(--bad)', fontSize: 12 }}>{error}</p>}
        {snapshots.length < 2 && !error && (
          <p className="sub" style={{ color: 'var(--ink-dim)', fontSize: 12 }}>
            Need at least two snapshots to compare.
          </p>
        )}
        {diff && <DiffView diff={diff} />}
      </section>
    </div>
  );
}
