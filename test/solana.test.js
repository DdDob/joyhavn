import test from 'node:test';
import assert from 'node:assert/strict';
import { base58Decode, base58Encode, buildPaymentTransaction, inspectTransaction, PROGRAMS } from '../public/solana.js';

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const A = (n) => base58Encode(new Uint8Array(32).fill(n));

test('base58 round trips and known values', () => {
  assert.equal(base58Encode(new Uint8Array(32)), '11111111111111111111111111111111');
  assert.equal(base58Decode(MINT).length, 32);
  assert.equal(base58Encode(base58Decode(MINT)), MINT);
  assert.equal(base58Encode(base58Decode(PROGRAMS.token)), PROGRAMS.token);
  assert.throws(() => base58Decode('0OIl'));
});

test('payment transaction has the exact layout x402 verifies', () => {
  const [feePayer, payer, src, dst] = [A(1), A(2), A(3), A(4)];
  const blockhash = A(9);
  const tx = buildPaymentTransaction({ feePayer, payer, sourceAta: src, destAta: dst, mint: MINT, amount: 5000n, blockhash, nonce: 'abc' });
  const t = inspectTransaction(tx);
  assert.equal(t.consumed, t.length, 'no trailing bytes');
  assert.equal(t.signatures.length, 2);
  assert.ok(t.signatures.every((s) => s.every((b) => b === 0)), 'signature slots start empty');
  assert.deepEqual(t.header, [2, 1, 4]);
  assert.equal(t.keys[0], feePayer);
  assert.equal(t.keys[1], payer);
  assert.equal(t.blockhash, blockhash);
  assert.equal(t.instructions.length, 4);
  const [limit, price, transfer, memo] = t.instructions;
  assert.equal(limit.program, PROGRAMS.computeBudget);
  assert.equal(limit.data[0], 2);
  assert.equal(price.program, PROGRAMS.computeBudget);
  assert.equal(price.data[0], 3);
  assert.equal(transfer.program, PROGRAMS.token);
  assert.equal(transfer.data[0], 12, 'TransferChecked');
  assert.equal(new DataView(transfer.data.buffer, transfer.data.byteOffset).getBigUint64(1, true), 5000n);
  assert.equal(transfer.data[9], 6, 'USDC decimals');
  assert.deepEqual(transfer.accounts, [src, MINT, dst, payer]);
  assert.equal(memo.program, PROGRAMS.memo);
  assert.equal(new TextDecoder().decode(memo.data), 'abc');
});

test('rejects a payer equal to the fee payer', () => {
  assert.throws(() => buildPaymentTransaction({ feePayer: A(1), payer: A(1), sourceAta: A(3), destAta: A(4), mint: MINT, amount: 1n, blockhash: A(9) }));
});
