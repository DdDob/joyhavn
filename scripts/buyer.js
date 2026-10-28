// CLI buyer: calls a Joyhavn service and pays automatically with x402.
//   npm run buyer -- url-safety-scan "https://example.com"
//   npm run buyer -- data-snapshot bitcoin
import 'dotenv/config';
import { createServices } from '../src/services.js';
import { createDemoBuyer } from '../src/demoBuyer.js';

const services = createServices();
const [id, ...rest] = process.argv.slice(2);
const svc = services.find((s) => s.id === id);
if (!svc) {
  console.error(`Usage: npm run buyer -- <${services.map((s) => s.id).join('|')}> "<input>"`);
  process.exit(1);
}
const input = rest.join(' ') || svc.example;
const base = process.env.JOYHAVN_URL || `http://localhost:${process.env.PORT || 4021}`;

const buyer = await createDemoBuyer(process.env.DEMO_BUYER_PRIVATE_KEY);
if (!buyer) {
  console.error('Set DEMO_BUYER_PRIVATE_KEY first (npm run keygen).');
  process.exit(1);
}

console.log(`Buyer ${buyer.address}\nCalling ${svc.name} (${svc.price}) on ${base} ...\n`);
const out = await buyer.pay(svc, input, base);
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
