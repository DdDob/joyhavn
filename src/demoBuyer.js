// Demo buyer: a disposable devnet wallet that pays on the user's behalf so the UI can show the
// whole x402 flow without a browser wallet. Devnet only.
import { base58 } from '@scure/base';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { decodeHeader, usdcFromBase, explorerTx } from './x402util.js';

const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAX_BASE_UNITS = 50_000n; // spend cap per payment: 0.05 USDC

export async function createDemoBuyer(secret) {
  if (!secret) return null;
  const signer = await createKeyPairSignerFromBytes(base58.decode(secret));
  const client = new x402Client();

  // Spend controls: only devnet USDC, never more than the cap per request.
  client.registerPolicy((_version, requirements) =>
    requirements.filter(
      ({ network, asset, amount }) => network === DEVNET && asset === DEVNET_USDC && BigInt(amount) <= MAX_BASE_UNITS,
    ),
  );
  client.register('solana:*', new ExactSvmScheme(signer));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const buildUrl = (service, input, baseUrl) => {
    const url = new URL(service.path, baseUrl);
    url.searchParams.set(service.param, input);
    return url.toString();
  };

  async function readRequirements(res) {
    const fromHeader = decodeHeader(res.headers.get('payment-required'));
    const body = fromHeader || (await res.json().catch(() => null));
    const accept = body?.accepts?.[0];
    if (!accept) return null;
    return {
      scheme: accept.scheme,
      network: accept.network,
      asset: accept.asset,
      payTo: accept.payTo,
      amount: accept.amount,
      amountUsdc: usdcFromBase(accept.amount),
    };
  }

  return {
    address: signer.address,

    // Happy path: probe (402) -> sign and pay -> verified and settled -> resource.
    async pay(service, input, baseUrl) {
      const url = buildUrl(service, input, baseUrl);
      const t0 = Date.now();

      const probe = await fetch(url);
      if (probe.status !== 402) {
        const body = await probe.json().catch(() => null);
        return {
          ok: false,
          stage: 'request',
          status: probe.status,
          error: body?.error || `Expected 402 Payment Required, got ${probe.status}`,
        };
      }
      const requirements = await readRequirements(probe);
      const tProbe = Date.now();

      let paid;
      try {
        paid = await fetchWithPayment(url);
      } catch (err) {
        return { ok: false, stage: 'payment', requirements, error: `Could not complete payment: ${err.message}` };
      }
      const body = await paid.json().catch(() => null);
      if (!paid.ok) {
        return {
          ok: false,
          stage: 'payment',
          status: paid.status,
          requirements,
          error: body?.error || `Payment was not accepted (HTTP ${paid.status}). No result was delivered.`,
        };
      }

      const settle = decodeHeader(paid.headers.get('payment-response'));
      return {
        ok: true,
        requirements,
        payer: signer.address,
        settlement: {
          success: settle?.success ?? true,
          transaction: settle?.transaction || null,
          network: settle?.network || requirements?.network,
          explorerUrl: explorerTx(settle?.transaction),
        },
        result: body,
        timings: { requestMs: tProbe - t0, payAndUnlockMs: Date.now() - tProbe },
      };
    },

    // Failure path: a forged payment, to show a rejection where nothing is delivered.
    async payBad(service, input, baseUrl) {
      const url = buildUrl(service, input, baseUrl);
      const res = await fetch(url, {
        headers: { 'PAYMENT-SIGNATURE': Buffer.from('not-a-real-payment').toString('base64') },
      });
      const body = await res.json().catch(() => null);
      return {
        ok: false,
        stage: 'verification',
        status: res.status,
        error: body?.error || 'Payment verification failed',
        delivered: res.status === 200,
      };
    },
  };
}
