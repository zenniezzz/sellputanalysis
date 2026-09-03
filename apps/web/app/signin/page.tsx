import { SignInForm } from './SignInForm';

export const dynamic = 'force-dynamic';

export default function SignInPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
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
        callbackUrl={searchParams.callbackUrl ?? '/'}
        error={searchParams.error ?? null}
      />
    </div>
  );
}
