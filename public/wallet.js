// Browser wallet connection using the Wallet Standard (https://github.com/wallet-standard).
// Phantom, Solflare, Backpack and other Solana wallets announce themselves to the page, so no
// SDK is needed and users never paste an address or key: they approve in their own wallet.
import { base58Encode } from './solana.js';

const DEVNET = 'solana:devnet';
const LS_KEY = 'joyhavn.wallet.v1';
const wallets = new Map();
const listeners = new Set();
let current = null; // { wallet, account }

const emit = () => listeners.forEach((fn) => fn(snapshot()));
export const onWalletChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

function usable(w) {
  const f = w.features || {};
  return Boolean(f['standard:connect'] && f['solana:signTransaction']);
}

function register(...list) {
  for (const w of list) {
    if (!w || !usable(w)) continue;
    wallets.set(w.name, w);
  }
  emit();
  return () => list.forEach((w) => wallets.delete(w.name));
}

// Wallet Standard handshake: listen for wallets that load later, and announce ourselves to
// wallets that loaded earlier.
export function initWallets() {
  const api = Object.freeze({ register });
  try {
    window.addEventListener('wallet-standard:register-wallet', (e) => {
      try {
        e.detail(api);
      } catch {
        /* ignore a misbehaving wallet */
      }
    });
  } catch {
    /* no window */
  }
  try {
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  } catch {
    /* ignore */
  }
  // Wallets inject a moment after page load on some browsers: try again shortly, then auto-reconnect.
  setTimeout(() => window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api })), 600);
  setTimeout(() => autoConnect(), 700);
}

export const detectedWallets = () =>
  [...wallets.values()].map((w) => ({ name: w.name, icon: w.icon, version: w.version }));

export function snapshot() {
  return {
    connected: Boolean(current),
    name: current?.wallet.name || null,
    icon: current?.wallet.icon || null,
    address: current?.account.address || null,
    wallets: detectedWallets(),
  };
}

function pickAccount(accounts) {
  const a = accounts?.[0];
  if (!a) return null;
  return { ...a, address: a.address || base58Encode(a.publicKey) };
}

export async function connectWallet(name, { silent = false } = {}) {
  const wallet = wallets.get(name);
  if (!wallet) throw new Error('That wallet is not available in this browser.');
  const res = await wallet.features['standard:connect'].connect(silent ? { silent: true } : undefined);
  const account = pickAccount(res?.accounts?.length ? res.accounts : wallet.accounts);
  if (!account) throw new Error('The wallet did not share an account. Unlock it and try again.');
  current = { wallet, account };
  try {
    localStorage.setItem(LS_KEY, name);
  } catch {
    /* private mode */
  }
  const ev = wallet.features['standard:events'];
  if (ev) {
    current.off?.();
    current.off = ev.on('change', ({ accounts }) => {
      if (!current || current.wallet !== wallet) return;
      if (accounts) {
        const next = pickAccount(wallet.accounts);
        if (!next) return void disconnectWallet();
        current.account = next;
        emit();
      }
    });
  }
  emit();
  return snapshot();
}

export async function disconnectWallet() {
  const c = current;
  current = null;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  try {
    c?.off?.();
    await c?.wallet.features['standard:disconnect']?.disconnect();
  } catch {
    /* ignore */
  }
  emit();
}

async function autoConnect() {
  let saved = null;
  try {
    saved = localStorage.getItem(LS_KEY);
  } catch {
    /* ignore */
  }
  if (!saved || !wallets.has(saved) || current) return;
  try {
    await connectWallet(saved, { silent: true });
  } catch {
    /* user has to connect manually */
  }
}

// Ask the connected wallet to sign a transaction (bytes in, bytes out). Nothing is broadcast by
// the wallet: the facilitator co-signs as fee payer and submits it to Solana.
export async function signTransaction(txBytes) {
  if (!current) throw new Error('Connect a wallet first.');
  const { wallet, account } = current;
  const [out] = await wallet.features['solana:signTransaction'].signTransaction({
    account,
    transaction: txBytes,
    chain: DEVNET,
  });
  return out.signedTransaction;
}

export const isUserRejection = (err) => {
  const m = `${err?.message || ''} ${err?.code || ''}`.toLowerCase();
  return /reject|denied|declin|cancel|4001/.test(m);
};

export const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);
// Opens this exact page inside Phantom's in-app browser (where the wallet is injected).
export const phantomDeepLink = () =>
  `https://phantom.app/ul/browse/${encodeURIComponent(location.href.split('#')[0])}?ref=${encodeURIComponent(location.origin)}`;
export const solflareDeepLink = () =>
  `https://solflare.com/ul/v1/browse/${encodeURIComponent(location.href.split('#')[0])}?ref=${encodeURIComponent(location.origin)}`;
