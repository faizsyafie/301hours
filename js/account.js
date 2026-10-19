// Accounts in the browser: Google's sign-in button, the sign-in screen, the
// header account chip, signing out and deleting your cloud data.
import { store, switchUser, readLocal, removeLocal, guestKey, userKey, request, sync, subscribe } from './store.js';
import { resetTimer } from './timer.js';
import { confirmBox, ask, notice } from './dialog.js';
import { esc } from './util.js';

const GUEST_OK_KEY = '301hours:guestOk';
let clientId = '';

// Asks the server which mode is on and who is signed in. Never throws.
export async function initAuth() {
  try {
    const res = await fetch('/api/auth/config', { cache: 'no-store' });
    if (res.ok) {
      const c = await res.json();
      store.authMode = c.mode;
      store.user = c.user;
      clientId = c.googleClientId;
    }
  } catch { /* offline or static hosting: keep defaults */ }
}

let gis = null;
function loadGoogle() {
  gis ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => { gis = null; reject(new Error('Couldn\'t load Google sign-in. Check your connection.')); };
    document.head.append(s);
  });
  return gis;
}

const hasProgress = (doc) => Boolean(doc && ((doc.sessions || []).some((s) => !s.deleted && s.sec > 0) || (doc.topics || []).some((t) => t.items?.some((i) => i.done)) || (doc.scores || []).some((r) => !r.deleted)));

const guestHours = (doc) => ((doc?.sessions || []).filter((s) => !s.deleted).reduce((a, s) => a + s.sec, 0) / 3600).toFixed(1);

async function signedIn(user) {
  // First sign-in on this device with progress saved here before accounts?
  const guest = readLocal(guestKey);
  let importDoc = null;
  if (!readLocal(userKey(user)) && hasProgress(guest)) {
    const yes = await confirmBox('IMPORT THIS DEVICE\'S PROGRESS?', `This browser has ${guestHours(guest)} h of study saved from before you signed in. Add it to ${user.email}? Choose CANCEL to start the account fresh; the device copy stays here either way until you import it.`, { okLabel: 'IMPORT INTO MY ACCOUNT' });
    if (yes) importDoc = guest;
  }
  resetTimer();
  await switchUser(user, importDoc);
  if (importDoc && store.status === 'synced') removeLocal(guestKey);
}

// The sign-in screen. Resolves when it closes.
export function showSignIn() {
  if (document.querySelector('dialog.signin[open]')) return Promise.resolve();
  const dlg = document.createElement('dialog');
  dlg.className = 'tdialog signin';
  dlg.innerHTML = `
    <form method="dialog">
      <div class="phead"><span>SIGN IN</span><span class="muted">ESC TO CLOSE</span></div>
      <div class="signin-hero"><span class="brand-box">301</span><div><div class="about-title">301 TERMINAL</div><div class="muted small">Sign in to save your progress to your account and pick it up on any device.</div></div></div>
      <div class="gbtn"><span class="muted small">Loading Google sign-in…</span></div>
      <p class="error small" hidden></p>
      <p class="muted small signin-privacy">Stores your Google name and email with your study data. Desk-cam video never leaves your device.</p>
      <div class="row end"><button value="guest" class="btn">USE THIS DEVICE ONLY</button></div>
    </form>`;
  document.body.append(dlg);
  dlg.showModal();
  const err = dlg.querySelector('.error');
  const fail = (m) => { err.textContent = m; err.hidden = false; };

  loadGoogle().then((google) => {
    google.accounts.id.initialize({
      client_id: clientId,
      ux_mode: 'popup',
      cancel_on_tap_outside: true,
      callback: async ({ credential }) => {
        try {
          const res = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return fail(data.error || `Sign-in failed (HTTP ${res.status}).`);
          dlg.close('signed-in');
          await signedIn(data.user);
        } catch (e) {
          fail(e.message);
        }
      },
    });
    const box = dlg.querySelector('.gbtn');
    box.innerHTML = '';
    google.accounts.id.renderButton(box, { theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'continue_with', width: 300 });
  }).catch((e) => fail(e.message));

  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue === 'guest') { try { localStorage.setItem(GUEST_OK_KEY, '1'); } catch { /* ignore */ } }
      dlg.remove();
      resolve();
    });
  });
}

