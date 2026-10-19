// Pomodoro state machine. Study blocks only advance while you're at the desk
// (when the presence check is on); breaks run on the wall clock.
import { store, save } from './store.js';
import { isPresent, onPresence } from './presence.js';
import { uid } from './util.js';
import { play } from './sounds.js';

const TICK_MS = 250;
// Ignore clock jumps larger than this (laptop sleep etc.).
const MAX_STEP_MS = 65000;
// Sessions shorter than this are discarded.
const MIN_SESSION_SEC = 10;

const listeners = new Set();

export const timer = {
  phase: 'study',      // 'study' | 'short' | 'long'
  running: false,
  elapsedMs: 0,        // counted time in the current phase
  awayMs: 0,           // time paused because nobody was in frame (this block)
  completed: 0,        // study blocks finished since the page was opened
  walkouts: 0,         // times the clock halted because you left the frame
  counting: false,     // whether the clock is currently advancing
  topicId: '',
  itemId: '',
  sessionId: '',       // id of the session record being written for this block
};

let lastTick = 0;
let lastFlush = 0;

export function onTimer(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(timer);
}

const settings = () => store.doc.settings;

export function phaseLengthSec(phase = timer.phase) {
  const s = settings();
  return 60 * (phase === 'study' ? s.studyMin : phase === 'long' ? s.longMin : s.shortMin);
}

export function remainingSec() {
  return phaseLengthSec() - timer.elapsedMs / 1000;
}

// Looked up by id each time: a sync replaces the objects in store.doc.
function currentSession() {
  return timer.sessionId ? store.doc.sessions.find((s) => s.id === timer.sessionId) : null;
}

function openSession(now) {
  const s = {
    id: uid(),
    topicId: timer.topicId,
    itemId: timer.itemId,
    level: settings().level || 1,
    start: now,
    end: now,
    sec: 0,
    verified: settings().presence,
    u: now,
  };
  store.doc.sessions.push(s);
  timer.sessionId = s.id;
  lastFlush = now;
  return s;
}

// Writes the open session to storage; closes it if `close`.
function flushSession(close) {
  const s = currentSession();
  if (!s) { timer.sessionId = ''; return; }
  const now = Date.now();
  if (close && s.sec < MIN_SESSION_SEC) {
    Object.assign(s, { deleted: true, u: now });
  } else {
    s.u = now;
  }
  if (close) timer.sessionId = '';
  lastFlush = now;
  save({ immediate: close });
}

function setCounting(on) {
  if (timer.counting && !on && timer.running && timer.phase === 'study' && settings().presence) timer.walkouts += 1;
  timer.counting = on;
}

function tick() {
  const now = Date.now();
  const step = Math.min(now - lastTick, MAX_STEP_MS);
  lastTick = now;
  if (!timer.running) return;

  if (timer.phase === 'study') {
    setCounting(!settings().presence || isPresent(settings().graceSec));
    if (timer.counting) {
      const s = currentSession() || openSession(now);
      timer.elapsedMs += step;
      s.sec += step / 1000;
      s.end = now;
      s.u = now; // keeps this copy newer than any synced copy
      if (now - lastFlush > 15000) flushSession(false);
    } else {
      timer.awayMs += step;
    }
  } else {
    timer.counting = true;
    timer.elapsedMs += step;
  }

  if (timer.elapsedMs >= phaseLengthSec() * 1000) finishPhase();
  emit();
}

setInterval(tick, TICK_MS);

function chime(kind) {
  if (settings().sound) play(kind);
}

function notify(title, body) {
  if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    try { new Notification(title, { body, silent: true }); } catch { /* ignore */ }
  }
}

function enterPhase(phase, autoStart) {
  timer.phase = phase;
  timer.elapsedMs = 0;
  timer.awayMs = 0;
  timer.running = autoStart;
  timer.counting = false;
  lastTick = Date.now();
}

function finishPhase() {
  if (timer.phase === 'study') {
    flushSession(true);
    timer.completed += 1;
    const long = timer.completed % settings().longEvery === 0;
    enterPhase(long ? 'long' : 'short', settings().autoStartBreak);
    chime('register');
    notify('Block banked', long ? 'Market closed. Long break.' : 'Market closed. Short break.');
  } else {
    enterPhase('study', false);
    chime('close');
    notify('Break over', 'Pre-market. Open when you\'re back at the desk.');
  }
}

export function start() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  lastTick = Date.now();
  if (timer.phase === 'study' && !timer.elapsedMs) chime('open');
  timer.running = true;
  emit();
}

export function pause() {
  timer.running = false;
  timer.counting = false;
  if (timer.sessionId) flushSession(false);
  emit();
}

// Ends the current phase now (study time so far is kept).
export function skip() {
  finishPhase();
  emit();
}

// Start the current phase over. Study time already logged is kept.
export function restart() {
  if (timer.phase === 'study') flushSession(true);
  enterPhase(timer.phase, false);
  emit();
}

export function switchTo(phase) {
  if (timer.phase === 'study') flushSession(true);
  enterPhase(phase, false);
  emit();
}

export function setTopic(topicId, itemId = '') {
  if (timer.topicId === topicId && timer.itemId === itemId) return;
  if (timer.sessionId) flushSession(true);
  timer.topicId = topicId;
  timer.itemId = itemId;
  emit();
}

// Re-evaluate on every detection result so the UI reacts immediately.
onPresence(() => {
  if (timer.running && timer.phase === 'study') {
    setCounting(!settings().presence || isPresent(settings().graceSec));
    emit();
  }
});

window.addEventListener('pagehide', () => { if (timer.sessionId) flushSession(false); });

