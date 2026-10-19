import { store, save } from './store.js';
import { timer, onTimer, start, pause, skip, restart, switchTo, setTopic, phaseLengthSec, remainingSec } from './timer.js';
import { presence, onPresence, startCamera, stopCamera, isPresent, video } from './presence.js';
import { $, esc, clock, duration, uid, dayKey, startOfDay } from './util.js';

const PHASES = { study: 'Study', short: 'Short break', long: 'Long break' };
const RING_R = 88;
const RING_C = 2 * Math.PI * RING_R;
const PREVIEW_KEY = '301hours:hidePreview';

function hidePreview() {
  try { return localStorage.getItem(PREVIEW_KEY) === '1'; } catch { return false; }
}

function topicOptions() {
  const topics = store.doc.topics.filter((t) => !t.deleted);
  return `<option value="">General study</option>` + topics.map((t) => `<option value="${esc(t.id)}" ${t.id === timer.topicId ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}

function moduleOptions(topicId) {
  const t = store.doc.topics.find((x) => x.id === topicId);
  if (!t) return '';
  const items = t.items.filter((i) => !i.deleted);
  const opt = (i) => `<option value="${esc(i.id)}" ${i.id === timer.itemId ? 'selected' : ''}>${i.done ? '✓ ' : ''}${esc(i.name)}</option>`;
  return `<option value="">Whole topic</option>` + items.map(opt).join('');
}

function todayStats() {
  const today = startOfDay(Date.now());
  let sec = 0;
  for (const s of store.doc.sessions) if (!s.deleted && s.start >= today) sec += s.sec;
  return sec;
}

export function renderStudy(root) {
  const s = store.doc.settings;
  root.innerHTML = `
    <div class="study">
      <section class="card timer-card" data-phase="${timer.phase}">
        <div class="seg" role="tablist">
          ${Object.entries(PHASES).map(([k, v]) => `<button type="button" role="tab" data-phase="${k}" aria-selected="${k === timer.phase}">${v}</button>`).join('')}
        </div>

        <div class="ring-wrap">
          <svg class="ring" viewBox="0 0 200 200" aria-hidden="true">
            <circle class="ring-track" cx="100" cy="100" r="${RING_R}"/>
            <circle class="ring-fill" cx="100" cy="100" r="${RING_R}" stroke-dasharray="${RING_C}" transform="rotate(-90 100 100)"/>
          </svg>
          <div class="ring-center">
            <div class="time" aria-live="off"></div>
            <div class="state"></div>
          </div>
        </div>

        <div class="controls">
          <button type="button" class="btn ghost" data-act="restart" title="Start this block over">Restart</button>
          <button type="button" class="btn primary big" data-act="toggle"></button>
          <button type="button" class="btn ghost" data-act="skip" title="End this block now">Skip</button>
        </div>

        <div class="fields">
          <label>Topic<select name="topic">${topicOptions()}</select></label>
          <label>Module<select name="item">${moduleOptions(timer.topicId)}</select></label>
        </div>
        <div class="study-foot">
          <span>Today: <strong class="today"></strong></span>
          <span>Blocks this sitting: <strong class="blocks"></strong></span>
          <span class="away-wrap">Away this block: <strong class="away-time"></strong></span>
        </div>
      </section>

      <div class="side">
        <section class="card cam-card">
          <div class="card-head">
            <h2>Presence check</h2>
            <label class="switch"><input type="checkbox" name="presence" ${s.presence ? 'checked' : ''}><span>On</span></label>
          </div>
          <div class="cam" data-state="off">
            <div class="cam-box" hidden></div>
            <div class="cam-placeholder"></div>
            <div class="cam-badge"></div>
          </div>
          <div class="row">
            <button type="button" class="btn" data-act="camera"></button>
            <label class="check"><input type="checkbox" name="hidePreview" ${hidePreview() ? 'checked' : ''}> Hide video</label>
          </div>
          <p class="muted small">Study time only counts while you're in frame. Leave for more than ${s.graceSec}s and it pauses until you're back. Breaks don't need the camera. Detection runs on this device; no video is uploaded or stored.</p>
          <p class="muted small">Keep this tab visible (a separate window works well). Browsers slow down background tabs, which can delay detection.</p>
        </section>

        <section class="card">
          <details class="manual">
            <summary><h2>Log time manually</h2></summary>
            <p class="muted small">For study done away from the camera, e.g. on the commute. It's marked as manual on the dashboard.</p>
            <form class="manual-form">
              <div class="fields">
                <label>Topic<select name="mtopic">${topicOptions()}</select></label>
                <label>Date<input type="date" name="mdate" value="${dayKey(Date.now())}" max="${dayKey(Date.now())}"></label>
                <label>Minutes<input type="number" name="mmin" min="1" max="720" step="1" required></label>
              </div>
              <button class="btn" type="submit">Add</button>
              <span class="muted small saved" hidden>Added.</span>
            </form>
          </details>
        </section>
      </div>
    </div>`;

  const camEl = $('.cam', root);
  camEl.prepend(video);
  video.play().catch(() => {});

  // Events
  root.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => switchTo(b.dataset.phase)));
  $('[data-act="toggle"]', root).addEventListener('click', () => {
    if (timer.running) return pause();
    if (timer.phase === 'study' && store.doc.settings.presence && presence.state !== 'ready') startCamera();
    start();
  });
  $('[data-act="skip"]', root).addEventListener('click', skip);
  $('[data-act="restart"]', root).addEventListener('click', restart);
  $('[data-act="camera"]', root).addEventListener('click', () => (presence.state === 'off' || presence.state === 'error' ? startCamera() : stopCamera()));

  const topicSel = $('[name="topic"]', root);
  const itemSel = $('[name="item"]', root);
  topicSel.addEventListener('change', () => {
    setTopic(topicSel.value, '');
    itemSel.innerHTML = moduleOptions(topicSel.value);
    itemSel.disabled = !topicSel.value;
  });
  itemSel.disabled = !timer.topicId;
  itemSel.addEventListener('change', () => setTopic(topicSel.value, itemSel.value));

  $('[name="presence"]', root).addEventListener('change', (e) => {
    store.doc.settings.presence = e.target.checked;
    store.doc.settings.u = Date.now();
    save();
    if (e.target.checked && timer.running && timer.phase === 'study') startCamera();
    update();
  });
  $('[name="hidePreview"]', root).addEventListener('change', (e) => {
    try { localStorage.setItem(PREVIEW_KEY, e.target.checked ? '1' : '0'); } catch { /* ignore */ }
    update();
  });

  $('.manual-form', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const min = Number(f.mmin.value);
    if (!min) return;
    const day = new Date(f.mdate.value + 'T12:00').getTime();
    const now = Date.now();
    const startTs = dayKey(day) === dayKey(now) ? now - min * 60000 : day;
    store.doc.sessions.push({ id: uid(), topicId: f.mtopic.value, itemId: '', start: startTs, end: startTs + min * 60000, sec: min * 60, verified: false, manual: true, u: now });
    save({ immediate: true });
    f.mmin.value = '';
    $('.saved', f).hidden = false;
    setTimeout(() => { $('.saved', f).hidden = true; }, 2500);
    update();
  });

  function update() {
    const settings = store.doc.settings;
    const card = $('.timer-card', root);
    card.dataset.phase = timer.phase;
    root.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.phase === timer.phase)));

    const total = phaseLengthSec();
    const left = remainingSec();
    $('.time', root).textContent = clock(left);
    $('.ring-fill', root).style.strokeDashoffset = String(RING_C * (1 - Math.min(1, (total - left) / total)));

    let state, cls;
    if (!timer.running) { state = timer.elapsedMs ? 'Paused' : timer.phase === 'study' ? 'Ready' : 'Break ready'; cls = 'idle'; }
    else if (timer.phase !== 'study') { state = 'On break'; cls = 'break'; }
    else if (timer.counting) { state = 'Studying'; cls = 'on'; }
    else if (settings.presence && presence.state !== 'ready') { state = presence.state === 'loading' ? 'Starting camera…' : 'Camera off · paused'; cls = 'away'; }
    else { state = 'Away · paused'; cls = 'away'; }
    const stateEl = $('.state', root);
    stateEl.textContent = state;
    stateEl.className = `state ${cls}`;
    card.dataset.state = cls;

    $('[data-act="toggle"]', root).textContent = timer.running ? 'Pause' : timer.elapsedMs ? 'Resume' : 'Start';
    $('.today', root).textContent = duration(todayStats());
    $('.blocks', root).textContent = String(timer.completed);
    $('.away-time', root).textContent = clock(timer.awayMs / 1000);
    $('.away-wrap', root).hidden = timer.phase !== 'study' || !settings.presence;

    // Camera panel
    const hide = hidePreview();
    const present = isPresent(settings.graceSec);
    const camState = presence.state !== 'ready' ? presence.state : presence.seen ? 'seen' : present ? 'grace' : 'away';
    camEl.dataset.state = camState;
    camEl.classList.toggle('hidden-preview', hide);
    const badge = {
      off: '○ Camera off',
      loading: '… Loading detector',
      error: `⚠ ${presence.error}`,
      seen: '● In frame',
      grace: '◐ Not seen, waiting…',
      away: '✕ Not in frame',
    }[camState];
    $('.cam-badge', root).textContent = badge;
    $('.cam-placeholder', root).textContent = presence.state === 'ready' && hide ? 'Preview hidden, still detecting' : presence.state === 'off' ? 'Camera is off' : '';
    $('[data-act="camera"]', root).textContent = presence.state === 'off' || presence.state === 'error' ? 'Turn camera on' : 'Turn camera off';

    const box = $('.cam-box', root);
    if (presence.state === 'ready' && presence.box && !hide) {
      const b = presence.box;
      Object.assign(box.style, { left: `${(1 - b.x - b.w) * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  update();
  const offs = [onTimer(update), onPresence(update)];
  return () => {
    offs.forEach((off) => off());
    $('#cam-holder').append(video);
  };
}
