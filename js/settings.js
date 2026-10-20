import { store, save, sync, subscribe, setPasscode, getPasscode } from './store.js';
import { mergeDocs } from '../lib/merge.js';
import { $, esc, dayKey } from './util.js';
import { PATHWAYS } from './curriculum.js';
import { notice, ask } from './dialog.js';
import { resetProgress } from './reset.js';
import { showSignIn, signOut, deleteCloudData } from './account.js';
import { isInstalled, isIOS, canPrompt, promptInstall, onInstallChange } from './install.js';

const FIELDS = [
  ['goalHours', 'TARGET HOURS (PER LEVEL)', 'number', { min: 1, max: 2000 }],
  ['dailyGoalHours', 'DAILY TARGET (HOURS)', 'number', { min: 0, max: 16, step: 0.5 }],
  ['examDate', 'EXAM DATE', 'date', {}],
  ['studyMin', 'STUDY BLOCK (MIN)', 'number', { min: 1, max: 180 }],
  ['shortMin', 'SHORT BREAK (MIN)', 'number', { min: 1, max: 60 }],
  ['longMin', 'LONG BREAK (MIN)', 'number', { min: 1, max: 120 }],
  ['longEvery', 'LONG BREAK EVERY N BLOCKS', 'number', { min: 1, max: 12 }],
  ['graceSec', 'SECONDS AWAY BEFORE HALT', 'number', { min: 1, max: 120 }],
  ['scoreTarget', 'PRACTICE SCORE TARGET (%)', 'number', { min: 1, max: 100 }],
];

const TOGGLES = [
  ['presence', 'Only count study time while I\'m at the desk (camera)'],
  ['phoneCheck', 'Halt the clock while a phone is in frame (camera)'],
  ['autoStartBreak', 'Start breaks automatically'],
  ['autoStartStudy', 'Start study blocks automatically after breaks'],
  ['alerts', 'Show alerts when blocks and breaks start or end'],
  ['sound', 'Play a sound when a block or break ends'],
];

const SYNC_TEXT = {
  synced: 'Synced. Your data is saved to your Vercel database and shows up on every device.',
  syncing: 'Syncing…',
  offline: 'Can\'t reach the server right now. Changes are kept in this browser and will sync later.',
  locked: 'Locked. Enter your passcode to sync.',
  local: 'Not synced. Data is saved in this browser only.',
  signedout: 'Not signed in. Progress is saved on this device only.',
};

