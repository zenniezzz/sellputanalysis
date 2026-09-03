'use client';

import { signIn, signOut } from 'next-auth/react';

export function AccountBar({ email }: { email: string | null }) {
  if (!email) {
    return (
      <button className="btn" onClick={() => signIn()}>
        Sign in
      </button>
    );
  }
  return (
    <span className="meta" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {email}
      <button className="btn" onClick={() => signOut()}>
        Sign out
      </button>
    </span>
  );
}
