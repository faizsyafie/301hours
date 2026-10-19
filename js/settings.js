import { store, save, sync, subscribe, setPasscode, getPasscode } from './store.js';
import { mergeDocs } from '../lib/merge.js';
import { $, esc, dayKey } from './util.js';
import { PATHWAYS } from './curriculum.js';

const FIELDS = [
  ['goalHours', 'TARGET HOURS (PER LEVEL)', 'number', { min: 1, max: 2000 }],
  ['dailyGoalHours', 'DAILY TARGET (HOURS)', 'number', { min: 0, max: 16, step: 0.5 }],
  ['examDate', 'EXAM DATE', 'date', {}],
  ['studyMin', 'STUDY BLOCK (MIN)', 'number', { min: 1, max: 180 }],
  ['shortMin', 'SHORT BREAK (MIN)', 'number', { min: 1, max: 60 }],
  ['longMin', 'LONG BREAK (MIN)', 'number', { min: 1, max: 120 }],
  ['longEvery', 'LONG BREAK EVERY N BLOCKS', 'number', { min: 1, max: 12 }],
  ['graceSec', 'SECONDS AWAY BEFORE HALT', 'number', { min: 1, max: 120 }],
];

const TOGGLES = [
  ['presence', 'Only count study time while I\'m at the desk (camera)'],
  ['autoStartBreak', 'Start breaks automatically'],
  ['sound', 'Play a sound when a block or break ends'],
];

const SYNC_TEXT = {
  synced: 'Synced. Your data is saved to your Vercel database and shows up on every device.',
  syncing: 'Syncing…',
  offline: 'Can\'t reach the server right now. Changes are kept in this browser and will sync later.',
  locked: 'Locked. Enter your passcode to sync.',
  local: 'Not synced. Data is saved in this browser only.',
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
          <form class="pass-form row">
            <input name="code" type="password" placeholder="PASSCODE" value="${esc(getPasscode())}" autocomplete="current-password">
            <button class="btn" type="submit">SAVE &amp; SYNC</button>
          </form>
        </section>
        <section class="panel">
          <div class="phead"><span>BACKUP</span></div>
          <p class="note">Download all your data as a file, or load a backup. Loading merges it with what's already here, so nothing is overwritten.</p>
          <div class="row">
            <button type="button" class="btn" data-act="export">DOWNLOAD</button>
            <label class="btn">LOAD FILE<input type="file" accept="application/json,.json" name="import" hidden></label>
          </div>
        </section>
      </div>
    </div>`;

  const showSync = () => {
    $('.sync-text', root).textContent = SYNC_TEXT[store.status] || '';
    $('.sync-msg', root).textContent = store.message;
  };
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
      alert('Backup loaded.');
    } catch (err) {
      alert(`Couldn't load that file: ${err.message}`);
    }
  });

  return subscribe(showSync);
}