export function renderSettings(root) {
  const s = store.doc.settings;
  root.innerHTML = `
    <div class="page-head"><h1>SETUP</h1></div>
    <div class="grid-2">
      <section class="panel">
        <div class="phead"><span>TARGETS &amp; TIMER</span></div>
        <form class="settings-form">
          <div class="fields">
            <label>LEVEL<select name="level">${[1, 2, 3].map((l) => `<option value="${l}" ${l === (s.level || 1) ? 'selected' : ''}>CFA LEVEL ${'I'.repeat(l)}</option>`).join('')}</select></label>
            <label>L3 PATHWAY<select name="pathway">${Object.entries(PATHWAYS).map(([k, v]) => `<option value="${k}" ${k === s.pathway ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            ${FIELDS.map(([k, label, type, attrs]) => `<label>${label}<input name="${k}" type="${type}" value="${esc(s[k])}" ${Object.entries(attrs).map(([a, v]) => `${a}="${v}"`).join(' ')}></label>`).join('')}
          </div>
          ${TOGGLES.map(([k, label]) => `<label class="check"><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}> ${label}</label>`).join('')}
          <div class="row"><button class="btn primary" type="submit">SAVE</button><span class="note saved" hidden>Saved.</span></div>
        </form>
      </section>

      <div>
        <section class="panel">
          <div class="phead"><span>SYNC</span></div>
          <p class="sync-text"></p>
          <p class="note sync-msg"></p>
          <div class="acct-row row"></div>
          <form class="pass-form row">
            <input name="code" type="password" placeholder="PASSCODE" value="${esc(getPasscode())}" autocomplete="current-password">
            <button class="btn" type="submit">SAVE &amp; SYNC</button>
          </form>
          <div class="row" style="margin-top:10px"><button type="button" class="btn" data-act="diagnose">RUN DIAGNOSTICS</button></div>
          <ul class="diag" hidden></ul>
        </section>
        <section class="panel">
          <div class="phead"><span>APP</span></div>
          <p class="note install-text"></p>
          <div class="row"><button type="button" class="btn" data-act="install" hidden>INSTALL APP</button></div>
        </section>
        <section class="panel">
          <div class="phead"><span>BACKUP</span></div>
          <p class="note">Download all your data as a file, or load a backup. Loading merges it with what's already here, so nothing is overwritten.</p>
          <div class="row">
            <button type="button" class="btn" data-act="export">DOWNLOAD</button>
            <label class="btn">LOAD FILE<input type="file" accept="application/json,.json" name="import" hidden></label>
          </div>
        </section>
        <section class="panel danger-zone">
          <div class="phead"><span>RESET PROGRESS</span><span class="muted">CAN'T BE UNDONE · DOWNLOAD A BACKUP FIRST</span></div>
          <p class="note">Clears logged hours, module ticks and reviews, practice scores, milestones and ratings. Keeps your topic and module names, settings and passcode. Syncs to your other devices.</p>
          <div class="row">
            <select name="resetScope">
              <option value="level">This level only (Level ${['I', 'II', 'III'][(s.level || 1) - 1]})</option>
              <option value="all">All levels (I, II and III)</option>
            </select>
            <button type="button" class="btn danger" data-act="reset">RESET PROGRESS…</button>
          </div>
        </section>
      </div>
    </div>`;

  const showSync = () => {
    $('.sync-text', root).textContent = SYNC_TEXT[store.status] || '';
    $('.sync-msg', root).textContent = store.status === 'signedout' ? '' : store.message;
    const google = store.authMode === 'google';
    $('.pass-form', root).hidden = google;
    const acct = $('.acct-row', root);
    acct.hidden = !google;
    acct.innerHTML = !google ? '' : store.user
      ? `<span class="note" style="margin:0">Signed in as <b>${esc(store.user.email)}</b></span><button type="button" class="btn small" data-act="signout">SIGN OUT</button><button type="button" class="btn small danger" data-act="delete-cloud">DELETE MY CLOUD DATA</button>`
      : '<button type="button" class="btn primary" data-act="signin">SIGN IN WITH GOOGLE</button>';
  };
  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'signin') showSignIn();
    else if (act === 'signout') signOut();
    else if (act === 'delete-cloud') deleteCloudData();
  });
  showSync();

  $('.settings-form', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const s = store.doc.settings; // re-read: a sync may have replaced it since render
    for (const [k, , type] of FIELDS) {
      const v = f[k].value;
      if (type === 'number') {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) s[k] = n;
      } else {
        s[k] = v;
      }
    }
    for (const [k] of TOGGLES) s[k] = f[k].checked;
    s.level = Number(f.level.value) || 1;
    s.pathway = f.pathway.value;
    s.u = Date.now();
    save({ immediate: true });
    $('.saved', f).hidden = false;
    setTimeout(() => { $('.saved', f).hidden = true; }, 2500);
  });

  $('.pass-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    setPasscode(e.target.code.value);
    await sync();
  });

  $('[data-act="diagnose"]', root).addEventListener('click', async () => {
    const list = $('.diag', root);
    list.hidden = false;
    list.innerHTML = '<li class="muted">Checking…</li>';
    const rows = await diagnose();
    list.innerHTML = rows.map(([ok, label, fix]) => `<li class="${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}"><b>${ok === true ? '✓' : ok === false ? '✗' : '!'}</b> ${esc(label)}${fix ? `<div class="fix">${esc(fix)}</div>` : ''}</li>`).join('');
  });

  $('[data-act="reset"]', root).addEventListener('click', async () => {
    const all = $('[name="resetScope"]', root).value === 'all';
    const level = store.doc.settings.level || 1;
    const what = all ? 'ALL LEVELS' : `LEVEL ${['I', 'II', 'III'][level - 1]}`;
    const typed = await ask(`RESET ${what}`, {
      hint: `This deletes hours, module ticks, reviews, scores, milestones and ratings for ${all ? 'every level' : `Level ${['I', 'II', 'III'][level - 1]}`}. Type RESET to confirm.`,
      placeholder: 'RESET',
      okLabel: 'RESET PROGRESS',
    });
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== 'RESET') {
      await notice('RESET CANCELLED', 'Nothing was changed. Type RESET exactly to confirm.');
      return;
    }
    const n = resetProgress(all ? [1, 2, 3] : [level]);
    await notice('PROGRESS RESET', `${what}: ${n.sessions} sessions, ${n.modules} module ticks and ${n.scores} score reports cleared. Fresh start.`);
  });

  $('[data-act="export"]', root).addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.doc, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `301hours-backup-${dayKey(Date.now())}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('[name="import"]', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const doc = JSON.parse(await file.text());
      if (!Array.isArray(doc.topics) || !Array.isArray(doc.sessions)) throw new Error('Not a 301hours backup');
      store.doc = mergeDocs(store.doc, doc);
      save({ immediate: true });
      await notice('BACKUP LOADED', 'Your backup was merged with the data already here.');
    } catch (err) {
      await notice('LOAD FAILED', `Couldn't load that file: ${err.message}`);
    }
  });

  const showInstall = () => {
    const btn = $('[data-act="install"]', root);
    btn.hidden = !canPrompt() || isInstalled();
    $('.install-text', root).textContent = isInstalled()
      ? 'Installed. You\'re running 301 TERMINAL as an app.'
      : canPrompt()
        ? 'Install 301 TERMINAL as an app: its own icon and window, no browser bar, and it opens even offline.'
        : isIOS()
          ? 'To install: tap Share in Safari, then "Add to Home Screen".'
          : 'To install, use your browser\'s menu: "Install 301 TERMINAL" or "Add to Home screen". (Chrome and Edge show it in the address bar.)';
  };
  showInstall();
  $('[data-act="install"]', root).addEventListener('click', promptInstall);
  const offInstall = onInstallChange(showInstall);
  const offSync = subscribe(showSync);
  return () => { offInstall(); offSync(); };
}

