import Link from 'next/link';
import { GLOSSARY } from '../lib/glossary';

export const metadata = { title: 'Glossary — Put-Sell Screener' };

export default function GlossaryPage() {
  const groups = [...new Set(GLOSSARY.map((e) => e.group))];
  return (
    <article style={{ maxWidth: '68ch', margin: '0 auto', padding: '8px 0 60px', lineHeight: 1.6 }}>
      <p>
        <Link href="/">← Screener</Link> · <Link href="/todays-pick">Today&rsquo;s pick</Link> ·{' '}
        <Link href="/method">Model &amp; method</Link>
      </p>
      <h1 style={{ fontSize: 20 }}>Glossary</h1>
      {groups.map((g) => (
        <section key={g}>
          <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-faint)', marginTop: 28 }}>
            {g}
          </h2>
          {GLOSSARY.filter((e) => e.group === g).map((e) => (
            <div key={e.id} id={e.id} style={{ margin: '14px 0', scrollMarginTop: 16 }}>
              <strong>{e.term}</strong>
              <div style={{ color: 'var(--ink-dim)' }}>{e.definition}</div>
              {e.formula && (
                <div style={{ font: '12px var(--mono)', color: 'var(--ink-faint)', marginTop: 3 }}>{e.formula}</div>
              )}
              {e.example && (
                <div style={{ font: '12px var(--mono)', color: 'var(--accent)', marginTop: 2 }}>
                  e.g. {e.example}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
      <p style={{ marginTop: 40, color: 'var(--ink-faint)', fontSize: 11 }}>
        Screening tool, not investment advice.
      </p>
    </article>
  );
}
