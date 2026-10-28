// Helpers for reading x402 v2 headers (display only; signing, verification and settlement
// are always done by the official @x402 libraries).

export function decodeHeader(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// USDC has 6 decimals.
export const usdcFromBase = (amount) => (Number(amount) / 1_000_000).toString();

export function explorerTx(sig, cluster = 'devnet') {
  return sig ? `https://explorer.solana.com/tx/${sig}?cluster=${cluster}` : null;
}