// Checks each link in the sync chain and says how to fix the first broken one.
// Returns [ok (true/false/null), label, fix] rows.
async function diagnose() {
  const rows = [];
  let health;
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const type = res.headers.get('content-type') || '';
    if ((res.status === 401 || res.status === 403) && !type.includes('json')) {
      return [[false, 'Vercel Deployment Protection is blocking the API on this URL.', 'Open your main .vercel.app domain, or turn off Vercel Authentication in Settings → Deployment Protection.']];
    }
    if (res.status === 404) {
      return [[false, 'No API on this site (/api/health not found).', 'This copy is running without its server part, e.g. from a plain file server. Use the Vercel deployment.']];
    }
    health = await res.json();
  } catch (err) {
    return [[false, `Can't reach the server: ${err.message}`, 'Check your internet connection.']];
  }

  const env = health.vercelEnv;
  rows.push([null, `Deployment: ${env}`, env === 'preview' ? 'Preview deployments only get environment variables that are enabled for "Preview" in Vercel.' : '']);

  if (!health.database) {
    rows.push([false, 'No database connected.', 'Vercel → your project → Storage → create/connect Upstash Redis (or any Redis), tick this environment, then redeploy.']);
  } else {
    rows.push([true, `Database configured (${health.database}; found ${health.envFound.join(', ')}).`, '']);
    rows.push(health.databaseReachable
      ? [true, 'Database answers.', '']
      : [false, `Database not reachable: ${health.error}`, 'Reconnect the database in Vercel → Storage, then redeploy.']);
  }

  if (health.authMode === 'google' || health.googleClientIdSet || health.sessionSecretSet) {
    rows.push(health.googleClientIdSet ? [true, 'GOOGLE_CLIENT_ID is set.', ''] : [false, 'GOOGLE_CLIENT_ID is not set.', 'Create an OAuth client ID in Google Cloud (see README → Accounts) and add it in Vercel, then redeploy.']);
    rows.push(health.sessionSecretSet ? [true, 'SESSION_SECRET is set.', ''] : [false, 'SESSION_SECRET is not set.', 'Add a long random value as SESSION_SECRET in Vercel, then redeploy.']);
    if (health.authMode === 'google') {
      rows.push(health.signedIn ? [true, `Signed in${store.user ? ` as ${store.user.email}` : ''}.`, ''] : [false, 'Not signed in on this device.', 'Press SIGN IN. If Google shows "origin not allowed", add this site\'s address under Authorized JavaScript origins in your Google OAuth client.']);
      if (health.allowList) rows.push([null, 'Sign-in is limited to ALLOWED_EMAILS.', '']);
    }
    return rows;
  }

  rows.push(health.passcodeSet
    ? [true, 'APP_PASSCODE is set on the server.', '']
    : [false, 'APP_PASSCODE is not set for this deployment.', 'Vercel → Settings → Environment Variables → add APP_PASSCODE (tick Production), then Deployments → ⋯ → Redeploy.']);

  const code = getPasscode().trim();
  if (!code) {
    rows.push([false, 'No passcode saved on this device.', 'Type it in the box above and press SAVE & SYNC.']);
  } else if (health.passcodeSet && health.database) {
    try {
      const res = await fetch('/api/data', { headers: { 'x-passcode': encodeURIComponent(code) }, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) rows.push([true, 'This device\'s passcode is accepted.', '']);
      else if (res.status === 401) rows.push([false, 'This device\'s passcode is rejected.', 'It must match APP_PASSCODE exactly (case-sensitive). If you changed APP_PASSCODE, redeploy so the change takes effect.']);
      else rows.push([false, `Data request failed: ${body.error || `HTTP ${res.status}`}`, '']);
    } catch (err) {
      rows.push([false, `Data request failed: ${err.message}`, '']);
    }
  }
  return rows;
}
