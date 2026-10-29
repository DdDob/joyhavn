// Joyhavn API: an Express app that runs both locally (dev.js) and as a Vercel function (api/index.js).
//
// Request order matters:
//   1. CORS + JSON body
//   2. free routes (config, catalogue, wallet)
//   3. per-service input validation / preparation BEFORE the paywall (never charge for a bad request)
//   4. x402 paywall (Solana devnet, "exact" scheme, USDC)
//   5. paid handlers, reached only after payment is verified
import express from 'express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { createServices, checkInput, publicService } from './services.js';
import { createDemoBuyer } from './demoBuyer.js';
import { createRpc, BASE58_RE } from './solanaRpc.js';
import { planTask, writeReport } from './agent.js';

export const NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'; // Solana devnet (CAIP-2)

export function createApp({ env = process.env, services = createServices({ env }), rpc = createRpc() } = {}) {
  const PAY_TO = env.SOLANA_PAY_TO;
  const FACILITATOR_URL = env.FACILITATOR_URL || 'https://x402.org/facilitator';
  const configured = Boolean(PAY_TO);
  const byId = new Map(services.map((s) => [s.id, s]));

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  /* 1. CORS (lets browsers and agents read the x402 headers) + JSON */
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, PAYMENT-SIGNATURE, X-PAYMENT');
    res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use(express.json({ limit: '24kb' }));

  /* Demo buyer, created lazily so a missing key never crashes the function */
  let buyerPromise;
  const getBuyer = () =>
    (buyerPromise ??= createDemoBuyer(env.DEMO_BUYER_PRIVATE_KEY).catch((err) => {
      console.error('[demo buyer] could not start:', err.message);
      return null;
    }));

  const baseUrl = (req) => {
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return `${proto}://${host}`;
  };

  /* 2. Free routes */
  // Health and setup diagnostics: tells the UI (and you) exactly what is missing.
  app.get('/api/health', async (_req, res) => {
    const buyer = await getBuyer();
    let facilitatorOk = null;
    try {
      const r = await fetch(`${FACILITATOR_URL.replace(/\/$/, '')}/supported`, { signal: AbortSignal.timeout(4000) });
      facilitatorOk = r.ok;
    } catch {
      facilitatorOk = false;
    }
    // The merchant needs a USDC token account before it can receive x402 payments (any devnet USDC deposit creates it).
    let merchantAccount = null;
    if (configured) {
      try {
        merchantAccount = (await rpc.balances(PAY_TO)).hasUsdcAccount;
      } catch {
        merchantAccount = null;
      }
    }
    res.json({
      ok: true,
      configured,
      checks: {
        merchantWallet: configured,
        merchantAccount,
        demoWallet: Boolean(buyer),
        facilitator: facilitatorOk,
        claude: Boolean(env.ANTHROPIC_API_KEY),
      },
    });
  });

  // Free: what a browser wallet needs to build and sign an x402 payment (blockhash + token accounts).
  app.get('/api/solana/prepare', async (req, res) => {
    if (!configured) return res.status(503).json({ error: 'Server not configured: set SOLANA_PAY_TO' });
    const payer = String(req.query.payer || '');
    if (!BASE58_RE.test(payer)) return res.status(400).json({ error: 'Invalid wallet address' });
    try {
      res.json(await rpc.preparePayment(payer, PAY_TO));
    } catch (err) {
      res.status(502).json({ error: 'Could not reach the Solana devnet RPC. Try again in a moment.' });
    }
  });

  // Free: live network stats for the UI.
  app.get('/api/solana/stats', async (_req, res) => {
    try {
      res.json(await rpc.stats());
    } catch {
      res.status(502).json({ error: 'Could not reach the Solana devnet RPC.' });
    }
  });

  // Free: real on-chain payments received by the merchant wallet (read from Solana, no database).
  app.get('/api/earnings', async (_req, res) => {
    if (!configured) return res.status(503).json({ error: 'Server not configured: set SOLANA_PAY_TO' });
    try {
      const receipts = await rpc.receipts(PAY_TO);
      const total = receipts.reduce((n, r) => n + r.amountUsdc, 0);
      res.json({ merchant: PAY_TO, receipts, totalUsdc: Number(total.toFixed(6)) });
    } catch {
      res.status(502).json({ error: 'Could not read on-chain receipts right now.' });
    }
  });

  // Free: verify a payment on-chain (anyone can check any transaction signature).
  app.get('/api/receipt/:signature', async (req, res) => {
    if (!configured) return res.status(503).json({ error: 'Server not configured: set SOLANA_PAY_TO' });
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(req.params.signature)) return res.status(400).json({ error: 'That does not look like a Solana transaction signature.' });
    try {
      res.json(await rpc.receipt(req.params.signature, PAY_TO));
    } catch {
      res.status(502).json({ error: 'Could not read that transaction right now. Try again in a moment.' });
    }
  });

  // Free: machine-readable catalogue so any AI agent can discover the tools and how to pay.
  app.get('/api/catalog', (req, res) => {
    const base = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
    res.json({
      name: 'Joyhavn',
      description: 'Pay-per-request tools on Solana. Each endpoint answers HTTP 402 with a price; pay in USDC with x402 and the same request returns the result.',
      payment: {
        protocol: 'x402',
        version: 2,
        scheme: 'exact',
        network: NETWORK,
        cluster: 'devnet',
        asset: 'USDC',
        assetMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        payTo: configured ? PAY_TO : null,
        facilitator: FACILITATOR_URL,
        maxPerRequestUsd: 0.05,
        note: 'Request the endpoint without payment to receive a 402 with exact requirements, then retry with the PAYMENT-SIGNATURE header.',
      },
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        method: 'GET',
        url: `${base}${s.path}?${s.param}=<${s.paramLabel.toLowerCase()}>`,
        priceUsd: s.priceUsd,
        input: { param: s.param, maxLength: s.maxLen },
      })),
      verify: { receipt: `${base}/api/receipt/<transaction-signature>` },
    });
  });

  // Free: balances for any address (used for the connected browser wallet).
  app.get('/api/wallet/:address', async (req, res) => {
    if (!BASE58_RE.test(req.params.address)) return res.status(400).json({ error: 'Invalid wallet address' });
    try {
      res.json({ address: req.params.address, ...(await rpc.balances(req.params.address)) });
    } catch {
      res.status(502).json({ error: 'Could not reach the Solana devnet RPC.' });
    }
  });

  app.get('/api/config', async (_req, res) => {
    const buyer = await getBuyer();
    res.json({
      configured,
      network: NETWORK,
      cluster: 'devnet',
      networkName: 'Solana Devnet',
      payTo: PAY_TO || null,
      facilitator: FACILITATOR_URL,
      demoWallet: buyer ? buyer.address : null,
      scheme: 'exact',
      asset: 'USDC',
      aiEngine: env.ANTHROPIC_API_KEY ? 'claude' : 'extractive',
      version: '1.0.0',
    });
  });

  app.get('/api/services', (_req, res) => res.json(services.map(publicService)));

  app.get('/api/wallet', async (_req, res) => {
    const buyer = await getBuyer();
    const out = { demoWallet: buyer?.address || null, merchantWallet: PAY_TO || null, balances: null, merchantBalances: null };
    try {
      if (buyer) out.balances = await rpc.balances(buyer.address);
      if (PAY_TO) out.merchantBalances = await rpc.balances(PAY_TO);
    } catch {
      out.rpcError = 'Could not reach the Solana devnet RPC right now.';
    }
    res.json(out);
  });

  /* 3. Validation and preparation BEFORE the paywall */
  for (const svc of services) {
    app.use(svc.path, async (req, res, next) => {
      if (!configured) return res.status(503).json({ error: 'Server not configured: set SOLANA_PAY_TO', charged: false });
      const problem = checkInput(svc, req.query);
      if (problem) return res.status(400).json({ error: problem, charged: false });
      try {
        if (svc.prepare) req.prepared = await svc.prepare(req.query[svc.param].trim());
      } catch (err) {
        return res.status(err.status || 502).json({ error: err.message, charged: false });
      }
      next();
    });
  }

  /* 4. x402 paywall */
  if (configured) {
    const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
    const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactSvmScheme());
    const routes = Object.fromEntries(
      services.map((s) => [
        `GET ${s.path}`,
        {
          accepts: [{ scheme: 'exact', price: s.price, network: NETWORK, payTo: PAY_TO }],
          description: `${s.name}: ${s.description}`,
          mimeType: 'application/json',
        },
      ]),
    );
    app.use(paymentMiddleware(routes, resourceServer));
  }

  /* 5. Paid handlers */
  for (const svc of services) {
    app.get(svc.path, async (req, res) => {
      try {
        const result = await svc.run(req.query[svc.param], req.prepared);
        res.json({ service: svc.id, result });
      } catch (err) {
        console.error(`[${svc.id}]`, err);
        res.status(err.status || 500).json({ error: err.message || 'Service error' });
      }
    });
  }

  /* Demo wallet endpoints (devnet) with a basic per-instance rate limit */
  const hits = new Map();
  const limited = (req, res, next) => {
    const now = Date.now();
    if (hits.size > 1000) hits.clear();
    const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
    if (recent.length >= 20) return res.status(429).json({ error: 'Slow down: the demo wallet allows 20 payments per minute.' });
    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };

  const demoRoute = (method) => async (req, res) => {
    if (!configured) return res.status(503).json({ error: 'Server not configured: set SOLANA_PAY_TO' });
    const buyer = await getBuyer();
    if (!buyer) return res.status(503).json({ error: 'Demo wallet not configured: set DEMO_BUYER_PRIVATE_KEY' });
    const svc = byId.get(req.params.id);
    if (!svc) return res.status(404).json({ error: 'Unknown service' });
    const input = req.body?.input;
    if (typeof input !== 'string') return res.status(400).json({ error: 'Missing "input"' });
    const problem = checkInput(svc, { [svc.param]: input });
    if (problem) return res.status(400).json({ error: problem });
    try {
      res.json(await buyer[method](svc, input, baseUrl(req)));
    } catch (err) {
      console.error(`[demo ${method}]`, err);
      res.status(500).json({ ok: false, error: err.message });
    }
  };
  app.post('/api/demo/pay/:id', limited, demoRoute('pay'));
  app.post('/api/demo/fail/:id', limited, demoRoute('payBad'));

  /* Agent: plan which paid services to buy, and write the final answer. Free; no payment happens here. */
  app.post('/api/agent/plan', limited, async (req, res) => {
    const task = req.body?.task;
    if (typeof task !== 'string' || task.trim().length < 3 || task.length > 4000) return res.status(400).json({ error: 'Describe a task in 3 to 4000 characters.' });
    res.json(await planTask(task.trim(), services, env));
  });
  app.post('/api/agent/report', limited, async (req, res) => {
    const { task, results } = req.body || {};
    if (typeof task !== 'string' || !Array.isArray(results) || results.length > 6) return res.status(400).json({ error: 'Invalid report request.' });
    res.json(await writeReport(task.slice(0, 4000), results.map((r) => ({ service: String(r.service), result: r.result })), env));
  });

  /* Unknown API routes */
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  });

  return app;
}
