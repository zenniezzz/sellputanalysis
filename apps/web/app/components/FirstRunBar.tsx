'use client';

import { useEffect, useState } from 'react';

const KEY = 'pss:first-run-dismissed';

export function FirstRunBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== '1');
    } catch {
      /* private mode */
    }
  }, []);

  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div className="statusbar info">
      <button className="x" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
      New here? The default screen is loaded. Adjust filters on the left, click a row to expand its
      P&amp;L cone, check boxes to build a Compare set, and the <strong>ⓘ</strong> next to each column
      links to the <a href="/glossary">glossary</a>.
    </div>
  );
}
