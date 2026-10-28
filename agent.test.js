import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleBasedPlan, planTask, extractiveReport } from '../src/agent.js';
import { createServices } from '../src/services.js';

test('plans the right services for a mixed task', () => {
  const steps = ruleBasedPlan('Is https://phantom-airdrop-claim.secure-verify.xyz/connect-wallet safe, and what is SOL doing today?');
  assert.deepEqual(steps.map((s) => s.service), ['url-safety-scan', 'data-snapshot']);
  assert.equal(steps[0].input, 'https://phantom-airdrop-claim.secure-verify.xyz/connect-wallet');
});

test('detects JSON and plans nothing for unrelated chat', () => {
  assert.equal(ruleBasedPlan('check {"a": 1, "b": [1,2,],}')[0].service, 'json-validator');
  assert.equal(ruleBasedPlan('hello there').length, 0);
});

test('planTask validates inputs and falls back to rules without a key', async () => {
  const { steps, engine } = await planTask('price of bitcoin and ethereum', createServices({ env: {} }), {});
  assert.equal(engine, 'rules');
  assert.equal(steps.length, 2);
});

test('report is built from results', () => {
  const text = extractiveReport([{ service: 'data-snapshot', result: { asset: { name: 'Solana', symbol: 'SOL' }, priceUsd: 150, change24hPct: -2 } }]);
  assert.match(text, /Solana \(SOL\) is \$150, down 2%/);
});
