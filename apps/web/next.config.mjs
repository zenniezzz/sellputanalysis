// Defense-in-depth headers (plan §10.8). CSP allows inline styles/scripts — the
// App Router injects a hydration bootstrap and the UI uses style={} heavily; a
// nonce-based strict CSP is a follow-up.
//
// 'unsafe-eval' is added to script-src ONLY outside production: `next dev`'s
// webpack bundle wraps every module in eval() (its default dev devtool, for
// fast source maps), so a strict script-src silently kills hydration in dev
// — the page looks fine (it's still valid SSR HTML) but nothing is
// interactive and no client effect ever fires, with only a console EvalError
// as a clue. `next build`/`next start` don't eval like this, so production
// keeps the strict policy unchanged.
const DEV_SCRIPT_SRC = process.env.NODE_ENV === 'production' ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";
const CSP = [
  "default-src 'self'",
  `script-src ${DEV_SCRIPT_SRC}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
];

import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // monorepo: pin the file-tracing root so `next build` bundles the right files
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  transpilePackages: [
    '@pss/options',
    '@pss/pipeline',
    '@pss/market-data',
    '@pss/observability',
    '@pss/store',
    '@pss/screen',
    '@pss/tracker',
  ],
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    // the workspace packages use NodeNext-style `./foo.js` specifiers that point
    // at `.ts` sources — let webpack resolve them
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    // optional native / peer deps that are lazily imported and not needed for the app
    config.externals = config.externals || [];
    config.externals.push('pg-native', '@sentry/node', 'cloudflare:sockets');
    return config;
  },
};

export default nextConfig;
