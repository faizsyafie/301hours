// Holds the study data. Always saved to this browser first, then synced to
// /api/data (Vercel + Upstash) when available.
//
// store.status: 'local'   - no sync backend (e.g. running from a plain static server)
//               'synced'  - last sync succeeded
//               'syncing' - a sync is in flight
//               'offline' - backend unreachable; changes are kept and retried
//               'locked'  - backend needs a passcode
import { defaultDoc } from './curriculum.js';
import { mergeDocs } from '../lib/merge.js';

const DATA_KEY = '301hours:data';
const PASS_KEY = '301hours:passcode';

const listeners = new Set();

export const store = {
  doc: null,
  status: 'local',
  message: '',
  dirty: false,
};

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(DATA_KEY));
  } catch {
    return null;
  }
}

function writeLocal() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(store.doc));
  } catch {
    /* storage full or blocked - sync still has a copy */
  }
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

async function request(method, body) {
  const res = await fetch('/api/data', {
    method,
    headers: { 'Content-Type': 'application/json', 'x-passcode': getPasscode() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Applies a server response. Returns true if the doc is now in sync.
function handleResponse({ status, data }) {
  if (status === 200) {
    if (data.doc) {
      store.doc = mergeDocs(store.doc, data.doc);
      writeLocal();
    }
    return true;
  }
  if (status === 401) setStatus('locked', 'Enter your passcode to sync.');
  else if (status === 404) setStatus('local', 'Sync is not set up - data is saved in this browser only.');
  else if (status === 501) setStatus('local', data.error || 'Sync is not configured.');
  else setStatus('offline', data.error || `Sync failed (HTTP ${status}).`);
  return false;
}

export async function load() {
  store.doc = mergeDocs(defaultDoc(), readLocal());
  emit();
  await sync();
}

let syncing = null;
let again = false;

export async function sync() {
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
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
  })();
  await syncing;
  syncing = null;
  if (again) { again = false; return sync(); }
}

let timer = null;

// Call after mutating store.doc.
export function save({ immediate = false } = {}) {
  store.doc.updatedAt = Date.now();
  store.dirty = true;
  writeLocal();
  emit();
  if (store.status === 'local' || store.status === 'locked') return;
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
  if (document.visibilityState === 'visible' && (store.status === 'synced' || store.status === 'offline')) sync();
});
