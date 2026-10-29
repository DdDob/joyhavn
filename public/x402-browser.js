// x402 client for the browser: probe -> HTTP 402 -> user's wallet signs a USDC transfer -> retry
// with the payment -> server verifies and settles on Solana -> resource unlocked.
import { buildPaymentTransaction, inspectTransaction, b64encode, b64ToJson, jsonToB64 } from './solana.js';
import { signTransaction, isUserRejection } from './wallet.js';

const DEVNET_NET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAX_BASE_UNITS = 50_000n; // same spend cap as the server demo wallet: 0.05 USDC per request

export class PayError extends Error {
  constructor(stage, message, extra = {}) {
    super(message);
    this.stage = stage;
    Object.assign(this, extra);
  }
}

async function readJson(res) {
  return res.json().catch(() => null);
}

// onStep(stepIndex, status, html) lets the UI show progress.
// Phase 1: ask for the price, then build the unsigned USDC transfer for `payer`.
export async function preparePayment({ url, payer, onStep = () => {} }) {
  const t0 = performance.now();

  /* 1. Request without payment */
  onStep(0, 'active', 'Calling the service with no payment…');
  let probe;
  try {
    probe = await fetch(url);
  } catch {
    throw new PayError('request', 'Could not reach the Joyhavn API.');
  }
  if (probe.status !== 402) {
    const body = await readJson(probe);
    throw new PayError('request', body?.error || `Expected 402 Payment Required, got ${probe.status}`, { status: probe.status });
  }
  const header = probe.headers.get('payment-required');
  const required = header ? b64ToJson(header) : await readJson(probe);
  const accept = required?.accepts?.find((a) => a.scheme === 'exact' && a.network === DEVNET_NET && a.asset === DEVNET_USDC);
  if (!accept) throw new PayError('request', 'The server did not offer a Solana devnet USDC payment option.');
  if (BigInt(accept.amount) > MAX_BASE_UNITS) throw new PayError('request', 'Price is above the 0.05 USDC safety cap. Payment refused.');
  const feePayer = accept.extra?.feePayer;
  if (!feePayer) throw new PayError('request', 'The facilitator did not provide a fee payer.');
  const amountUsdc = Number(accept.amount) / 1e6;
  onStep(0, 'done', 'Called the endpoint with no payment.');
  onStep(1, 'done', `Server asked for <strong>${amountUsdc} USDC</strong> to <code>${accept.payTo.slice(0, 4)}…${accept.payTo.slice(-4)}</code> on Solana devnet.`);

  /* 2. Build the transfer */
  onStep(2, 'active', 'Preparing your USDC transfer…');
  const prep = await fetch(`/api/solana/prepare?payer=${encodeURIComponent(payer)}`).then(readJson);
  if (!prep || prep.error) throw new PayError('payment', prep?.error || 'Could not prepare the payment.');
  if (!prep.hasUsdcAccount || prep.usdc < amountUsdc) {
    throw new PayError('funds', prep.hasUsdcAccount ? `Your wallet has ${prep.usdc} devnet USDC, but this costs ${amountUsdc}.` : 'Your wallet has no devnet USDC yet.', { needFunds: true });
  }
  const unsigned = buildPaymentTransaction({
    feePayer,
    payer,
    sourceAta: prep.sourceAta,
    destAta: prep.destAta,
    mint: accept.asset,
    amount: BigInt(accept.amount),
    blockhash: prep.blockhash,
  });
  // Safety check: the bytes we send to the wallet must contain exactly the transfer we described.
  const check = inspectTransaction(unsigned);
  if (check.instructions.length !== 4 || check.keys[0] !== feePayer || check.keys[1] !== payer) {
    throw new PayError('payment', 'Internal check failed: refusing to sign.');
  }
  return { url, payer, required, accept, amountUsdc, unsigned, t0 };
}

// Turns the facilitator's error codes into plain language. Every failure here means nothing was charged.
function friendlyPaymentError(raw, status) {
  const code = String(raw || '');
  if (/recipient_ata_missing/.test(code)) return 'This service’s payout account is not activated yet, so the payment was not sent. You were not charged.';
  if (/insufficient|balance/i.test(code)) return 'Your wallet does not have enough devnet USDC for this payment. You were not charged.';
  if (/blockhash|expired|timeout/i.test(code)) return 'The approval took too long and the payment expired. Please try again. You were not charged.';
  if (/simulation|simulate/i.test(code)) return 'The Solana network could not simulate this payment, so it was not sent. Check your devnet USDC balance and try again. You were not charged.';
  if (code && !/^\{/.test(code)) return `Payment was not accepted (${code.replace(/_/g, ' ')}). You were not charged.`;
  return `Payment was not accepted (HTTP ${status}). No result was delivered and you were not charged.`;
}

// Phase 2: attach the signed transaction; the server verifies and settles on Solana.
export async function submitPayment({ url, payer, required, accept, amountUsdc, signed, onStep = () => {}, t0 = performance.now() }) {
  onStep(2, 'active', 'Signed. The server is verifying and settling on Solana…');
  const payload = {
    x402Version: required.x402Version ?? 2,
    resource: required.resource,
    accepted: accept,
    payload: { transaction: b64encode(signed) },
    ...(required.extensions ? { extensions: required.extensions } : {}),
  };
  const tPay = performance.now();
  let paid;
  try {
    paid = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': jsonToB64(payload) } });
  } catch {
    throw new PayError('payment', 'Network error while submitting the payment.');
  }
  const body = await readJson(paid);
  if (!paid.ok) {
    throw new PayError('payment', friendlyPaymentError(body?.error, paid.status), { status: paid.status });
  }
  const settleHeader = paid.headers.get('payment-response');
  let settle = null;
  try {
    settle = settleHeader ? b64ToJson(settleHeader) : null;
  } catch {
    /* header unreadable: result still delivered */
  }
  return {
    ok: true,
    requirements: accept,
    amountUsdc,
    payer,
    settlement: { success: settle?.success ?? true, transaction: settle?.transaction || null, network: settle?.network || accept.network },
    result: body,
    timings: { requestMs: Math.round(tPay - t0), payAndUnlockMs: Math.round(performance.now() - tPay) },
  };
}

// One-shot helper for wallets that sign in-page (extensions, in-app browsers, the agent's own wallet).
// `sign` defaults to the user's connected wallet; the agent passes its own signer.
export async function payWithWallet({ url, payer, onStep = () => {}, sign = signTransaction }) {
  const p = await preparePayment({ url, payer, onStep });
  onStep(2, 'active', 'Approve the payment in your wallet…');
  let signed;
  try {
    signed = await sign(p.unsigned);
  } catch (err) {
    if (isUserRejection(err)) throw new PayError('rejected', 'You cancelled the request in your wallet. Nothing was charged.');
    throw new PayError('payment', `Wallet could not sign: ${err.message || err}`);
  }
  return submitPayment({ ...p, signed, onStep });
}
