import { store, load, subscribe, sync, save, setPasscode } from './store.js';
import { timer, onTimer, onAlert, remainingSec, setTopic, restoreTimer } from './timer.js';
import { toast } from './toast.js';
import { renderDashboard, tickerItems, milestonesFor, symbol } from './dashboard.js';
import { renderStudy } from './study.js';
import { renderTopics } from './topics.js';
import { renderSettings } from './settings.js';
import { renderScores } from './scores.js';
import { stats, currentLevel } from './model.js';
import { creditRating, gradeRank, weakest } from './ratings.js';
import { play } from './sounds.js';
import { showAbout } from './about.js';
import './install.js';
import { $, $$, clock, esc } from './util.js';
import { video } from './presence.js';

const ROUTES = {
  '': ['dashboard', renderDashboard],
  study: ['study', renderStudy],
  topics: ['topics', renderTopics],
  earnings: ['earnings', renderScores],
  settings: ['settings', renderSettings],
};
const KEYS = { 1: '#/', 2: '#/study', 3: '#/topics', 4: '#/earnings', 5: '#/settings' };

let cleanup = null;
let current = '';

function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, render] = ROUTES[path] || ROUTES[''];
  if (typeof cleanup === 'function') cleanup();
  // Fresh element per view so event listeners never pile up.
  const view = document.createElement('main');
  view.id = 'view';
  view.className = `view-${name}`;
  $('#view').replaceWith(view);
  current = name;
  cleanup = render(view, new URLSearchParams(query || ''));
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  document.title = name === 'dashboard' ? `${symbol()} · 301 TERMINAL` : `${name.toUpperCase()} · 301 TERMINAL`;
  updateHeader();
}

const SYNC_LABEL = { synced: 'SYNCED', syncing: 'SYNCING', offline: 'OFFLINE', locked: 'LOCKED', local: 'NOT SYNCED' };

function updateSync() {
  const btn = $('.sync');
  btn.dataset.status = store.status;
  btn.textContent = SYNC_LABEL[store.status];
  btn.title = store.message || SYNC_LABEL[store.status];
  const banner = $('.banner');
  const show = store.status === 'locked' || ((store.status === 'local' || store.status === 'offline') && store.message);
  banner.hidden = !show;
  if (show) banner.innerHTML = store.status === 'locked'
    ? `SYNC LOCKED. ${esc(store.message)} <button type="button" class="link" data-unlock>ENTER PASSCODE</button>`
    : `${esc(store.message)} <a href="https://github.com/faizsyafie/301hours#deploying-to-vercel" target="_blank" rel="noopener">SETUP GUIDE</a>`;
}

function updateHeader() {
  const level = currentLevel();
  $$('.levels button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.level) === level)));
  updateMiniTimer();
}

function updateMiniTimer() {
  const pill = $('.mini-timer');
  const show = current !== 'study' && (timer.running || timer.elapsedMs > 0);
  pill.hidden = !show;
  if (!show) return;
  const label = timer.phase === 'study' ? (timer.running ? (timer.counting ? 'OPEN' : 'HALT') : 'PAUSED') : 'BREAK';
  pill.textContent = `${label} ${clock(remainingSec())}`;
  pill.dataset.state = timer.phase !== 'study' ? 'break' : timer.running && timer.counting ? 'on' : 'away';
}

// ---------- Ticker tape ----------
let lastTape = '';
function updateTape() {
  const html = tickerItems().map((i) => `<span class="ti">${i}</span>`).join('');
  if (html === lastTape) return;
  lastTape = html;
  // Two copies side by side so the scroll loops seamlessly.
  $('.tape-track').innerHTML = `<div class="tape-run">${html}</div><div class="tape-run">${html}</div>`;
}

// ---------- Milestones ----------
function checkMilestones() {
  const s = store.doc.settings;
  const level = currentLevel();
  const totalH = stats(level).total / 3600;
  const seen = new Set(s.celebrated || []);
  const fresh = milestonesFor(Math.round(s.goalHours)).filter(([h]) => totalH >= h && !seen.has(`${level}:${h}`));
  if (!fresh.length) return;
  s.celebrated = [...seen, ...fresh.map(([h]) => `${level}:${h}`)];
  s.u = Date.now();
  save();
  const [h, headline] = fresh[fresh.length - 1];
  breaking(h, headline);
}

// ---------- Credit rating changes ----------
let dataReady = false; // true once the first sync attempt has finished
function checkCredit() {
  if (!dataReady) return;
  const s = store.doc.settings;
  const level = currentLevel();
  const cr = creditRating(stats(level), s.dailyGoalHours);
  const prev = (s.creditRatings || {})[level];
  if (cr.grade === 'NR' || prev === cr.grade) return;
  s.creditRatings = { ...(s.creditRatings || {}), [level]: cr.grade };
  s.u = Date.now();
  save();
  if (!prev) {
    toast({ kind: 'study', title: `◆ INITIAL RATING · ${symbol()} RATED ${cr.grade}`, body: `Outlook ${cr.outlook.toLowerCase()}. Tap RATING on the dashboard to see how it's calculated.` });
  } else if (gradeRank(cr.grade) < gradeRank(prev)) {
    toast({ kind: 'study', title: `▲ UPGRADED · ${prev} → ${cr.grade}`, body: `${symbol()} upgraded on stronger consistency. Outlook ${cr.outlook.toLowerCase()}.` });
  } else {
    toast({ kind: 'warn', title: `▼ DOWNGRADED · ${prev} → ${cr.grade}`, body: `Main driver: ${weakest(cr.parts)}. Outlook ${cr.outlook.toLowerCase()}.` });
  }
}

function breaking(h, headline) {
  const el = $('.breaking');
  el.innerHTML = `
    <span class="flash">BREAKING</span>
    <span class="headline"><b>${symbol()} HITS ${h}H</b> — ${headline}</span>
    <button type="button" class="btn small" data-dismiss>DISMISS</button>`;
  el.hidden = false;
  if (store.doc.settings.sound) play('breaking');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) rain();
  el.querySelector('[data-dismiss]').addEventListener('click', () => { el.hidden = true; });
}

