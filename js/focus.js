// Focus mode (F): a full-screen view with only the countdown, the desk-cam
// light, the topic and today's progress. Also keeps the screen awake while the
// timer runs, so a sleeping laptop doesn't stop the camera mid-block.
import { store } from './store.js';
import { timer, onTimer, toggle, phaseLengthSec, remainingSec } from './timer.js';
import { presence, onPresence, isPresent } from './presence.js';
import { stats, tickerOf } from './model.js';
import { clock, duration, esc } from './util.js';

let overlay = null;
let offs = [];

// Today's hours vs the daily target, and how many more blocks that is.
export function todayTarget() {
  const s = store.doc.settings;
  const today = stats().today;
  const goal = (s.dailyGoalHours || 0) * 3600;
  const left = Math.max(0, goal - today);
  return { today, goal, left, blocks: Math.ceil(left / ((s.studyMin || 25) * 60)), pct: goal ? Math.min(100, (today / goal) * 100) : 0 };
}

export function targetLine() {
  const t = todayTarget();
  if (!t.goal) return '<span class="muted">No daily target set (5 SETUP).</span>';
  return `<span class="k">TODAY</span> <b>${(t.today / 3600).toFixed(1)} / ${(t.goal / 3600).toFixed(1)}H</b>
    <span class="tgt-track"><span style="width:${t.pct}%"></span></span>
    <span class="${t.left ? 'muted' : 'up'}">${t.left ? `${t.blocks} more block${t.blocks === 1 ? '' : 's'}` : '✓ TARGET HIT'}</span>`;
}

const LABEL = { study: 'STUDY', short: 'BREAK', long: 'LONG BREAK' };

function update() {
  if (!overlay) return;
  const s = store.doc.settings;
  const total = phaseLengthSec();
  const left = remainingSec();
  let state = 'idle', status = timer.elapsedMs ? '■ HALTED · PAUSED' : '○ PRE-MARKET · SPACE TO OPEN';
  if (timer.running && timer.phase !== 'study') { state = 'break'; status = '◆ MARKET CLOSED · BREAK'; }
  else if (timer.running && timer.counting) { state = 'on'; status = '● MARKET OPEN'; }
  else if (timer.running) { state = 'away'; status = timer.halt === 'phone' ? '■ HALTED · PHONE IN HAND' : '■ HALTED · AWAY FROM DESK'; }
  overlay.dataset.state = state;
  const topic = store.doc.topics.find((t) => t.id === timer.topicId);
  const item = topic?.items.find((i) => i.id === timer.itemId);
  overlay.querySelector('.fm-phase').textContent = LABEL[timer.phase];
  overlay.querySelector('.fm-topic').innerHTML = timer.phase === 'study' ? `<b>${esc(topic ? tickerOf(topic) : 'GEN')}</b> ${esc(item?.name || topic?.name || 'General study')}` : '';
  overlay.querySelector('.fm-time').textContent = clock(left);
  overlay.querySelector('.fm-status').textContent = status;
  overlay.querySelector('.bar-fill').style.width = `${Math.min(100, ((total - left) / total) * 100)}%`;
  const cam = !s.presence || presence.state !== 'ready' ? 'off' : presence.phone && s.phoneCheck !== false ? 'away' : presence.seen ? 'seen' : isPresent(s.graceSec) ? 'grace' : 'away';
  overlay.querySelector('.fm-cam').dataset.state = cam;
  overlay.querySelector('.fm-cam-text').textContent = { off: s.presence ? 'CAM OFF' : 'NO CAM', seen: 'AT DESK', grace: 'LOOKING…', away: presence.phone ? 'PHONE' : 'AWAY' }[cam];
  overlay.querySelector('.fm-target').innerHTML = targetLine();
}

export function isFocusMode() { return Boolean(overlay); }

export function enterFocus() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'focus-mode';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Focus mode');
  overlay.innerHTML = `
    <div class="fm-top"><span class="fm-phase"></span><span class="fm-cam"><span class="lamp"></span><span class="fm-cam-text"></span></span></div>
    <div class="fm-center">
      <div class="fm-topic"></div>
      <div class="fm-time"></div>
      <div class="bar-track"><div class="bar-fill"></div></div>
      <div class="fm-status"></div>
    </div>
    <div class="fm-bottom"><div class="fm-target"></div><div class="muted small">SPACE OPEN/HALT · F OR ESC TO EXIT</div></div>`;
  document.body.append(overlay);
  overlay.addEventListener('dblclick', exitFocus);
  offs = [onTimer(update), onPresence(update)];
  update();
  document.documentElement.requestFullscreen?.().catch(() => {});
}

export function exitFocus() {
  if (!overlay) return;
  offs.forEach((off) => off());
  overlay.remove();
  overlay = null;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

export const toggleFocus = () => (overlay ? exitFocus() : enterFocus());

// While focus mode is up it owns the keyboard: Space toggles, F/Esc exit.
document.addEventListener('keydown', (e) => {
  if (!overlay || e.metaKey || e.ctrlKey || e.altKey) return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape' || e.key === 'f' || e.key === 'F') { e.preventDefault(); exitFocus(); }
  else if (e.code === 'Space') { e.preventDefault(); toggle(); }
}, true);
// Leaving browser full-screen (e.g. Esc handled by the browser) exits focus mode too.
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && overlay) exitFocus(); });

// ---------- Keep the screen awake while the timer runs ----------
let lock = null;
async function syncWakeLock() {
  const want = timer.running && store.doc?.settings.wakeLock !== false && document.visibilityState === 'visible';
  try {
    if (want && !lock && 'wakeLock' in navigator) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!want && lock) {
      await lock.release();
      lock = null;
    }
  } catch { lock = null; /* not allowed right now (e.g. battery saver) */ }
}
export const wakeLockActive = () => Boolean(lock);
onTimer(syncWakeLock);
document.addEventListener('visibilitychange', syncWakeLock);
