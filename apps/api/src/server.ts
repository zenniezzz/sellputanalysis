import { createServer } from 'node:http';
import process from 'node:process';
import { handle } from './handler.js';
import { openStore } from './store.js';

const PORT = Number(process.env['PORT'] ?? 8787);

async function main(): Promise<void> {
  const { store, close } = await openStore();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    handle(req.method ?? 'GET', url.pathname, store)
      .then((r) => {
        res.writeHead(r.status, r.headers);
        res.end(r.body);
      })
      .catch((e) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      });
  });

  server.listen(PORT, () => {
    console.log(`pss-api on http://localhost:${PORT}  (GET / · /api/snapshots/latest)`);
  });

  const shutdown = () => {
    server.close();
    void close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
