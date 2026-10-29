// Read-only Solana JSON-RPC helpers (devnet). They power the wallet payment flow (blockhash and
// token accounts), the Wallet page, the live network panel and the on-chain receipts.
import { parseReceipt } from './receipt.js';
import { getAddressEncoder, getProgramDerivedAddress, address as toAddress } from '@solana/kit';

export const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Associated token account address for (owner, mint), derived exactly as the SPL token program does.
export async function associatedTokenAddress(owner, mint = DEVNET_USDC, tokenProgram = TOKEN_PROGRAM) {
  const enc = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: toAddress(ATA_PROGRAM),
    seeds: [enc.encode(toAddress(owner)), enc.encode(toAddress(tokenProgram)), enc.encode(toAddress(mint))],
  });
  return String(ata);
}

export function createRpc({ url = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', fetchImpl = fetch, now = Date.now } = {}) {
  async function call(method, params) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(7000),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'RPC error');
    return json.result;
  }

  const cache = new Map();
  async function cached(key, ttl, fn) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = await fn();
    cache.set(key, { at: now(), value });
    if (cache.size > 200) cache.clear();
    return value;
  }

  const api = {
    call,

    async balances(addr) {
      const [sol, tokens] = await Promise.all([
        call('getBalance', [addr, { commitment: 'confirmed' }]),
        call('getTokenAccountsByOwner', [addr, { mint: DEVNET_USDC }, { encoding: 'jsonParsed' }]),
      ]);
      const usdc = (tokens?.value || []).reduce(
        (n, a) => n + Number(a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0),
        0,
      );
      return { sol: (sol?.value || 0) / 1e9, usdc, hasUsdcAccount: (tokens?.value || []).length > 0 };
    },

    // Everything the browser needs to build and sign an x402 payment for `payer`.
    async preparePayment(payer, payTo) {
      const [bh, sourceAta, destAta, bal] = await Promise.all([
        call('getLatestBlockhash', [{ commitment: 'confirmed' }]),
        associatedTokenAddress(payer),
        associatedTokenAddress(payTo),
        api.balances(payer),
      ]);
      return {
        blockhash: bh.value.blockhash,
        lastValidBlockHeight: bh.value.lastValidBlockHeight,
        sourceAta,
        destAta,
        usdc: bal.usdc,
        sol: bal.sol,
        hasUsdcAccount: bal.hasUsdcAccount,
      };
    },

    // Live network facts shown in the UI (slot, throughput, block time, typical fee).
    stats() {
      return cached('stats', 8000, async () => {
        const [slot, perf, height] = await Promise.all([
          call('getSlot', [{ commitment: 'confirmed' }]),
          call('getRecentPerformanceSamples', [4]),
          call('getBlockHeight', [{ commitment: 'confirmed' }]),
        ]);
        const sample = (perf || []).filter((p) => p.samplePeriodSecs > 0);
        const tx = sample.reduce((n, p) => n + p.numTransactions, 0);
        const secs = sample.reduce((n, p) => n + p.samplePeriodSecs, 0);
        const slots = sample.reduce((n, p) => n + p.numSlots, 0);
        return {
          slot,
          blockHeight: height,
          tps: secs ? Math.round(tx / secs) : null,
          slotTimeMs: slots ? Math.round((secs / slots) * 1000) : null,
          baseFeeLamports: 5000,
          baseFeeUsdApprox: 0.0008, // 5000 lamports at ~$160/SOL; the x402 facilitator pays it, not the buyer
          cluster: 'devnet',
        };
      });
    },

    // Verify one transaction: is it a confirmed USDC payment to the Joyhavn merchant?
    receipt(signature, payTo) {
      return cached(`receipt1:${signature}`, 20000, async () => {
        const tx = await call('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
        return parseReceipt(tx, { destAta: await associatedTokenAddress(payTo), payTo, usdcMint: DEVNET_USDC });
      });
    },

    // Real payments received by the merchant, read straight from the chain (no database).
    receipts(payTo, limit = 12) {
      return cached(`receipts:${payTo}:${limit}`, 15000, async () => {
        const destAta = await associatedTokenAddress(payTo);
        const sigs = await call('getSignaturesForAddress', [destAta, { limit, commitment: 'confirmed' }]);
        const txs = await Promise.allSettled(
          (sigs || [])
            .filter((s) => !s.err)
            .map((s) => call('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }])),
        );
        const out = [];
        for (const r of txs) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          const t = r.value;
          const meta = t.meta;
          if (!meta || meta.err) continue;
          const pre = meta.preTokenBalances || [];
          const post = meta.postTokenBalances || [];
          const bal = (list, owner) =>
            Number(list.find((b) => b.mint === DEVNET_USDC && b.owner === owner)?.uiTokenAmount?.uiAmount || 0);
          const received = bal(post, payTo) - bal(pre, payTo);
          if (received <= 0) continue;
          const payerRow = post.find((b) => b.mint === DEVNET_USDC && b.owner !== payTo && bal(pre, b.owner) > bal(post, b.owner));
          out.push({
            signature: t.transaction.signatures[0],
            slot: t.slot,
            blockTime: t.blockTime ? new Date(t.blockTime * 1000).toISOString() : null,
            amountUsdc: Number(received.toFixed(6)),
            payer: payerRow?.owner || null,
            feeLamports: meta.fee,
          });
        }
        return out.sort((a, b) => (b.slot || 0) - (a.slot || 0));
      });
    },
  };
  return api;
}
