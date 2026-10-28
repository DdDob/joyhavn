// Generates two disposable Solana keypairs for devnet: a merchant (receives payments) and a
// demo buyer (pays). Prints them; nothing is saved. Never reuse these on mainnet.
import { generateKeyPairSync } from 'node:crypto';
import { base58 } from '@scure/base';

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { address: base58.encode(pub), secret: base58.encode(Buffer.concat([seed, pub])) };
}

const merchant = keypair();
const buyer = keypair();

console.log(`
Environment variables:

SOLANA_PAY_TO=${merchant.address}
DEMO_BUYER_PRIVATE_KEY=${buyer.secret}

Fund BOTH wallets with devnet USDC at https://faucet.circle.com (Solana, Devnet, USDC):
  merchant (receives): ${merchant.address}
  demo buyer (pays):   ${buyer.address}

Funding the merchant once also creates its USDC token account, which settlement needs.
Devnet only. Never put a real wallet key in these variables.
`);
