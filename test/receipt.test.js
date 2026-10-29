import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt } from '../src/receipt.js';

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const tx = (over = {}) => ({
  slot: 123,
  blockTime: 1_760_000_000,
  meta: { err: null, fee: 5000, innerInstructions: [] },
  transaction: {
    signatures: ['SIG'],
    message: {
      accountKeys: [{ pubkey: 'FACILITATOR' }, { pubkey: 'BUYER' }],
      instructions: [
        { program: 'spl-token', parsed: { type: 'transferChecked', info: { source: 'SRC', destination: 'MERCHANT_ATA', mint: MINT, authority: 'BUYER', tokenAmount: { uiAmount: 0.005 } } } },
        { program: 'spl-memo', parsed: 'abc123' },
      ],
    },
  },
  ...over,
});

test('a valid x402 payment passes every check', () => {
  const r = parseReceipt(tx(), { destAta: 'MERCHANT_ATA', payTo: 'MERCHANT', usdcMint: MINT });
  assert.equal(r.found, true);
  assert.deepEqual(r.checks, { confirmedOnChain: true, isUsdcTransfer: true, paidToJoyhavnMerchant: true, feeSponsoredByFacilitator: true });
  assert.equal(r.amountUsdc, 0.005);
  assert.equal(r.payer, 'BUYER');
  assert.equal(r.feePayer, 'FACILITATOR');
});

test('a payment to someone else is not marked as paid to the merchant', () => {
  const r = parseReceipt(tx(), { destAta: 'OTHER_ATA', payTo: 'MERCHANT', usdcMint: MINT });
  assert.equal(r.checks.paidToJoyhavnMerchant, false);
});

test('failed and unknown transactions are reported honestly', () => {
  const failed = parseReceipt(tx({ meta: { err: { InstructionError: [0, 'x'] }, fee: 5000 } }), { destAta: 'MERCHANT_ATA', payTo: 'M', usdcMint: MINT });
  assert.equal(failed.checks.confirmedOnChain, false);
  assert.equal(parseReceipt(null, {}).found, false);
});
