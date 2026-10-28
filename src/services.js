// Joyhavn service registry. Every entry becomes a paid x402 route (see app.js).
//
// A service defines:
//   validate(input)        sync, returns an error string or null. Runs BEFORE the paywall.
//   prepare(input)         optional async step that also runs BEFORE the paywall (e.g. a live
//                          lookup that might fail). Throw HttpError to reject without charging.
//   run(input, prepared)   runs only AFTER payment is verified. Should not be able to fail.
import { createMarket } from './market.js';
import { summarize } from './summarize.js';

/* ------------------------------------------------------------------ */
/* URL Safety Scan                                                     */
/* ------------------------------------------------------------------ */

const RISKY_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'tk', 'ml', 'ga', 'cf', 'gq', 'work', 'support', 'country', 'loan']);
const PHISH_WORDS = [
  'login', 'signin', 'verify', 'secure', 'account', 'update', 'wallet', 'airdrop', 'claim', 'seed',
  'recovery', 'connect', 'validate', 'suspended', 'unlock', 'bonus', 'giveaway',
];
const BRANDS = ['paypal', 'binance', 'coinbase', 'phantom', 'solana', 'metamask', 'google', 'apple', 'microsoft', 'amazon', 'bank'];

export function urlRisk(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { valid: false, error: 'Not a valid absolute URL (include https://)' };
  }
  if (!['http:', 'https:'].includes(u.protocol)) return { valid: false, error: 'Only http(s) URLs are supported' };

  const host = u.hostname.toLowerCase();
  const labels = host.split('.');
  const tld = labels[labels.length - 1];
  const registrable = labels.slice(-2).join('.');
  const flags = [];
  const add = (points, code, detail) => flags.push({ points, code, detail });

  if (u.protocol === 'http:') add(15, 'no_tls', 'Uses plain HTTP, not HTTPS');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) add(30, 'ip_host', 'Host is a raw IP address');
  if (host.includes('xn--')) add(25, 'punycode', 'Punycode hostname (possible lookalike characters)');
  if (labels.length > 4) add(15, 'many_subdomains', `${labels.length} hostname labels, deep subdomain chain`);
  if (RISKY_TLDS.has(tld)) add(15, 'risky_tld', `.${tld} is frequently abused`);
  if (u.username || u.password) add(30, 'credentials_in_url', 'URL embeds credentials (user@host trick)');
  if (rawUrl.length > 120) add(10, 'long_url', 'Unusually long URL');
  if ((host.match(/-/g) || []).length >= 3) add(10, 'hyphens', 'Many hyphens in hostname');

  const hay = `${host}${u.pathname}`.toLowerCase();
  const words = PHISH_WORDS.filter((w) => hay.includes(w));
  if (words.length) add(Math.min(30, 10 * words.length), 'phish_keywords', `Contains: ${words.join(', ')}`);

  for (const brand of BRANDS) {
    if (host.includes(brand) && registrable !== `${brand}.com`) {
      add(25, 'brand_lookalike', `Mentions "${brand}" but is not ${brand}.com`);
      break;
    }
  }

  const score = Math.min(100, flags.reduce((n, f) => n + f.points, 0));
  const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return {
    valid: true,
    url: u.toString(),
    host,
    score,
    level,
    flags,
    verdict:
      level === 'high'
        ? 'Likely unsafe. Do not enter credentials or connect a wallet.'
        : level === 'medium'
          ? 'Suspicious. Verify the domain through another channel first.'
          : 'No strong risk signals found. Still verify before connecting a wallet.',
    method: 'Heuristic checks only (no reputation database). Treat as a signal, not a guarantee.',
  };
}

/* ------------------------------------------------------------------ */
/* JSON Validator                                                      */
/* ------------------------------------------------------------------ */

function depthOf(v) {
  if (v === null || typeof v !== 'object') return 0;
  const kids = Array.isArray(v) ? v : Object.values(v);
  return 1 + Math.max(0, ...kids.map(depthOf));
}
function keysOf(v) {
  if (v === null || typeof v !== 'object') return 0;
  if (Array.isArray(v)) return v.reduce((n, x) => n + keysOf(x), 0);
  return Object.keys(v).length + Object.values(v).reduce((n, x) => n + keysOf(x), 0);
}

// Finds the index of the first syntax error in a JSON text (null if none). JSON.parse error
// wording differs between Node versions and sometimes has no position, so we locate it ourselves.
export function findJsonErrorIndex(s) {
  let i = 0;
  const fail = (p) => {
    throw p;
  };
  const ws = () => {
    while (i < s.length && ' \n\r\t'.includes(s[i])) i++;
  };
  const str = () => {
    i++;
    while (i < s.length) {
      const c = s[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c === '\\') {
        const e = s[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) fail(i);
          i += 6;
        } else if ('"\\/bfnrt'.includes(e || '\0')) i += 2;
        else fail(i);
      } else if (c < ' ') fail(i);
      else i++;
    }
    fail(i);
  };
  const value = () => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++;
      ws();
      if (s[i] === '}') return void i++;
      for (;;) {
        ws();
        if (s[i] !== '"') fail(i);
        str();
        ws();
        if (s[i] !== ':') fail(i);
        i++;
        value();
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === '}') return void i++;
        fail(i);
      }
    } else if (c === '[') {
      i++;
      ws();
      if (s[i] === ']') return void i++;
      for (;;) {
        value();
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === ']') return void i++;
        fail(i);
      }
    } else if (c === '"') str();
    else {
      const m = /true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
      m.lastIndex = i;
      const r = m.exec(s);
      if (!r) fail(i);
      i += r[0].length;
    }
  };
  try {
    value();
    ws();
    if (i < s.length) fail(i);
    return null;
  } catch (p) {
    if (typeof p === 'number') return p;
    throw p;
  }
}

