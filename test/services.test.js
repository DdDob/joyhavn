import test from 'node:test';
import assert from 'node:assert/strict';
import { createServices, checkInput, urlRisk, validateJson, findJsonErrorIndex, publicService } from '../src/services.js';
import { extractiveSummary, summarize } from '../src/summarize.js';
import { createMarket } from '../src/market.js';
import { HttpError } from '../src/errors.js';

const stubMarket = async () => ({ asset: { name: 'Solana' } });
const services = createServices({ lookupAsset: stubMarket, env: {} });
const svc = (id) => services.find((s) => s.id === id);

test('every service has what the server and UI need', () => {
  assert.equal(services.length, 4);
  for (const s of services) {
    for (const k of ['id', 'name', 'icon', 'path', 'price', 'priceUsd', 'param', 'example', 'run', 'validate', 'maxLen']) {
      assert.ok(s[k] !== undefined, `${s.id} missing ${k}`);
    }
    assert.equal(Number(s.price.slice(1)), s.priceUsd, `${s.id} price string matches priceUsd`);
    assert.ok(s.path.startsWith('/api/v1/'));
    assert.equal(publicService(s).run, undefined, 'handlers are never exposed');
  }
  assert.equal(new Set(services.map((s) => s.id)).size, 4);
  assert.equal(new Set(services.map((s) => s.path)).size, 4);
});

test('every example input passes validation and runs', async () => {
  for (const s of services) {
    assert.equal(checkInput(s, { [s.param]: s.example }), null, s.id);
    const prepared = s.prepare ? await s.prepare(s.example) : undefined;
    assert.ok(await s.run(s.example, prepared), s.id);
  }
});

test('checkInput rejects missing, empty and oversized input before payment', () => {
  const s = svc('json-validator');
  assert.match(checkInput(s, {}), /Missing/);
  assert.match(checkInput(s, { json: '   ' }), /Missing/);
  assert.match(checkInput(s, { json: 'x'.repeat(s.maxLen + 1) }), /too long/);
  assert.match(checkInput(svc('url-safety-scan'), { url: 'not a url' }), /valid absolute URL/);
  assert.match(checkInput(svc('url-safety-scan'), { url: 'ftp://x.com' }), /http/);
  assert.match(checkInput(svc('ai-summary'), { text: 'too short' }), /at least 40/);
});

test('url scan: scam-looking link is high risk, normal site is low', () => {
  const bad = urlRisk('https://phantom-airdrop-claim.secure-verify.xyz/connect-wallet');
  assert.equal(bad.level, 'high');
  assert.ok(bad.flags.length >= 3);
  assert.equal(urlRisk('https://solana.com/docs').level, 'low');
  assert.equal(urlRisk('https://user:pw@example.com').flags.some((f) => f.code === 'credentials_in_url'), true);
});

test('json validator: valid JSON is formatted, invalid JSON explains where', () => {
  const ok = validateJson('{"a":[1,2,{"b":null}]}');
  assert.equal(ok.valid, true);
  assert.equal(ok.type, 'object');
  assert.equal(ok.depth, 3);
  assert.equal(ok.totalKeys, 2);
  assert.match(ok.formatted, /\n {2}"a"/);

  const bad = validateJson('{"name": "Joyhavn", "services": [1, 2, 3],}');
  assert.equal(bad.valid, false);
  assert.ok(bad.error.length > 0);
  assert.ok(Number.isInteger(bad.line), 'reports a line number');

  const multi = validateJson('{\n  "a": 1,\n  "b": ,\n}');
  assert.equal(multi.valid, false);
  assert.equal(multi.line, 3);
  assert.equal(multi.column, 8);
});

test('json error locator agrees with JSON.parse on valid and invalid inputs', () => {
  const valid = ['{}', '[]', '0', '-1.5e+3', '"a\\n\\u00e9"', 'true', 'null', '{"a":[1,{"b":[]}]}', ' \n[1 , 2]\t'];
  for (const t of valid) {
    JSON.parse(t);
    assert.equal(findJsonErrorIndex(t), null, t);
  }
  const invalid = ['', '{', '[1,]', '{"a":1,}', "{'a':1}", '{"a" 1}', '01', '1.', '"abc', '"\\x"', 'nul', '[1 2]', '{"a":1} x', '\u0000'];
  for (const t of invalid) {
    assert.throws(() => JSON.parse(t), undefined, t);
    assert.notEqual(findJsonErrorIndex(t), null, JSON.stringify(t));
  }
  assert.equal(findJsonErrorIndex('{"a":1,}'), 7);
});

test('summary: short text is returned whole, long text is cut to 3 sentences', () => {
  const short = extractiveSummary('One. Two. Three.');
  assert.equal(short.summary, 'One. Two. Three.');
  const long = extractiveSummary(
    'Solana is a fast blockchain. It has low fees. Developers build payments on it. Unrelated cats nap. Dogs also nap. The blockchain keeps growing. Payments on the blockchain settle quickly.',
  );
  assert.equal((long.summary.match(/[.!?]/g) || []).length, 3);
  assert.ok(long.summaryWords < long.originalWords);
});

test('summary: uses Claude when a key is set and falls back when it fails', async () => {
  const text = 'Solana is a fast blockchain. It has low fees. Developers build payments on it. Cats nap. Dogs nap. More text here to pad the length.';
  const okFetch = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'A short Claude summary.' }] }) });
  const viaClaude = await summarize(text, { ANTHROPIC_API_KEY: 'k' }, okFetch);
  assert.equal(viaClaude.engine, 'claude');
  assert.equal(viaClaude.summary, 'A short Claude summary.');

  const badFetch = async () => ({ ok: false, status: 500 });
  const fallback = await summarize(text, { ANTHROPIC_API_KEY: 'k' }, badFetch);
  assert.equal(fallback.engine, 'extractive');
  assert.match(fallback.note, /Claude unavailable/);

  assert.equal((await summarize(text, {}, okFetch)).engine, 'extractive');
});

test('market: looks up an asset, caches it, and rejects unknowns without charging', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (url.includes('/search')) {
      return { ok: true, status: 200, json: async () => ({ coins: url.includes('zzzz') ? [] : [{ id: 'solana' }] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => [
        { id: 'solana', name: 'Solana', symbol: 'sol', market_cap_rank: 6, current_price: 150.5, price_change_percentage_24h: 2.345, price_change_percentage_7d_in_currency: -1.2, high_24h: 155, low_24h: 148, market_cap: 1, total_volume: 2, last_updated: 'now' },
      ],
    };
  };
  const lookup = createMarket({ fetchImpl });
  const a = await lookup('Solana');
  assert.equal(a.asset.symbol, 'SOL');
  assert.equal(a.change24hPct, 2.35);
  const before = calls;
  await lookup('solana');
  assert.equal(calls, before, 'second lookup served from cache');

  await assert.rejects(() => lookup('zzzz'), (e) => e instanceof HttpError && e.status === 404);
  const limited = createMarket({ fetchImpl: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(() => limited('btc'), (e) => e.status === 503);
  const down = createMarket({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(() => down('btc'), (e) => e.status === 502);
});
