// Data Snapshot engine: live crypto market data from CoinGecko's public API (no key needed).
// The lookup runs BEFORE the paywall (see app.js) and is cached, so a caller is never asked
// to pay for a lookup that would fail.
import { HttpError } from './errors.js';

const TTL_MS = 60_000;

export function createMarket({ fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();

  async function cg(path) {
    let res;
    try {
      res = await fetchImpl(`https://api.coingecko.com/api/v3${path}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      throw new HttpError(502, 'Market data provider is unreachable. Try again shortly.');
    }
    if (res.status === 429) throw new HttpError(503, 'Market data provider is rate limited. Try again in a minute.');
    if (!res.ok) throw new HttpError(502, 'Market data provider returned an error. Try again shortly.');
    return res.json();
  }

  return async function lookupAsset(query) {
    const key = query.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.data;

    const search = await cg(`/search?query=${encodeURIComponent(key)}`);
    const coin = search?.coins?.[0];
    if (!coin) throw new HttpError(404, `No crypto asset found for "${query}". Try a name like "solana" or a symbol like "SOL".`);

    const markets = await cg(`/coins/markets?vs_currency=usd&ids=${encodeURIComponent(coin.id)}&price_change_percentage=24h,7d`);
    const m = Array.isArray(markets) ? markets[0] : null;
    if (!m) throw new HttpError(502, 'Market data is not available for this asset right now.');

    const data = {
      asset: { id: m.id, name: m.name, symbol: String(m.symbol || '').toUpperCase(), marketCapRank: m.market_cap_rank ?? null },
      priceUsd: m.current_price,
      change24hPct: m.price_change_percentage_24h != null ? Number(m.price_change_percentage_24h.toFixed(2)) : null,
      change7dPct:
        m.price_change_percentage_7d_in_currency != null ? Number(m.price_change_percentage_7d_in_currency.toFixed(2)) : null,
      high24hUsd: m.high_24h,
      low24hUsd: m.low_24h,
      marketCapUsd: m.market_cap,
      volume24hUsd: m.total_volume,
      asOf: m.last_updated,
      source: 'CoinGecko',
    };
    cache.set(key, { at: now(), data });
    return data;
  };
}
