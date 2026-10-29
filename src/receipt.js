// Turns a Solana transaction (jsonParsed) into a plain, checkable payment receipt.
// Pure function: no network, so it is unit tested.
export function parseReceipt(tx, { destAta, payTo, usdcMint }) {
  if (!tx) return { found: false };
  const meta = tx.meta || {};
  const msg = tx.transaction?.message || {};
  const keys = (msg.accountKeys || []).map((k) => (typeof k === 'string' ? k : k.pubkey));
  const all = [...(msg.instructions || []), ...((meta.innerInstructions || []).flatMap((i) => i.instructions || []))];

  const transfer = all.find((i) => i.parsed && ['transferChecked', 'transfer'].includes(i.parsed.type) && (i.program === 'spl-token' || i.programId));
  const info = transfer?.parsed?.info || {};
  const memoIx = all.find((i) => i.program === 'spl-memo');
  const amountUsdc = info.tokenAmount?.uiAmount ?? (info.amount ? Number(info.amount) / 1e6 : null);

  const confirmed = !meta.err;
  const isUsdc = !info.mint || info.mint === usdcMint;
  const paidToMerchant = Boolean(destAta) && info.destination === destAta;

  return {
    found: true,
    signature: tx.transaction?.signatures?.[0] || null,
    slot: tx.slot ?? null,
    blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    confirmed,
    error: meta.err ? JSON.stringify(meta.err) : null,
    feeLamports: meta.fee ?? null,
    feePayer: keys[0] || null,
    payer: info.authority || info.multisigAuthority || null,
    amountUsdc,
    mint: info.mint || null,
    destinationAccount: info.destination || null,
    merchant: payTo || null,
    memo: memoIx?.parsed ?? null,
    checks: {
      confirmedOnChain: confirmed,
      isUsdcTransfer: Boolean(transfer) && isUsdc,
      paidToJoyhavnMerchant: paidToMerchant,
      feeSponsoredByFacilitator: Boolean(keys[0]) && Boolean(info.authority) && keys[0] !== info.authority,
    },
  };
}
