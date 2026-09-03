'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export function SignInForm({
  providers,
  callbackUrl,
  error,
}: {
  providers: { email: boolean; dev: boolean; google: boolean };
  callbackUrl: string;
  error: string | null;
}) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div className="nearest" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          Sign-in error: {error}
        </div>
      )}

      {providers.google && (
        <button className="btn" style={{ padding: 8 }} onClick={() => signIn('google', { callbackUrl })}>
          Continue with Google
        </button>
      )}

      <input
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          color: 'var(--ink)',
          borderRadius: 4,
          padding: '8px 10px',
          fontSize: 13,
        }}
      />

      {providers.email && (
        <button
          className="btn"
          style={{ padding: 8 }}
          disabled={!email.includes('@')}
          onClick={async () => {
            await signIn('email', { email, callbackUrl, redirect: false });
            setSent(true);
          }}
        >
          Email me a magic link
        </button>
      )}
      {sent && (
        <p className="disclaimer" style={{ marginTop: 0 }}>
          Link sent. In dev it&rsquo;s printed to the server console and{' '}
          <code>.data/auth/magic-links.log</code>.
        </p>
      )}

      {providers.dev && (
        <button
          className="btn"
          style={{ padding: 8, borderStyle: 'dashed' }}
          disabled={!email.includes('@')}
          onClick={() => signIn('dev', { email, callbackUrl })}
        >
          Dev sign in (no email)
        </button>
      )}
    </div>
  );
}
