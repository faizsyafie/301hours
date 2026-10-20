import { store, save, subscribe } from './store.js';
import { timer, onTimer, toggle, skip, restart, switchTo, setTopic, phaseLengthSec, remainingSec } from './timer.js';
import { openMini, miniMode } from './pip.js';
import { ambient, MODES, setMode, setVolume, preview } from './ambient.js';
import { presence, onPresence, startCamera, stopCamera, isPresent, video } from './presence.js';
import { levelTopics, currentLevel, sessionLevel, tickerOf, stats } from './model.js';
import { analystRatings, topPick } from './ratings.js';
import { $, esc, clock, duration, uid, dayKey, startOfDay } from './util.js';

const PHASES = { study: 'STUDY', short: 'BREAK', long: 'LONG BREAK' };
const PREVIEW_KEY = '301hours:hidePreview';

function hidePreview() {
  try { return localStorage.getItem(PREVIEW_KEY) === '1'; } catch { return false; }
}

function topicOptions(selected) {
  return `<option value="">GEN · General study</option>` + levelTopics().map((t) => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(tickerOf(t))} · ${esc(t.name)}</option>`).join('');
}

function moduleOptions(topicId) {
  const t = store.doc.topics.find((x) => x.id === topicId);
  if (!t) return '<option value="">—</option>';
  const opt = (i) => `<option value="${esc(i.id)}" ${i.id === timer.itemId ? 'selected' : ''}>${i.done ? '✓ ' : ''}${esc(i.name)}</option>`;
  return `<option value="">Whole topic</option>` + t.items.filter((i) => !i.deleted).map(opt).join('');
}

function todaySec() {
  const today = startOfDay(Date.now());
  let sec = 0;
  for (const s of store.doc.sessions) if (!s.deleted && s.start >= today && sessionLevel(s) === currentLevel()) sec += s.sec;
  return sec;
}

export function renderStudy(root) {
  // Topic from another level? Start fresh on this level.
  if (timer.topicId && !levelTopics().some((t) => t.id === timer.topicId)) setTopic('', '');

  const s = store.doc.settings;
  root.innerHTML = `
    <div class="study">
      <section class="panel timer-panel" data-phase="${timer.phase}">
        <div class="phead"><span>SESSION</span><span class="muted">SPACE OPEN/HALT · S SKIP · R RESET · P POP OUT</span></div>
        <div class="seg" role="tablist">
          ${Object.entries(PHASES).map(([k, v]) => `<button type="button" role="tab" data-phase="${k}" aria-selected="${k === timer.phase}">${v}</button>`).join('')}
        </div>
        <div class="board">
          <div class="status"></div>
          <div class="time" aria-live="off"></div>
          <div class="bar-track"><div class="bar-fill"></div></div>
        </div>
        <div class="controls">
          <button type="button" class="btn" data-act="restart" title="Start this block over (R)">RESET</button>
          <button type="button" class="btn primary big" data-act="toggle"></button>
          <button type="button" class="btn" data-act="skip" title="End this block now (S)">SKIP ▸</button>
        </div>
        <div class="popout-row">
          <button type="button" class="btn small" data-act="popout" title="${miniMode === 'pip' ? 'Always-on-top mini window (P)' : 'Small separate window (P)'}">⧉ POP OUT MINI-TERMINAL</button>
          <span class="note">${miniMode === 'pip' ? 'Stays on top of other windows, so you can read your notes and still see the clock.' : 'Opens a small window. Pinning it on top needs Chrome or Edge.'}</span>
        </div>
        <div class="fields">
          <label>TOPIC<select name="topic">${topicOptions(timer.topicId)}</select></label>
          <label>MODULE<select name="item">${moduleOptions(timer.topicId)}</select></label>
        </div>
        <div class="pick-row"></div>
        <div class="kv-row">
          <div><span class="k">TODAY</span><span class="v today"></span></div>
          <div><span class="k">BLOCKS</span><span class="v blocks"></span></div>
          <div><span class="k">HALTED</span><span class="v away-time"></span></div>
          <div><span class="k">WALKOUTS</span><span class="v walkouts"></span></div>
          <div><span class="k">PICKUPS</span><span class="v pickups"></span></div>
        </div>
      </section>

      <div class="side">
        <section class="panel cam-panel">
          <div class="phead">
            <span>DESK CAM</span>
            <span class="row" style="gap:12px">
              <label class="switch"><input type="checkbox" name="presence" ${s.presence ? 'checked' : ''}> PRESENCE</label>
              <label class="switch"><input type="checkbox" name="phoneCheck" ${s.phoneCheck !== false ? 'checked' : ''}> PHONE CHECK</label>
            </span>
          </div>
          <div class="onair" data-state="off"><span class="lamp"></span><span class="onair-text"></span></div>
          <div class="readout" hidden></div>
          <div class="cam" data-state="off">
            <div class="cam-box" hidden></div>
            <div class="cam-box phone-box" hidden></div>
            <div class="cam-placeholder"></div>
            <div class="scan"></div>
          </div>
          <div class="row">
            <button type="button" class="btn" data-act="camera"></button>
            <label class="check"><input type="checkbox" name="hidePreview" ${hidePreview() ? 'checked' : ''}> HIDE VIDEO</label>
          </div>
          <p class="note">The clock only runs while you're at the desk. Leave for more than <b>${s.graceSec}s</b> and trading halts until you're back. Breaks don't need the camera. It needs a confident face, or your body confirmed by two separate models, so chairs don't count. With PHONE CHECK on, a phone in frame halts the clock too. Detection runs on this device; no video is uploaded or stored.</p>
          <p class="note">Keep this tab visible. Browsers throttle background tabs, so a separate window works best.</p>
        </section>

        <section class="panel">
          <div class="phead"><span>FOCUS SOUND</span><span class="muted">PLAYS DURING STUDY BLOCKS · MUTES ON BREAKS</span></div>
          <div class="row ambient-row">
            <select name="ambient">${Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${k === ambient.mode ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <label class="vol">VOL <input type="range" name="ambVol" min="0" max="100" value="${ambient.volume}"></label>
            <button type="button" class="btn small" data-act="preview">▶ PREVIEW</button>
          </div>
        </section>

        <section class="panel">
          <details class="manual">
            <summary class="phead"><span>OFF-DESK ENTRY</span><span class="muted">LOG TIME MANUALLY ▾</span></summary>
            <p class="note">For study away from the camera, like the commute. It's flagged MAN on the tape.</p>
            <form class="manual-form">
              <div class="fields">
                <label>TOPIC<select name="mtopic">${topicOptions(timer.topicId)}</select></label>
                <label>DATE<input type="date" name="mdate" value="${dayKey(Date.now())}" max="${dayKey(Date.now())}"></label>
                <label>MINUTES<input type="number" name="mmin" min="1" max="720" step="1" required></label>
              </div>
              <button class="btn" type="submit">BOOK IT</button>
              <span class="note saved" hidden>Booked.</span>
            </form>
          </details>
        </section>
      </div>
    </div>`;

  const camEl = $('.cam', root);
  camEl.prepend(video);
  video.play().catch(() => {});


  root.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => switchTo(b.dataset.phase)));
  $('[data-act="toggle"]', root).addEventListener('click', toggle);
  $('[data-act="skip"]', root).addEventListener('click', skip);
  $('[data-act="restart"]', root).addEventListener('click', restart);
  $('[data-act="popout"]', root).addEventListener('click', openMini);
  $('[data-act="camera"]', root).addEventListener('click', () => (presence.state === 'off' || presence.state === 'error' ? startCamera() : stopCamera()));

  const topicSel = $('[name="topic"]', root);
  const itemSel = $('[name="item"]', root);
  topicSel.addEventListener('change', () => {
    setTopic(topicSel.value, '');
    itemSel.innerHTML = moduleOptions(topicSel.value);
    itemSel.disabled = !topicSel.value;
  });
  itemSel.disabled = !timer.topicId;

  // Analyst pick: the most underweight topic, one click to study it.
  const showPick = () => {
    const st = stats();
    const ratings = analystRatings(st.topics);
    const pick = topPick(st.topics, ratings);
    const row = $('.pick-row', root);
    if (!pick || pick.topic.id === timer.topicId || timer.phase !== 'study') { row.innerHTML = ''; return; }
    row.innerHTML = `<span class="muted">ANALYST PICK</span> <b class="tk">${esc(pick.ticker)}</b> <span class="rating buy">▲ BUY</span> <span class="muted">underweight vs the exam</span> <button type="button" class="btn small" data-act="use-pick">STUDY ${esc(pick.ticker)}</button>`;
    $('[data-act="use-pick"]', row).addEventListener('click', () => {
      topicSel.value = pick.topic.id;
      topicSel.dispatchEvent(new Event('change'));
    });
  };
  showPick();
  topicSel.addEventListener('change', showPick);
  itemSel.addEventListener('change', () => setTopic(topicSel.value, itemSel.value));

  $('[name="presence"]', root).addEventListener('change', (e) => {
    store.doc.settings.presence = e.target.checked;
    store.doc.settings.u = Date.now();
    save();
    if (e.target.checked && timer.running && timer.phase === 'study') startCamera();
    update();
  });
  $('[name="ambient"]', root).addEventListener('change', (e) => { setMode(e.target.value); preview(); });
  $('[name="ambVol"]', root).addEventListener('input', (e) => setVolume(e.target.value));
  $('[data-act="preview"]', root).addEventListener('click', preview);
  $('[name="phoneCheck"]', root).addEventListener('change', (e) => {
    store.doc.settings.phoneCheck = e.target.checked;
    store.doc.settings.u = Date.now();
    save();
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
    store.doc.sessions.push({ id: uid(), topicId: f.mtopic.value, itemId: '', level: currentLevel(), start: startTs, end: startTs + min * 60000, sec: min * 60, verified: false, manual: true, u: now });
    save({ immediate: true });
    f.mmin.value = '';
    $('.saved', f).hidden = false;
    setTimeout(() => { $('.saved', f).hidden = true; }, 2500);
    update();
  });

  const onKey = (e) => {
    if (e.target.closest('input, select, textarea, button, summary') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 's') skip();
    else if (e.key === 'r') restart();
    else if (e.key === 'p') openMini();
  };
  document.addEventListener('keydown', onKey);

  function update() {
    const settings = store.doc.settings;
    const panel = $('.timer-panel', root);
    panel.dataset.phase = timer.phase;
    root.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.phase === timer.phase)));

    const total = phaseLengthSec();
    const left = remainingSec();
    $('.time', root).textContent = clock(left);
    $('.bar-fill', root).style.width = `${Math.min(100, ((total - left) / total) * 100)}%`;

    let state, cls;
    if (!timer.running) {
      cls = 'idle';
      state = timer.elapsedMs ? '■ HALTED · PAUSED' : timer.phase === 'study' ? '○ PRE-MARKET · PRESS SPACE TO OPEN' : '◆ BREAK READY';
    } else if (timer.phase !== 'study') { state = '◆ MARKET CLOSED · BREAK'; cls = 'break'; }
    else if (timer.counting) { state = '● MARKET OPEN'; cls = 'on'; }
    else if (timer.halt === 'phone') { state = '■ HALTED · PHONE IN HAND · PUT IT DOWN'; cls = 'away'; }
    else if (settings.presence && presence.state !== 'ready') { state = presence.state === 'loading' ? '… CONNECTING DESK CAM' : '■ HALTED · DESK CAM OFFLINE'; cls = 'away'; }
    else { state = '■ TRADING HALTED · TRADER AWAY FROM DESK'; cls = 'away'; }
    const statusEl = $('.status', root);
    statusEl.textContent = state;
    statusEl.className = `status ${cls}`;
    panel.dataset.state = cls;

    $('[data-act="toggle"]', root).textContent = timer.running ? '■ HALT' : timer.elapsedMs ? '▶ RESUME' : timer.phase === 'study' ? '▶ OPEN MARKET' : '▶ START BREAK';
    $('.today', root).textContent = duration(todaySec());
    $('.blocks', root).textContent = String(timer.completed);
    $('.away-time', root).textContent = clock(timer.awayMs / 1000);
    $('.walkouts', root).textContent = String(timer.walkouts);
    $('.pickups', root).textContent = String(timer.pickups);

    // Desk cam
    const hide = hidePreview();
    const present = isPresent(settings.graceSec);
    const phoneOn = settings.phoneCheck !== false && presence.state === 'ready' && presence.phone;
    const camState = presence.state !== 'ready' ? presence.state : phoneOn ? 'phone' : presence.seen ? 'seen' : present ? 'grace' : 'away';
    camEl.dataset.state = camState;
    camEl.classList.toggle('hidden-preview', hide);
    const onair = $('.onair', root);
    onair.dataset.state = camState;
    $('.onair-text', root).textContent = {
      off: 'DESK CAM OFF',
      loading: 'LOADING MODELS…',
      error: `ERROR · ${presence.error}`,
      seen: 'AT DESK',
      grace: 'LOOKING FOR YOU…',
      away: 'AWAY FROM DESK',
      phone: 'PHONE IN HAND',
    }[camState];
    $('.cam-placeholder', root).textContent = presence.state === 'ready' && hide ? 'VIDEO HIDDEN · STILL WATCHING' : presence.state === 'off' ? 'NO SIGNAL' : '';
    $('[data-act="camera"]', root).textContent = presence.state === 'off' || presence.state === 'error' ? 'CAM ON' : 'CAM OFF';

    const readout = $('.readout', root);
    readout.hidden = presence.state !== 'ready';
    if (presence.state === 'ready') {
      const sc = presence.scores;
      const val = (v) => (v ? v.toFixed(2) : '—');
      readout.innerHTML = `${settings.phoneCheck !== false ? `PHONE <b class="${sc.phone >= 0.4 ? 'down' : ''}">${val(sc.phone)}</b> · ` : ''}FACE <b class="${sc.face >= 0.6 ? 'up' : ''}">${val(sc.face)}</b> · BODY <b class="${sc.person >= 0.5 ? 'up' : ''}">${val(sc.person)}</b> · POSE <b class="${sc.pose ? 'up' : ''}">${sc.pose ? 'MATCH' : '—'}</b> · VIA <b>${presence.reason ? presence.reason.toUpperCase() : '—'}</b>`;
    }

    const box = $('.cam-box', root);
    if (presence.state === 'ready' && presence.box && !hide) {
      const b = presence.box;
      Object.assign(box.style, { left: `${(1 - b.x - b.w) * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
      box.hidden = false;
    } else {
      box.hidden = true;
    }
    const pbox = $('.phone-box', root);
    if (phoneOn && presence.phoneBox && !hide) {
      const b = presence.phoneBox;
      Object.assign(pbox.style, { left: `${(1 - b.x - b.w) * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
      pbox.hidden = false;
    } else {
      pbox.hidden = true;
    }
  }

  update();
  let lastPhase = timer.phase;
  const offs = [onTimer(update), onPresence(update), subscribe(showPick), onTimer(() => { if (timer.phase !== lastPhase) { lastPhase = timer.phase; showPick(); } })];
  return () => {
    offs.forEach((off) => off());
    document.removeEventListener('keydown', onKey);
    $('#cam-holder').append(video);
  };
}
