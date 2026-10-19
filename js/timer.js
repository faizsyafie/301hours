// Pomodoro state machine. Study blocks only advance while you're at the desk
// (when the presence check is on); breaks run on the wall clock.
import { store, save } from './store.js';
import { isPresent, onPresence, presence, startCamera } from './presence.js';
import { uid, dayKey } from './util.js';
import { play } from './sounds.js';

const TICK_MS = 250;
// Ignore clock jumps larger than this (laptop sleep etc.).
const MAX_STEP_MS = 65000;
// Sessions shorter than this are discarded.
const MIN_SESSION_SEC = 10;
// Heads-up this many seconds before a block or break ends (phases of 2+ min).
const WARN_SEC = 60;

const listeners = new Set();
const alertListeners = new Set();

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
let warned = false;

// Phase-change alerts: { kind: 'study' | 'break' | 'warn', title, body }.
export function onAlert(fn) {
  alertListeners.add(fn);
  return () => alertListeners.delete(fn);
}

function announce(kind, title, body, sound) {
  if (sound) chime(sound);
  if (settings().alerts !== false) for (const fn of alertListeners) fn({ kind, title, body });
  notify(title.replace(/^[^A-Z0-9]+/, ''), body);
}

const breakName = (phase) => (phase === 'long' ? 'long break' : 'short break');

export function onTimer(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(timer);
  persistSoon();
}

// ---------- Surviving a reload ----------
// The timer's state is kept in this browser so a refresh or an accidental tab
// close picks up where it left off.
const TIMER_KEY = '301hours:timer';
const RESTORE_WITHIN_MS = 6 * 3600000;
const SAVED = ['phase', 'running', 'elapsedMs', 'awayMs', 'completed', 'walkouts', 'topicId', 'itemId', 'sessionId'];
let lastPersist = 0;

function persist() {
  lastPersist = Date.now();
  const state = Object.fromEntries(SAVED.map((k) => [k, timer[k]]));
  try {
    localStorage.setItem(TIMER_KEY, JSON.stringify({ ...state, warned, savedAt: lastPersist, day: dayKey(lastPersist) }));
  } catch { /* storage unavailable */ }
}

let lastShape = '';
function persistSoon() {
  // Save at once when running/phase change, otherwise at most once a second.
  const shape = `${timer.running}|${timer.phase}|${timer.topicId}|${timer.itemId}`;
  if (shape !== lastShape || Date.now() - lastPersist > 1000) {
    lastShape = shape;
    persist();
  }
}

// Call once after the store has loaded (phase lengths come from settings).
// Returns true if a previous timer was restored.
export function restoreTimer() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(TIMER_KEY)); } catch { saved = null; }
  const now = Date.now();
  if (!saved || now - saved.savedAt > RESTORE_WITHIN_MS) return false;
  for (const k of SAVED) if (k in saved) timer[k] = saved[k];
  if (saved.day !== dayKey(now)) timer.completed = 0;
  warned = Boolean(saved.warned);
  timer.counting = false;
  // The block's session record must still exist (it may have been too short to keep).
  const s = timer.sessionId && store.doc.sessions.find((x) => x.id === timer.sessionId && !x.deleted);
  if (!s) timer.sessionId = '';
  lastTick = now;
  if (timer.running) {
    if (timer.phase !== 'study') {
      // Breaks run on the wall clock, including while the page was closed.
      timer.elapsedMs += now - saved.savedAt;
      if (timer.elapsedMs >= phaseLengthSec() * 1000) finishPhase();
    } else if (settings().presence) {
      // Study time while the page was closed can't be verified, so it isn't counted.
      startCamera();
    }
  }
  emit();
  return true;
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

  const left = phaseLengthSec() - timer.elapsedMs / 1000;
  if (!warned && phaseLengthSec() >= 2 * WARN_SEC && left <= WARN_SEC && left > 0) {
    warned = true;
    if (timer.phase === 'study') {
      const next = (timer.completed + 1) % settings().longEvery === 0 ? 'long' : 'short';
      announce('warn', '▲ 1 MIN LEFT IN THIS BLOCK', `Wrap up your current point. A ${breakName(next)} comes next.`, 'tick');
    } else {
      announce('warn', '▲ BREAK ENDS IN 1 MIN', settings().autoStartStudy !== false
        ? 'The next study block starts by itself. Head back to the desk.'
        : 'Head back to the desk and open the market when ready.', 'tick');
    }
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
  warned = false;
  lastTick = Date.now();
}

function finishPhase() {
  const st = settings();
  if (timer.phase === 'study') {
    flushSession(true);
    timer.completed += 1;
    const next = timer.completed % st.longEvery === 0 ? 'long' : 'short';
    const auto = st.autoStartBreak !== false;
    enterPhase(next, auto);
    const mins = next === 'long' ? st.longMin : st.shortMin;
    announce('break', `◆ MARKET CLOSED · BLOCK ${timer.completed} BANKED`, auto
      ? `Your ${mins}-min ${breakName(next)} starts now. Stand up, stretch, look away from the screen.`
      : `Your ${mins}-min ${breakName(next)} is ready. Press SPACE to start it.`, 'register');
  } else {
    const auto = st.autoStartStudy !== false;
    enterPhase('study', auto);
    if (auto) {
      if (st.presence && presence.state !== 'ready' && presence.state !== 'loading') startCamera();
      announce('study', '● MARKET OPEN · STUDY BLOCK STARTS', st.presence
        ? `Your ${st.studyMin}-min block starts now. The clock runs as soon as you're back in frame.`
        : `Your ${st.studyMin}-min block starts now.`, 'open');
    } else {
      announce('study', '○ BREAK OVER · PRE-MARKET', 'Press SPACE or OPEN MARKET when you\'re back at the desk.', 'close');
    }
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

window.addEventListener('pagehide', () => {
  if (timer.sessionId) flushSession(false);
  persist();
});

