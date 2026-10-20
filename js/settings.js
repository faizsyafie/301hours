import { store, save, sync, subscribe, setPasscode, getPasscode } from './store.js';
import { mergeDocs } from '../lib/merge.js';
import { $, esc, dayKey } from './util.js';
import { PATHWAYS } from './curriculum.js';
import { notice, ask } from './dialog.js';
import { resetProgress } from './reset.js';
import { showSignIn, signOut, deleteCloudData } from './account.js';
import { isInstalled, isIOS, canPrompt, promptInstall, onInstallChange } from './install.js';

// Number/date fields: [key, label, type, attrs]
const FIELD = {
  goalHours: ['TARGET HOURS', 'number', { min: 1, max: 2000 }],
  dailyGoalHours: ['DAILY TARGET (H)', 'number', { min: 0, max: 16, step: 0.5 }],
  examDate: ['EXAM DATE', 'date', {}],
  scoreTarget: ['SCORE TARGET (%)', 'number', { min: 1, max: 100 }],
  studyMin: ['STUDY (MIN)', 'number', { min: 1, max: 180 }],
  shortMin: ['BREAK (MIN)', 'number', { min: 1, max: 60 }],
  longMin: ['LONG BREAK (MIN)', 'number', { min: 1, max: 120 }],
  longEvery: ['LONG BREAK EVERY', 'number', { min: 1, max: 12 }],
  graceSec: ['HALT AFTER (S AWAY)', 'number', { min: 1, max: 120 }],
};

// On/off switches: [key, title, hint]
const SWITCH = {
  autoStartBreak: ['Auto-start breaks', 'Breaks begin as soon as a block ends'],
  autoStartStudy: ['Auto-start study blocks', 'The next block begins when a break ends'],
  presence: ['Presence check', 'The clock only runs while you\'re in frame'],
  phoneCheck: ['Phone check', 'A phone in frame halts the clock'],
  alerts: ['Alerts', 'Pop-ups when blocks and breaks start or end'],
  sound: ['Sounds', 'Bell, cash register and warnings'],
  wakeLock: ['Keep screen awake', 'While the timer runs'],
  breakCards: ['Break flashcards', 'Show a card during breaks'],
  wrapUp: ['End-of-block wrap-up', 'A quick check-in after each block'],
};

const WRAP_QS = [['wrapFocus', 'FOCUS 1–5'], ['wrapNotes', 'WHAT I COVERED'], ['wrapModule', 'MODULE'], ['wrapQuestions', 'QUESTIONS']];
const PRESETS = [[25, 5, 15], [50, 10, 20], [90, 15, 30]];

function field(s, k) {
  const [label, type, attrs] = FIELD[k];
  return `<label>${label}<input name="${k}" type="${type}" value="${esc(s[k] ?? '')}" ${Object.entries(attrs).map(([a, v]) => `${a}="${v}"`).join(' ')}></label>`;
}

function sw(s, k) {
  const [title, hint] = SWITCH[k];
  return `<label class="sw"><span class="sw-text"><b>${title}</b><span class="muted small">${hint}</span></span><input type="checkbox" name="${k}" ${s[k] !== false ? 'checked' : ''}><span class="sw-ui" aria-hidden="true"></span></label>`;
}

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
    <div class="page-head"><h1>SETUP</h1><span class="saved-flash up small" hidden>✓ SAVED</span></div>
    <div class="grid-2">
      <div class="settings-form">
        <section class="panel">
          <div class="phead"><span>GOALS</span></div>
          <div class="fields">
            <label>LEVEL<select name="level">${[1, 2, 3].map((l) => `<option value="${l}" ${l === (s.level || 1) ? 'selected' : ''}>CFA LEVEL ${'I'.repeat(l)}</option>`).join('')}</select></label>
            ${(s.level || 1) === 3 ? `<label>PATHWAY<select name="pathway">${Object.entries(PATHWAYS).map(([k, v]) => `<option value="${k}" ${k === s.pathway ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
            ${field(s, 'examDate')}
            ${field(s, 'goalHours')}
            ${field(s, 'dailyGoalHours')}
            ${field(s, 'scoreTarget')}
          </div>
        </section>

        <section class="panel">
          <div class="phead"><span>TIMER</span></div>
          <div class="presets">${PRESETS.map(([a, b, c]) => `<button type="button" class="btn small" data-preset="${a},${b},${c}">${a}/${b}</button>`).join('')}<span class="muted small">one tap: study / break minutes</span></div>
          <div class="fields fields-4">
            ${field(s, 'studyMin')}${field(s, 'shortMin')}${field(s, 'longMin')}${field(s, 'longEvery')}
          </div>
          ${sw(s, 'autoStartBreak')}${sw(s, 'autoStartStudy')}
        </section>

        <section class="panel">
          <div class="phead"><span>DESK CAM</span></div>
          ${sw(s, 'presence')}
          <div class="sw-sub fields">${field(s, 'graceSec')}</div>
          ${sw(s, 'phoneCheck')}
        </section>

        <section class="panel">
          <div class="phead"><span>ALERTS &amp; EXTRAS</span></div>
          ${sw(s, 'alerts')}${sw(s, 'sound')}${sw(s, 'wakeLock')}${sw(s, 'breakCards')}
          ${sw(s, 'wrapUp')}
          <div class="sw-sub wrap-qs"><span class="muted small">ASKS:</span>${WRAP_QS.map(([k, label]) => `<label class="chip"><input type="checkbox" name="${k}" ${s[k] !== false ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
        </section>
      </div>

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

  // Changes save as you make them.
  const form = $('.settings-form', root);
  const syncSubs = () => {
    const st = store.doc.settings;
    $('.wrap-qs', root).hidden = st.wrapUp === false;
    $('[name="graceSec"]', root).closest('.sw-sub').hidden = st.presence === false;
    const cur = `${st.studyMin},${st.shortMin}`;
    root.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('primary', b.dataset.preset.startsWith(cur + ',')));
  };
  const flash = () => {
    const el = $('.saved-flash', root);
    el.hidden = false;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { el.hidden = true; }, 1600);
  };
  form.addEventListener('change', (e) => {
    const el = e.target;
    const k = el.name;
    const st = store.doc.settings; // re-read: a sync may have replaced it since render
    if (el.type === 'checkbox') st[k] = el.checked;
    else if (el.type === 'number') {
      const [, , attrs] = FIELD[k];
      const n = Number(el.value);
      if (!Number.isFinite(n) || el.value === '') { el.value = st[k]; return; }
      st[k] = Math.min(attrs.max ?? Infinity, Math.max(attrs.min ?? 0, n));
      el.value = st[k];
    } else if (k === 'level') st.level = Number(el.value) || 1;
    else st[k] = el.value;
    st.u = Date.now();
    save();
    syncSubs();
    flash();
  });
  root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const [study, brk, long] = b.dataset.preset.split(',').map(Number);
    const st = store.doc.settings;
    Object.assign(st, { studyMin: study, shortMin: brk, longMin: long, u: Date.now() });
    for (const [k, v] of [['studyMin', study], ['shortMin', brk], ['longMin', long]]) $(`[name="${k}"]`, root).value = v;
    save();
    syncSubs();
    flash();
  }));
  syncSubs();

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
