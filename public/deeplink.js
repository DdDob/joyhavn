// Wallet "universal link" connection for phones: Safari -> wallet app -> approve -> back to Safari.
// Implements the Phantom / Solflare deep-link protocol: requests and replies are end-to-end
// encrypted with a one-off X25519 key pair (NaCl box), so nothing sensitive travels in the URL.
import nacl from './vendor/nacl.js';
import { base58Decode, base58Encode, utf8 } from './solana.js';

const LS_SESSION = 'joyhavn.dl.session.v1'; // established connection
const LS_KEYS = 'joyhavn.dl.keys.v1'; // our encryption key pair (not a wallet key)
const LS_RETURN = 'joyhavn.dl.return.v1';
const LS_PENDING = 'joyhavn.dl.pending.v1'; // payment waiting for the wallet to come back
const MAX_AGE_MS = 10 * 60_000;

export const PROVIDERS = {
  Phantom: { base: 'https://phantom.app/ul/v1', pub: 'phantom_encryption_public_key' },
  Solflare: { base: 'https://solflare.com/ul/v1', pub: 'solflare_encryption_public_key' },
};

const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null');
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: the flow cannot survive leaving the page */
  }
};
const drop = (k) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
};

export const getDeepLinkSession = () => read(LS_SESSION);
export const clearDeepLinkSession = () => [LS_SESSION, LS_KEYS, LS_PENDING, LS_RETURN].forEach(drop);

const ourKeys = () => {
  let k = read(LS_KEYS);
  if (!k) {
    const pair = nacl.box.keyPair();
    k = { pub: base58Encode(pair.publicKey), secret: base58Encode(pair.secretKey) };
    write(LS_KEYS, k);
  }
  return k;
};

const redirectTo = (type) => `${location.origin}/?wcb=${type}`;

// Leaves the page for the wallet app. The wallet sends the user back to redirect_link.
function go(url) {
  location.href = url;
}

export function connectViaDeepLink(name) {
  const p = PROVIDERS[name];
  if (!p) throw new Error('This wallet does not support app-to-app connection.');
  const keys = ourKeys();
  write(LS_RETURN, { hash: location.hash || '#/home', wallet: name, at: Date.now() });
  const q = new URLSearchParams({
    app_url: location.origin,
    dapp_encryption_public_key: keys.pub,
    redirect_link: redirectTo('connect'),
    cluster: 'devnet',
  });
  go(`${p.base}/connect?${q}`);
}

export function requestSignature(txBytes, pending) {
  const session = getDeepLinkSession();
  if (!session) throw new Error('Connect a wallet first.');
  const p = PROVIDERS[session.wallet];
  const keys = ourKeys();
  const shared = nacl.box.before(base58Decode(session.theirPub), base58Decode(keys.secret));
  const nonce = nacl.randomBytes(24);
  const payload = nacl.box.after(utf8(JSON.stringify({ transaction: base58Encode(txBytes), session: session.token })), nonce, shared);
  write(LS_PENDING, { ...pending, at: Date.now(), hash: location.hash || '#/home' });
  const q = new URLSearchParams({
    dapp_encryption_public_key: keys.pub,
    nonce: base58Encode(nonce),
    redirect_link: redirectTo('sign'),
    payload: base58Encode(payload),
  });
  go(`${p.base}/signTransaction?${q}`);
}

export const getPending = () => {
  const p = read(LS_PENDING);
  return p && Date.now() - p.at < MAX_AGE_MS ? p : null;
};
export const clearPending = () => drop(LS_PENDING);

function decrypt(theirPubB58, nonceB58, dataB58) {
  const keys = read(LS_KEYS);
  if (!keys) throw new Error('This browser lost its session. Please connect again.');
  const shared = nacl.box.before(base58Decode(theirPubB58), base58Decode(keys.secret));
  const plain = nacl.box.open.after(base58Decode(dataB58), base58Decode(nonceB58), shared);
  if (!plain) throw new Error('Could not verify the wallet reply. Please try again.');
  return JSON.parse(new TextDecoder().decode(plain));
}

// Call once at page load. If the URL is a wallet reply, process it, clean the URL and describe it.
export function handleDeepLinkReturn() {
  const q = new URLSearchParams(location.search);
  const type = q.get('wcb');
  if (!type) return null;
  const clean = () => history.replaceState(null, '', location.pathname);
  try {
    if (q.get('errorCode') || q.get('errorMessage')) {
      const msg = q.get('errorMessage') || 'The wallet declined the request.';
      const rejected = /reject|declin|cancel|denied|4001/i.test(`${msg} ${q.get('errorCode')}`);
      return { type, error: rejected ? 'You cancelled in your wallet. Nothing was charged.' : msg, rejected };
    }
    if (type === 'connect') {
      const ret = read(LS_RETURN);
      const wallet = ret?.wallet || 'Phantom';
      const theirPub = q.get(PROVIDERS[wallet].pub) || q.get('phantom_encryption_public_key') || q.get('solflare_encryption_public_key');
      const data = decrypt(theirPub, q.get('nonce'), q.get('data'));
      write(LS_SESSION, { wallet, address: data.public_key, token: data.session, theirPub });
      drop(LS_RETURN);
      return { type, wallet, address: data.public_key, hash: ret?.hash || '#/home' };
    }
    if (type === 'sign') {
      const session = getDeepLinkSession();
      if (!session) throw new Error('Connection expired. Please connect again.');
      const data = decrypt(session.theirPub, q.get('nonce'), q.get('data'));
      return { type, signed: base58Decode(data.transaction), pending: getPending() };
    }
    return null;
  } catch (err) {
    return { type, error: err.message || 'Could not read the wallet reply.' };
  } finally {
    clean();
  }
}