export async function signOut() {
  const user = store.user;
  if (!user) return;
  if (store.dirty) await sync();
  if (store.dirty && !(await confirmBox('SIGN OUT?', 'Some changes haven\'t synced yet. Signing out now will lose them on this device.', { okLabel: 'SIGN OUT ANYWAY', danger: true }))) return;
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  try { window.google?.accounts.id.disableAutoSelect(); } catch { /* ignore */ }
  removeLocal(userKey(user)); // it's safe in the account; don't leave a copy on shared computers
  resetTimer();
  await switchUser(null);
}

export async function deleteCloudData() {
  const user = store.user;
  if (!user) return;
  const typed = await ask('DELETE MY CLOUD DATA', { hint: `Permanently deletes all study data stored for ${user.email} and signs you out. Type DELETE to confirm.`, placeholder: 'DELETE', okLabel: 'DELETE FOREVER' });
  if (typed === null) return;
  if (typed.trim().toUpperCase() !== 'DELETE') return notice('NOTHING DELETED', 'Type DELETE exactly to confirm.');
  const { status, data } = await request('DELETE');
  if (status !== 200) return notice('DELETE FAILED', data?.error || `HTTP ${status}`);
  store.dirty = false;
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  removeLocal(userKey(user));
  resetTimer();
  await switchUser(null);
  notice('DATA DELETED', `All cloud data for ${user.email} has been deleted.`);
}

function initials(user) {
  const src = user.name || user.email;
  return src.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

// Header chip: SIGN IN, or the signed-in user's initials with a small menu.
function renderChip() {
  const chip = document.querySelector('.account');
  if (!chip) return;
  chip.hidden = store.authMode !== 'google';
  if (chip.hidden) return;
  chip.innerHTML = store.user ? `<span class="avatar">${esc(initials(store.user))}</span>` : 'SIGN IN';
  chip.title = store.user ? `Signed in as ${store.user.email}` : 'Sign in to sync across devices';
  chip.classList.toggle('signed', Boolean(store.user));
}

async function accountMenu() {
  if (!store.user) return showSignIn();
  const dlg = document.createElement('dialog');
  dlg.className = 'tdialog';
  dlg.innerHTML = `
    <form method="dialog">
      <div class="phead"><span>ACCOUNT</span><span class="muted">ESC TO CLOSE</span></div>
      <div class="acct"><span class="avatar big">${esc(initials(store.user))}</span><div><div><b>${esc(store.user.name || store.user.email)}</b></div><div class="muted small">${esc(store.user.email)}</div><div class="muted small">Sync: ${esc(store.status.toUpperCase())}</div></div></div>
      <div class="row end">
        <button value="delete" class="btn danger small">DELETE MY CLOUD DATA</button>
        <button value="signout" class="btn">SIGN OUT</button>
        <button value="close" class="btn primary">CLOSE</button>
      </div>
    </form>`;
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => {
    const v = dlg.returnValue;
    dlg.remove();
    if (v === 'signout') signOut();
    else if (v === 'delete') deleteCloudData();
  });
}

export function setupAccountUI() {
  document.addEventListener('click', (e) => { if (e.target.closest('.account')) accountMenu(); });
  subscribe(renderChip);
  renderChip();
  // First visit in accounts mode: offer sign-in once (unless they chose this-device-only).
  let guestOk = false;
  try { guestOk = localStorage.getItem(GUEST_OK_KEY) === '1'; } catch { /* ignore */ }
  if (store.authMode === 'google' && !store.user && !guestOk) setTimeout(showSignIn, 300);
}
