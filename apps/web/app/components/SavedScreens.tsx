'use client';

import { useEffect, useState } from 'react';
import type { SavedScreenDto } from '../lib/types';

export function SavedScreens({
  signedIn,
  currentQuery,
  onLoad,
}: {
  signedIn: boolean;
  currentQuery: string;
  onLoad: (query: string) => void;
}) {
  const [screens, setScreens] = useState<SavedScreenDto[]>([]);
  const [selected, setSelected] = useState('');

  async function refresh() {
    const res = await fetch('/api/screens');
    const json = (await res.json()) as { screens: SavedScreenDto[] };
    setScreens(json.screens);
  }

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn]);

  if (!signedIn) return null;

  async function save() {
    const name = window.prompt('Save this screen as:');
    if (!name) return;
    await fetch('/api/screens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), query: currentQuery }),
    });
    await refresh();
  }

  async function remove() {
    if (!selected) return;
    await fetch(`/api/screens/${selected}`, { method: 'DELETE' });
    setSelected('');
    await refresh();
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select
        value={selected}
        onChange={(e) => {
          const id = e.target.value;
          setSelected(id);
          const s = screens.find((x) => x.id === id);
          if (s) onLoad(s.query);
        }}
        style={{
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          color: 'var(--ink)',
          borderRadius: 4,
          padding: '4px 6px',
          fontSize: 12,
        }}
      >
        <option value="">Saved screens…</option>
        {screens.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button className="btn" onClick={save}>
        Save current
      </button>
      {selected && (
        <button className="btn" onClick={remove}>
          Delete
        </button>
      )}
    </span>
  );
}
