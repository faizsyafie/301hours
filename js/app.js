import { store, load, subscribe, sync, setPasscode } from './store.js';
import { timer, onTimer, remainingSec } from './timer.js';
import { renderDashboard } from './dashboard.js';
import { renderStudy } from './study.js';
import { renderTopics } from './topics.js';
import { renderSettings } from './settings.js';
import { $, $$, clock } from './util.js';
import { video } from './presence.js';

const ROUTES = {
  '': ['dashboard', renderDashboard],
  study: ['study', renderStudy],
  topics: ['topics', renderTopics],
  settings: ['settings', renderSettings],
};

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
  document.title = name === 'dashboard' ? '301hours' : `${name[0].toUpperCase()}${name.slice(1)} · 301hours`;
  updateMiniTimer();
}

const SYNC_LABEL = { synced: 'Synced', syncing: 'Syncing…', offline: 'Offline', locked: 'Locked', local: 'This device only' };

function updateSync() {
  const btn = $('.sync');
  btn.dataset.status = store.status;
  btn.textContent = SYNC_LABEL[store.status];
  btn.title = store.message || SYNC_LABEL[store.status];
  const banner = $('.banner');
  const show = store.status === 'locked' || (store.status === 'local' && store.message);
  banner.hidden = !show;
  if (show) banner.innerHTML = store.status === 'locked'
    ? 'Sync is locked. <button type="button" class="link" data-unlock>Enter passcode</button> to load your data from other devices.'
    : `${store.message} <a href="https://github.com/faizsyafie/301hours#deploying-to-vercel" target="_blank" rel="noopener">Setup guide</a>`;
}

function updateMiniTimer() {
  const pill = $('.mini-timer');
  const show = current !== 'study' && (timer.running || timer.elapsedMs > 0);
  pill.hidden = !show;
  if (!show) return;
  const label = timer.phase === 'study' ? (timer.running ? (timer.counting ? 'Studying' : 'Away') : 'Paused') : 'Break';
  pill.textContent = `${label} ${clock(remainingSec())}`;
  pill.dataset.state = timer.phase !== 'study' ? 'break' : timer.running && timer.counting ? 'on' : 'away';
}

function askPasscode() {
  const dlg = $('#passcode-dialog');
  const err = $('.error', dlg);
  err.hidden = true;
  dlg.querySelector('input').value = '';
  dlg.showModal();
}

$('#passcode-dialog').addEventListener('close', async (e) => {
  const dlg = e.target;
  if (dlg.returnValue !== 'ok') return;
  setPasscode(dlg.querySelector('input').value);
  await sync();
  if (store.status === 'locked') {
    $('.error', dlg).textContent = 'That passcode didn\'t work.';
    $('.error', dlg).hidden = false;
    dlg.showModal();
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-unlock]') || (e.target.closest('.sync') && store.status === 'locked')) askPasscode();
  else if (e.target.closest('.sync')) sync();
});

let lastStatus = null;
let lastDocStamp = 0;
subscribe(() => {
  updateSync();
  if (store.status === 'locked' && lastStatus !== 'locked') askPasscode();
  lastStatus = store.status;
  // Fresh data from another device: refresh read-only views.
  if (store.doc.updatedAt !== lastDocStamp && current === 'dashboard') {
    lastDocStamp = store.doc.updatedAt;
    route();
  }
});

onTimer(updateMiniTimer);
window.addEventListener('hashchange', route);

$('#cam-holder').append(video);
load(); // reads this browser's copy synchronously, then syncs in the background
lastDocStamp = store.doc.updatedAt;
route();
