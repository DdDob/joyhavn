// Verifies our encrypt/decrypt matches how a wallet (NaCl box) would reply, using Node + the bundled tweetnacl.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.self ??= globalThis; // browsers have `self`; Node does not
const { default: nacl } = await import('../public/vendor/nacl.js');
import { base58Decode, base58Encode } from '../public/solana.js';

test('box round trip between dapp and wallet key pairs', () => {
  const dapp = nacl.box.keyPair();
  const wallet = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const msg = JSON.stringify({ public_key: 'So11111111111111111111111111111111111111112', session: 'abc' });
  // wallet encrypts for the dapp
  const sealed = nacl.box(new TextEncoder().encode(msg), nonce, dapp.publicKey, wallet.secretKey);
  // dapp decrypts with the shared secret computed the way deeplink.js does it
  const shared = nacl.box.before(base58Decode(base58Encode(wallet.publicKey)), dapp.secretKey);
  const plain = nacl.box.open.after(base58Decode(base58Encode(sealed)), base58Decode(base58Encode(nonce)), shared);
  assert.equal(new TextDecoder().decode(plain), msg);
  // tampering is rejected
  sealed[0] ^= 1;
  assert.ok(!nacl.box.open.after(sealed, nonce, shared), "tampered data is rejected");
});