function rain() {
  const box = document.createElement('div');
  box.className = 'rain';
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('span');
    c.textContent = ['$', '▲', '301', '$', '+'][i % 5];
    c.style.left = `${Math.random() * 100}%`;
    c.style.animationDelay = `${Math.random() * 1.2}s`;
    c.style.animationDuration = `${2 + Math.random() * 2}s`;
    c.style.fontSize = `${12 + Math.random() * 18}px`;
    box.append(c);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 5000);
}

// ---------- Passcode ----------
function askPasscode() {
  const dlg = $('#passcode-dialog');
  if (dlg.open) return;
  $('.error', dlg).hidden = true;
  dlg.querySelector('input').value = '';
  dlg.showModal();
}

$('#passcode-dialog').addEventListener('close', async (e) => {
  const dlg = e.target;
  if (dlg.returnValue !== 'ok') return;
  setPasscode(dlg.querySelector('input').value);
  await sync();
  if (store.status === 'locked') {
    $('.error', dlg).textContent = 'ACCESS DENIED. Check it matches APP_PASSCODE in Vercel exactly (case-sensitive), and that you redeployed after setting it.';
    $('.error', dlg).hidden = false;
    if (!dlg.open) dlg.showModal();
  }
});

// ---------- Global events ----------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-about]')) return showAbout();
  const lvl = e.target.closest('.levels button');
  if (lvl) {
    const level = Number(lvl.dataset.level);
    if (level === currentLevel()) return;
    store.doc.settings.level = level;
    store.doc.settings.u = Date.now();
    setTopic('', '');
    save();
    return;
  }
  if (e.target.closest('[data-unlock]') || (e.target.closest('.sync') && store.status === 'locked')) askPasscode();
  else if (e.target.closest('.sync') && (store.status === 'local' || store.status === 'offline')) location.hash = '#/settings';
  else if (e.target.closest('.sync')) sync();
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (KEYS[e.key]) location.hash = KEYS[e.key];
  else if ((e.key === '6' || e.key === '?') && !document.querySelector('dialog[open]')) showAbout();
});

let lastStatus = null;
let lastStamp = 0;
let lastLevel = 0;
subscribe(() => {
  updateSync();
  if (store.status === 'locked' && lastStatus !== 'locked') askPasscode();
  if (store.status === 'synced' && $('#passcode-dialog').open) $('#passcode-dialog').close('synced');
  if (lastStatus === 'syncing' && store.status !== 'syncing') dataReady = true;
  lastStatus = store.status;
  const level = currentLevel();
  if (level !== lastLevel) {
    // Level switched (here or on another device): redraw whatever is open.
    lastLevel = level;
    lastTape = '';
    route();
  } else if (store.doc.updatedAt !== lastStamp && current === 'dashboard') {
    route();
  }
  lastStamp = store.doc.updatedAt;
  updateTape();
  checkMilestones();
  checkCredit();
});

onTimer(updateMiniTimer);
onAlert(toast);
window.addEventListener('hashchange', route);

const tick = () => { $('.clock').textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); };
tick();
setInterval(tick, 1000);

$('#cam-holder').append(video);
load(); // reads this browser's copy synchronously, then syncs in the background
lastStamp = store.doc.updatedAt;
lastLevel = currentLevel();
restoreTimer();
route();
updateTape();
