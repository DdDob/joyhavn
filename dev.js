// Local development server: the same API app plus the static front end.
//   npm run dev
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4021);

const app = createApp();
app.use(express.static(path.join(here, 'public')));

app.listen(PORT, () => {
  console.log(`\nJoyhavn running on http://localhost:${PORT}`);
  if (!process.env.SOLANA_PAY_TO) console.log('  SOLANA_PAY_TO is not set. Run `npm run keygen` and fill in .env.');
  if (!process.env.DEMO_BUYER_PRIVATE_KEY) console.log('  DEMO_BUYER_PRIVATE_KEY is not set: the Pay & Run button will not work.');
});
