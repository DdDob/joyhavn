import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createServices } from '../src/services.js';

// Unconfigured server: free routes still work, paid routes refuse without charging.
test('api works without configuration and never charges', async (t) => {
  const app = createApp({ env: {}, services: createServices({ env: {} }), rpc: { stats: async () => ({ slot: 1 }), balances: async () => ({ usdc: 0, sol: 0, hasUsdcAccount: false }) } });
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = (p) => fetch(base + p).then(async (r) => ({ status: r.status, body: await r.json() }));

  assert.equal((await j('/api/services')).body.length, 4);
  assert.equal((await j('/api/config')).body.configured, false);
  assert.equal((await j('/api/health')).body.configured, false);
  assert.equal((await j('/api/solana/stats')).body.slot, 1);
  assert.equal((await j('/api/solana/prepare?payer=abc')).status, 503);
  assert.equal((await j('/api/wallet/not-an-address')).status, 400);
  const paid = await j('/api/v1/json-validator?json=%7B%7D');
  assert.equal(paid.status, 503);
  assert.equal(paid.body.charged, false);
});
