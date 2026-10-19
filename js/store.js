// Holds the study data. Always saved to this browser first, then synced to
// /api/data (Vercel + Upstash) when available.
//
// store.status: 'local'   - no sync backend (e.g. running from a plain static server)
//               'synced'  - last sync succeeded
//               'syncing' - a sync is in flight
//               'offline' - backend unreachable; changes are kept and retried
//               'locked'  - backend needs a passcode (single-user mode)
//               'signedout' - accounts mode, not signed in: this device only
//
// In accounts mode each Google account's data is kept under its own key in
// this browser too, so two people sharing a computer never see each other's.
import { defaultDoc } from './curriculum.js';
import { mergeDocs } from '../lib/merge.js';

const GUEST_KEY = '301hours:data';
const PASS_KEY = '301hours:passcode';

const listeners = new Set();

export const store = {
  doc: null,
  status: 'local',
  message: '',
  dirty: false,
  authMode: 'none', // 'google' | 'passcode' | 'none', from /api/auth/config
  user: null,       // { sub, email, name } when signed in
};

const dataKey = (user = store.user) => (user ? `${GUEST_KEY}:${user.sub}` : GUEST_KEY);

export function readLocal(key = dataKey()) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeLocal() {
  try {
    localStorage.setItem(dataKey(), JSON.stringify(store.doc));
  } catch {
    /* storage full or blocked - sync still has a copy */
  }
}

export function removeLocal(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export const guestKey = GUEST_KEY;
export const userKey = (user) => dataKey(user);

// Switch whose data is loaded (sign in / sign out). `importDoc` is merged in,
// e.g. progress made on this device before signing in.
export function switchUser(user, importDoc = null) {
  store.user = user;
  store.doc = mergeDocs(mergeDocs(defaultDoc(), readLocal()), importDoc);
  store.dirty = Boolean(importDoc);
  writeLocal();
  emit();
  return sync();
}

export function getPasscode() {
  try { return localStorage.getItem(PASS_KEY) || ''; } catch { return ''; }
}

export function setPasscode(code) {
  try { localStorage.setItem(PASS_KEY, code); } catch { /* ignore */ }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(store);
}

function setStatus(status, message = '') {
  store.status = status;
  store.message = message;
  emit();
}

export async function request(method, body) {
  const headers = { 'Content-Type': 'application/json' };
  // Encoded so passcodes with non-ASCII characters can travel in a header.
  if (store.authMode !== 'google') headers['x-passcode'] = encodeURIComponent(getPasscode().trim());
  const res = await fetch('/api/data', {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// Applies a server response. Returns true if the doc is now in sync.
function handleResponse({ status, data }) {
  if (status === 200 && data) {
    if (data.doc) {
      store.doc = mergeDocs(store.doc, data.doc);
      writeLocal();
    }
    return true;
  }
  if (status === 401 && data?.code === 'signed_out') {
    store.user = null;
    setStatus('signedout', 'Your session ended. Sign in again to sync.');
  } else if (status === 403 && data?.error) {
    setStatus('offline', data.error);
  } else if (status === 413) {
    setStatus('offline', data?.error || 'Your data is too large to sync.');
  } else if (status === 401 && data?.code === 'bad_passcode') {
    setStatus('locked', 'Wrong passcode. It must match APP_PASSCODE in Vercel exactly (case-sensitive).');
  } else if (status === 401 || status === 403) {
    // Not our API answering: Vercel's Deployment Protection is in front of it.
    setStatus('offline', 'Vercel Deployment Protection is blocking sync on this URL. Open your main .vercel.app domain, or turn off Vercel Authentication under Settings → Deployment Protection.');
  } else if (status === 404) {
    setStatus('local', 'Sync is not set up - data is saved in this browser only.');
  } else if (status === 501) {
    setStatus('local', data?.error || 'Sync is not configured.');
  } else {
    setStatus('offline', data?.error || `Sync failed (HTTP ${status}).`);
  }
  return false;
}

export async function load() {
  store.doc = mergeDocs(defaultDoc(), readLocal());
  emit();
  await sync();
}

let syncing = null;
let again = false;

async function syncOnce() {
  if (store.authMode === 'google' && !store.user) {
    setStatus('signedout', 'Not signed in: progress is saved on this device only.');
    return;
  }
  setStatus('syncing', '');
  try {
    const sentAt = store.doc.updatedAt;
    if (handleResponse(await request('PUT', store.doc))) {
      if (store.doc.updatedAt === sentAt) store.dirty = false;
      setStatus('synced', '');
    }
  } catch {
    setStatus('offline', 'Offline - changes are saved here and will sync later.');
  }
}

// Resolves only after a sync that started after this call has finished, so a
// caller (e.g. after entering the passcode) never sees a stale in-flight result.
export function sync() {
  again = true;
  if (!syncing) {
    syncing = (async () => {
      while (again) {
        again = false;
        await syncOnce();
      }
      syncing = null;
    })();
  }
  return syncing;
}

let timer = null;

// Call after mutating store.doc.
export function save({ immediate = false } = {}) {
  store.doc.updatedAt = Date.now();
  store.dirty = true;
  writeLocal();
  emit();
  if (store.status === 'local' || store.status === 'locked' || store.status === 'signedout') return;
  clearTimeout(timer);
  timer = setTimeout(sync, immediate ? 0 : 2000);
}

export function replaceDoc(doc) {
  store.doc = doc;
  save({ immediate: true });
}

// Retry periodically and when the connection comes back.
setInterval(() => { if (store.dirty && store.status === 'offline') sync(); }, 30000);
window.addEventListener('online', () => { if (store.status === 'offline') sync(); });
// Pick up changes from other devices when returning to the tab.
document.addEventListener('visibilitychange', () => {
  const syncable = store.status === 'synced' || store.status === 'offline' || store.status === 'syncing';
  if (!syncable) return;
  // Back to the tab: fetch other devices' changes. Leaving it: push ours now
  // instead of waiting for the debounce (the tab may be about to close).
  if (document.visibilityState === 'visible' || store.dirty) {
    clearTimeout(timer);
    sync();
  }
});