export function validateJson(text) {
  try {
    const value = JSON.parse(text);
    return {
      valid: true,
      type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
      totalKeys: keysOf(value),
      depth: depthOf(value),
      bytes: Buffer.byteLength(text),
      formatted: JSON.stringify(value, null, 2),
    };
  } catch (err) {
    const msg = String(err.message);
    let line = null;
    let column = null;
    const idx = findJsonErrorIndex(text);
    if (idx !== null) {
      const before = text.slice(0, idx);
      line = before.split('\n').length;
      column = before.length - before.lastIndexOf('\n');
    }
    return {
      valid: false,
      error: msg.replace(/ in JSON at position \d+.*$/, '').replace(/, \.\.\..*$/, ''),
      line,
      column,
      character: idx !== null ? (text[idx] ?? 'end of input') : null,
      bytes: Buffer.byteLength(text),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export function createServices({ lookupAsset = createMarket(), env = process.env, fetchImpl = fetch } = {}) {
  return [
    {
      id: 'url-safety-scan',
      name: 'URL Safety Scan',
      icon: 'link',
      category: 'Security',
      description: 'Check if a link is safe, malicious or suspicious before you click.',
      path: '/api/v1/url-safety-scan',
      price: '$0.005',
      priceUsd: 0.005,
      param: 'url',
      paramLabel: 'URL to scan',
      example: 'https://phantom-airdrop-claim.secure-verify.xyz/connect-wallet',
      maxLen: 500,
      validate: (input) => {
        const r = urlRisk(input);
        return r.valid ? null : r.error;
      },
      run: async (input) => urlRisk(input),
    },
    {
      id: 'ai-summary',
      name: 'AI Summary',
      icon: 'doc',
      category: 'Writing',
      description: 'Get a clear, concise summary of any article or document.',
      path: '/api/v1/ai-summary',
      price: '$0.008',
      priceUsd: 0.008,
      param: 'text',
      paramLabel: 'Text to summarise',
      example:
        'Solana is a high-performance blockchain known for fast confirmation and very low fees. Developers use it to build payments, games and trading apps. x402 revives the HTTP 402 Payment Required status code so that a client can pay for an API call inside the same request. Combined, they make tiny pay-per-use payments practical. A caller requests a resource, receives the price, signs a USDC transfer and retries. The server verifies the payment and returns the result without accounts, API keys or subscriptions.',
      maxLen: 3000,
      validate: (input) => (input.trim().length < 40 ? 'Provide at least 40 characters of text to summarise' : null),
      run: async (input) => summarize(input.trim(), env, fetchImpl),
    },
    {
      id: 'data-snapshot',
      name: 'Data Snapshot',
      icon: 'db',
      category: 'Market data',
      description: 'Get a live market snapshot for any crypto asset: price, 24h change, volume and rank.',
      path: '/api/v1/data-snapshot',
      price: '$0.01',
      priceUsd: 0.01,
      param: 'asset',
      paramLabel: 'Crypto asset (name or symbol)',
      example: 'solana',
      maxLen: 60,
      validate: (input) => (input.trim() ? null : 'Enter an asset name or symbol'),
      prepare: (input) => lookupAsset(input),
      run: async (_input, prepared) => ({ ...prepared, deliveredAt: new Date().toISOString() }),
    },
    {
      id: 'json-validator',
      name: 'JSON Validator',
      icon: 'code',
      category: 'Developer tools',
      description: 'Validate and format JSON data with detailed error messages.',
      path: '/api/v1/json-validator',
      price: '$0.003',
      priceUsd: 0.003,
      param: 'json',
      paramLabel: 'JSON to validate',
      example: '{"name": "Joyhavn", "network": "solana", "services": [1, 2, 3],}',
      maxLen: 2000,
      validate: (input) => (input.trim() ? null : 'Provide some JSON to validate'),
      run: async (input) => validateJson(input),
    },
  ];
}

// Shared input check used before the paywall.
export function checkInput(service, query) {
  const value = query?.[service.param];
  if (typeof value !== 'string' || value.trim() === '') return `Missing required query parameter "${service.param}"`;
  if (value.length > service.maxLen) return `"${service.param}" is too long (max ${service.maxLen} characters)`;
  return service.validate(value);
}

export const publicService = (s) => ({
  id: s.id,
  name: s.name,
  icon: s.icon,
  category: s.category,
  description: s.description,
  path: s.path,
  price: s.price,
  priceUsd: s.priceUsd,
  param: s.param,
  paramLabel: s.paramLabel,
  example: s.example,
  maxLen: s.maxLen,
});
