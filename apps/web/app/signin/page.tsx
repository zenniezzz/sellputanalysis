import { SignInForm } from './SignInForm';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const providers = {
    email: true,
    dev: process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_LOGIN === '1',
    google: !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  };
  return (
    <div style={{ maxWidth: 380, margin: '80px auto' }}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>Sign in</h1>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 20 }}>
        Put-Sell Screener — accounts are only used to store your saved screens and watchlist.
      </p>
      <SignInForm
        providers={providers}
        callbackUrl={sp.callbackUrl ?? '/'}
        error={sp.error ?? null}
      />
    </div>
  );
}
