// Minimal Solana helpers that run in the browser (and in Node for tests). No dependencies.
// Used to build the x402 "exact" USDC payment transaction that the user's wallet signs.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(str) {
  let n = 0n;
  for (const ch of str) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('Invalid base58 character');
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  let zeros = 0;
  while (zeros < str.length && str[zeros] === '1') zeros++;
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}

export function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + out;
}

export const b64encode = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const b64decode = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
export const utf8 = (s) => new TextEncoder().encode(s);
export const jsonToB64 = (obj) => b64encode(utf8(JSON.stringify(obj)));
export const b64ToJson = (str) => JSON.parse(new TextDecoder().decode(b64decode(str)));

const key = (addr) => {
  const k = base58Decode(addr);
  if (k.length !== 32) throw new Error(`Bad address length for ${addr}`);
  return k;
};

function compactU16(n) {
  const out = [];
  let v = n;
  for (;;) {
    const low = v & 0x7f;
    v >>= 7;
    if (v === 0) {
      out.push(low);
      return out;
    }
    out.push(low | 0x80);
  }
}

const u32le = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
function u64le(n) {
  let v = BigInt(n);
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push(Number(v & 0xffn));
    v >>= 8n;
  }
  return out;
}

export const PROGRAMS = {
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  computeBudget: 'ComputeBudget111111111111111111111111111111',
  memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
};

// Builds the unsigned (legacy-format) transaction the x402 "exact" scheme expects:
//   1. ComputeBudget: set unit limit      2. ComputeBudget: set unit price
//   3. SPL Token: TransferChecked (payer's USDC -> merchant's USDC account)
//   4. Memo with a random nonce (makes every payment unique)
// Signer slot 0 is the facilitator (fee payer, signs on settle); slot 1 is the user's wallet.
// Returns the wire transaction with empty signatures, ready for the wallet to sign.
export function buildPaymentTransaction({
  feePayer,
  payer,
  sourceAta,
  destAta,
  mint,
  amount,
  decimals = 6,
  blockhash,
  computeUnitLimit = 20_000,
  computeUnitPrice = 1,
  nonce,
}) {
  const memoBytes = utf8(nonce || [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));

  // Account table, ordered as Solana requires:
  // writable signers, readonly signers, writable non-signers, readonly non-signers.
  const keys = [feePayer, payer, sourceAta, destAta, mint, PROGRAMS.token, PROGRAMS.computeBudget, PROGRAMS.memo];
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate account in payment (payer and fee payer must differ)');
  const idx = Object.fromEntries(keys.map((k, i) => [k, i]));

  const ix = [
    { program: PROGRAMS.computeBudget, accounts: [], data: [2, ...u32le(computeUnitLimit)] },
    { program: PROGRAMS.computeBudget, accounts: [], data: [3, ...u64le(computeUnitPrice)] },
    {
      program: PROGRAMS.token,
      accounts: [sourceAta, mint, destAta, payer],
      data: [12, ...u64le(amount), decimals], // TransferChecked
    },
    { program: PROGRAMS.memo, accounts: [], data: [...memoBytes] },
  ];

  const message = [
    2, // required signatures: fee payer + payer
    1, // readonly signed accounts: payer
    4, // readonly unsigned accounts: mint, token program, compute budget, memo
    ...compactU16(keys.length),
    ...keys.flatMap((k) => [...key(k)]),
    ...key(blockhash),
    ...compactU16(ix.length),
    ...ix.flatMap((i) => [
      idx[i.program],
      ...compactU16(i.accounts.length),
      ...i.accounts.map((a) => idx[a]),
      ...compactU16(i.data.length),
      ...i.data,
    ]),
  ];

  return Uint8Array.from([...compactU16(2), ...new Array(128).fill(0), ...message]);
}

// Reads a wire transaction back (used by tests and as a safety check before signing).
export function inspectTransaction(bytes) {
  let o = 0;
  const readCompact = () => {
    let n = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[o++];
      n |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return n;
      shift += 7;
    }
  };
  const nSigs = readCompact();
  const signatures = [];
  for (let i = 0; i < nSigs; i++) signatures.push(bytes.slice(o, (o += 64)));
  const header = [bytes[o++], bytes[o++], bytes[o++]];
  const nKeys = readCompact();
  const keys = [];
  for (let i = 0; i < nKeys; i++) keys.push(base58Encode(bytes.slice(o, (o += 32))));
  const blockhash = base58Encode(bytes.slice(o, (o += 32)));
  const nIx = readCompact();
  const instructions = [];
  for (let i = 0; i < nIx; i++) {
    const programIdIndex = bytes[o++];
    const nAcc = readCompact();
    const accounts = [];
    for (let a = 0; a < nAcc; a++) accounts.push(bytes[o++]);
    const nData = readCompact();
    const data = bytes.slice(o, (o += nData));
    instructions.push({ program: keys[programIdIndex], accounts: accounts.map((a) => keys[a]), data });
  }
  return { signatures, header, keys, blockhash, instructions, consumed: o, length: bytes.length };
}
