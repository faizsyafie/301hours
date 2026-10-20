// Accounts: "Sign in with Google" plus our own signed session cookie.
//
// The browser gets a Google ID token (a JWT signed by Google). We verify its
// signature against Google's public keys, check it was issued for our client
// ID, then set an HttpOnly cookie holding { sub, email, name, exp } signed with
// SESSION_SECRET (HMAC-SHA256). No third-party auth service, no passwords.
//
// Modes:
//   'google'   GOOGLE_CLIENT_ID and SESSION_SECRET are set: one data slot per account
//   'passcode' only APP_PASSCODE is set: the original single-user mode
//   'none'     nothing configured
import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

const env = process.env;
const clean = (v) => String(v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();

export const GOOGLE_CLIENT_ID = clean(env.GOOGLE_CLIENT_ID);
const SESSION_SECRET = clean(env.SESSION_SECRET);
const PASSCODE = clean(env.APP_PASSCODE).normalize('NFC');
const JWKS_URL = env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const COOKIE = '301s';
const SESSION_DAYS = 30;

// Optional allow-list: "alex@gmail.com, sam@uni.edu" and/or "@uni.edu" for a whole domain.
const ALLOWED = clean(env.ALLOWED_EMAILS).toLowerCase().split(/[\s,]+/).filter(Boolean);

export const authMode = GOOGLE_CLIENT_ID && SESSION_SECRET ? 'google' : PASSCODE ? 'passcode' : 'none';
export const config = { googleClientIdSet: Boolean(GOOGLE_CLIENT_ID), sessionSecretSet: Boolean(SESSION_SECRET), passcodeSet: Boolean(PASSCODE), allowList: ALLOWED.length > 0 };

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

// ---------- Google ID token ----------
let jwksCache = { keys: null, until: 0 };

async function googleKeys(force = false) {
  if (!force && jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Could not fetch Google keys (HTTP ${res.status})`);
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  jwksCache = { keys: (await res.json()).keys, until: Date.now() + maxAge * 1000 };
  return jwksCache.keys;
}

export function emailAllowed(email) {
  if (!ALLOWED.length) return true;
  const e = email.toLowerCase();
  return ALLOWED.some((rule) => (rule.startsWith('@') ? e.endsWith(rule) : e === rule));
}

// Returns the verified token payload or throws with a user-facing message.
export async function verifyGoogleToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed sign-in token');
  const [h, p, s] = parts;
  const header = JSON.parse(unb64u(h));
  const payload = JSON.parse(unb64u(p));
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid); // keys rotate
  if (!jwk) throw new Error('Unknown signing key');
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), unb64u(s));
  if (!ok) throw new Error('Invalid token signature');
  const now = Math.floor(Date.now() / 1000);
  if (!ISSUERS.includes(payload.iss)) throw new Error('Token not issued by Google');
  if (payload.aud !== GOOGLE_CLIENT_ID) throw new Error('Token was issued for a different app (check GOOGLE_CLIENT_ID)');
  if (!(payload.exp > now - 30)) throw new Error('Sign-in token expired, please try again');
  if (!payload.email || payload.email_verified === false) throw new Error('Google account email is not verified');
  return payload;
}

// ---------- Session cookie ----------
function sign(data) {
  return b64u(createHmac('sha256', SESSION_SECRET).update(data).digest());
}

export function sessionCookie(user, req) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const body = b64u(JSON.stringify({ sub: user.sub, email: user.email, name: user.name || '', exp }));
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.VERCEL ? '; Secure' : '';
  return `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// The signed-in user from the request's cookie, or null.
export function currentUser(req) {
  if (authMode !== 'google') return null;
  const raw = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [body, mac] = raw.slice(COOKIE.length + 1).split('.');
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const user = JSON.parse(unb64u(body));
    return user.exp > Date.now() / 1000 ? user : null;
  } catch {
    return null;
  }
}

// ---------- Passcode (single-user mode) ----------
function normalize(code) {
  let s = String(code ?? '').normalize('NFC').trim();
  if (s.length > 1 && /^(['"]).*\1$/.test(s)) s = s.slice(1, -1).trim();
  return s;
}

export function passcodeMatches(given) {
  let decoded = given;
  try { decoded = decodeURIComponent(given); } catch { /* sent unencoded */ }
  const hash = (x) => createHash('sha256').update(normalize(x)).digest();
  return timingSafeEqual(hash(decoded), hash(PASSCODE));
}

// Where a request's data lives, or { error, status } if it isn't allowed.
export function dataSlot(req) {
  if (authMode === 'google') {
    const user = currentUser(req);
    if (!user) return { status: 401, error: 'Sign in to sync', code: 'signed_out' };
    return { key: `301hours:user:${user.sub}`, user };
  }
  if (authMode === 'passcode') {
    if (!passcodeMatches(req.headers['x-passcode'] || '')) return { status: 401, error: 'Wrong passcode', code: 'bad_passcode' };
    return { key: '301hours:data' };
  }
  return { status: 501, error: 'Sync is not set up: add GOOGLE_CLIENT_ID + SESSION_SECRET (accounts) or APP_PASSCODE (single user).' };
}
