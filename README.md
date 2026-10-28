# Joyhavn

**Pay for tools only when you need them.**

Joyhavn is a pay-per-request tool marketplace on Solana. Each tool is priced per call. A caller pays a fraction of a cent in USDC over plain HTTP using [x402](https://x402.org), and the result unlocks the moment the payment settles. No accounts, API keys, subscriptions or checkout pages.

Built for the **Best Use of x402 on Solana** track (Encode Club). Runs on **Solana devnet** (test money only).

## Services

| Service | Endpoint | Price |
| --- | --- | --- |
| URL Safety Scan | `GET /api/v1/url-safety-scan?url=` | $0.005 |
| AI Summary | `GET /api/v1/ai-summary?text=` | $0.008 |
| Data Snapshot | `GET /api/v1/data-snapshot?asset=` | $0.01 |
| JSON Validator | `GET /api/v1/json-validator?json=` | $0.003 |

- **URL Safety Scan**: heuristic phishing and wallet-drainer scoring (no reputation database; a signal, not a guarantee).
- **AI Summary**: uses Claude when `ANTHROPIC_API_KEY` is set, otherwise a local extractive summariser. It falls back automatically, so it never fails after payment.
- **Data Snapshot**: live crypto price, 24h/7d change, volume and rank from CoinGecko's public API.
- **JSON Validator**: validates and formats JSON and reports the exact line and column of an error.

## How the payment flow works

```
Client                 Joyhavn API (Vercel)            Facilitator           Solana
  | GET /api/v1/…         |                                 |                   |
  |---------------------->|  validate input (free, no charge)                   |
  |<- 402 PAYMENT-REQUIRED (price, USDC mint, payTo)        |                   |
  | sign USDC transfer    |                                 |                   |
  |-- GET + PAYMENT-SIGNATURE -> /verify ------------------>|                   |
  |                       |-- run service -> /settle ------>|-- submit tx ----->|
  |<- 200 + result + PAYMENT-RESPONSE (tx signature)        |<- confirmed ------|
```

## How Solana powers it

- Payments are real SPL-token (USDC) transfers on Solana using the x402 v2 `exact` scheme (`@x402/svm`), network `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet).
- Sub-cent prices only make sense because Solana fees and finality are low. The facilitator submits the transaction and sponsors the network fee, so a buyer needs only USDC.
- The merchant wallet is paid directly. Joyhavn holds no balances.

## Connecting a wallet (no pasting)

Click **Connect wallet**. Wallets announce themselves to the page through the [Wallet Standard](https://github.com/wallet-standard/wallet-standard), so the user just picks Phantom, Solflare or Backpack and approves. On a phone, the picker offers **Open in Phantom / Solflare**, which reopens the site inside the wallet app. For devnet in Phantom: *Settings → Developer Settings → Testnet Mode*.

When the user presses **Pay**, the browser:
1. calls the endpoint and receives `402` with the price, USDC mint, merchant address and the facilitator's fee payer;
2. builds the USDC `TransferChecked` transaction (`public/solana.js`, no dependencies, unit tested);
3. asks the wallet to sign it (the wallet holds the key; the facilitator pays the SOL fee);
4. retries with the `PAYMENT-SIGNATURE` header; the server verifies and settles on Solana and returns the result plus the transaction signature.

Rejected in the wallet, wrong balance or a failed settlement all end with **nothing charged and nothing delivered**.

## Where Solana is visible in the product

- Every payment is a real USDC transfer; the receipt links to Solana Explorer.
- **Home** shows live devnet slot, throughput and slot time from the RPC.
- **Developers** shows earnings read directly from the chain (merchant token account history), not a database.
- **Wallet** shows the connected wallet's SOL and USDC balances.

## Failed payments and fairness

- **Input is validated before the paywall.** A bad request (malformed URL, unknown crypto asset, empty input) returns `400`/`404` with `charged: false`. The caller never sees a payment request for something that would fail.
- **No charge for errors.** The x402 Express middleware does not settle a payment if the handler responds with status 400 or higher. If settlement itself fails, the middleware returns `402` and withholds the result.
- **Forged or invalid payments are rejected** at verification with `402`. The "Simulate failed payment" button demonstrates this.
- **Spend controls.** The demo buyer only signs devnet USDC and never more than 0.05 USDC per request.

## Deploy to Vercel (from GitHub)

1. Put this folder in a GitHub repository (files at the top level of the repo: `api/`, `src/`, `public/`, `package.json`, `vercel.json`).
2. In Vercel: **Add New → Project → Import** the repository. Framework preset **Other**. Leave build settings empty.
3. Add **Environment Variables** (Project Settings):

   | Name | Value |
   | --- | --- |
   | `SOLANA_PAY_TO` | merchant wallet address (receives payments) |
   | `DEMO_BUYER_PRIVATE_KEY` | optional: powers the "Quick demo (no wallet)" button; devnet only |
   | `FACILITATOR_URL` | `https://x402.org/facilitator` |
   | `ANTHROPIC_API_KEY` | optional, for Claude-powered summaries |

4. Fund the **merchant** wallet (and your own Phantom wallet, plus the demo wallet if used) with devnet USDC at <https://faucet.circle.com> (Solana, Devnet, USDC). Funding the merchant wallet also creates its USDC token account, which settlement requires.
5. Deploy, then open the **Production** URL (the `*.vercel.app` domain without a hash). The demo wallet calls your own API, so use the production domain rather than a protected preview URL.
6. Open **Wallet** in the app to confirm balances, then press **Pay & Run** on any service.

Generate fresh wallets any time with `npm run keygen`. Never put a mainnet key in these variables.

## Run locally

Requires Node 20+.

```bash
npm install
cp .env.example .env     # fill SOLANA_PAY_TO and DEMO_BUYER_PRIVATE_KEY (npm run keygen)
npm run dev              # http://localhost:4021
npm test                 # service logic tests, no network needed
npm run buyer -- data-snapshot bitcoin    # pay from the command line
```

## Project layout

```
api/index.js        Vercel serverless entry (exports the Express app)
src/app.js          Express app: free routes, pre-paywall validation, x402 paywall, paid handlers
src/services.js     The four services (validate / prepare / run)
src/summarize.js    AI Summary (Claude with local fallback)
src/market.js       Data Snapshot lookup (CoinGecko, cached)
src/demoBuyer.js    x402 client with spend policy
src/solanaRpc.js    Balances, blockhash/token accounts, network stats, on-chain receipts
public/             Dashboard (no build step, hash routing)
public/wallet.js    Wallet Standard connection
public/solana.js    Browser transaction builder
public/x402-browser.js  Pay-with-wallet x402 client
dev.js              Local dev server
test/               Unit tests
```

## Honest limits

- Devnet only. Mainnet needs a production facilitator, the mainnet network ID and a funded merchant wallet.
- Users pay from their own browser wallet (Phantom, Solflare, Backpack via the Wallet Standard). An optional server-side demo wallet ("Quick demo") exists for people without a wallet.
- Activity and analytics are stored in the visitor's browser (`localStorage`), not on a server, because serverless functions have no persistent disk. The Payments page of record is the Solana Explorer link on each transaction.
- The demo endpoints are rate limited per function instance (20 payments/minute per IP), which is best-effort on serverless.

## Submission checklist

- [x] Working demo on Solana devnet
- [x] Repository with README and setup instructions
- [ ] 2-4 minute demo video: Home → Pay & Run a service → open the transaction on Solana Explorer → Simulate failed payment → Activity
- [x] Explanation of how Solana powers the project (above)
