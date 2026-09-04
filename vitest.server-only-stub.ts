// Stub for the `server-only` package under Vitest.
//
// `apps/web` files `import 'server-only'` to fail a *client* bundle at build
// time — Next.js has its own internal webpack alias for this marker package
// and never actually requires it to be installed. Plain Vitest has no such
// alias, so importing one of those files here would otherwise throw
// `ERR_MODULE_NOT_FOUND`; this file (aliased in vitest.config.ts) is a no-op
// stand-in so those files' *actual* logic (not the marker) can be tested.
export {};
