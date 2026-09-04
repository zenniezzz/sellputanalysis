/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
