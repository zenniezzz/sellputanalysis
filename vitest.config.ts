import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@pss/options': fileURLToPath(new URL('./packages/options/src/index.ts', import.meta.url)),
      '@pss/market-data': fileURLToPath(new URL('./packages/market-data/src/index.ts', import.meta.url)),
      '@pss/pipeline': fileURLToPath(new URL('./packages/pipeline/src/index.ts', import.meta.url)),
      '@pss/store': fileURLToPath(new URL('./packages/store/src/index.ts', import.meta.url)),
      '@pss/observability': fileURLToPath(new URL('./packages/observability/src/index.ts', import.meta.url)),
      '@pss/screen': fileURLToPath(new URL('./packages/screen/src/index.ts', import.meta.url)),
      '@pss/compare': fileURLToPath(new URL('./packages/compare/src/index.ts', import.meta.url)),
      '@pss/diff': fileURLToPath(new URL('./packages/diff/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // Network-touching tests use injected fetch fixtures; nothing here hits the wire.
  },
});
