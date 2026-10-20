// Mini-terminal: a small window with the countdown, desk-cam light and
// controls. Uses Document Picture-in-Picture (Chrome/Edge) so it floats above
// other windows; elsewhere it falls back to a small popup window.
import { timer, onTimer, toggle, skip, phaseLengthSec, remainingSec } from './timer.js';
import { presence, onPresence, isPresent } from './presence.js';
import { store } from './store.js';
import { tickerOf } from './model.js';
import { clock } from './util.js';

export const miniMode = 'documentPictureInPicture' in window ? 'pip' : 'popup';
let win = null;

const LABEL = { study: 'STUDY', short: 'BREAK', long: 'LONG BREAK' };

function copyStyles(doc) {
  for (const sheet of document.styleSheets) {
    try {
      const style = doc.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      doc.head.append(style);
    } catch {
      // Cross-origin sheet (web font): link it instead.
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      doc.head.append(link);
    }
  }
}

// Renders the mini-terminal into any document; returns a cleanup function.
export function mountMini(doc) {
  doc.title = '301 MINI';
  copyStyles(doc);
  doc.body.className = 'mini-body';
  doc.body.innerHTML = `
    <div class="mini" data-state="idle">
      <div class="mini-top">
        <span class="mini-phase"></span>
        <span class="mini-tk"></span>
        <span class="mini-cam"><span class="lamp"></span><span class="mini-cam-text"></span></span>
      </div>
      <div class="mini-time"></div>
      <div class="bar-track"><div class="bar-fill"></div></div>
      <div class="mini-status"></div>
      <div class="mini-ctl">
        <button type="button" class="btn primary" data-act="toggle"></button>
        <button type="button" class="btn" data-act="skip">SKIP ▸</button>
      </div>
    </div>`;
  const $ = (sel) => doc.querySelector(sel);
  $('[data-act="toggle"]').addEventListener('click', toggle);
  $('[data-act="skip"]').addEventListener('click', skip);
  doc.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
  });

  const update = () => {
    const s = store.doc.settings;
    const total = phaseLengthSec();
    const left = remainingSec();
    let state;
    if (!timer.running) state = 'idle';
    else if (timer.phase !== 'study') state = 'break';
    else state = timer.counting ? 'on' : timer.halt === 'phone' ? 'phone' : 'away';
    $('.mini').dataset.state = state === 'phone' ? 'away' : state;
    $('.mini-phase').textContent = LABEL[timer.phase];
    const topic = store.doc.topics.find((t) => t.id === timer.topicId);
    $('.mini-tk').textContent = timer.phase === 'study' ? (topic ? tickerOf(topic) : 'GEN') : '';
    $('.mini-time').textContent = clock(left);
    $('.bar-fill').style.width = `${Math.min(100, ((total - left) / total) * 100)}%`;
    $('.mini-status').textContent = {
      idle: timer.elapsedMs ? '■ HALTED · PAUSED' : '○ PRE-MARKET',
      break: '◆ MARKET CLOSED · BREAK',
      on: '● MARKET OPEN',
      away: '■ HALTED · AWAY FROM DESK',
      phone: '■ HALTED · PHONE IN HAND',
    }[state];
    $('[data-act="toggle"]').textContent = timer.running ? '■ HALT' : '▶ OPEN';
    const cam = !s.presence ? 'off' : presence.state !== 'ready' ? 'off' : presence.seen ? 'seen' : isPresent(s.graceSec) ? 'grace' : 'away';
    $('.mini-cam').dataset.state = cam;
    $('.mini-cam-text').textContent = { off: s.presence ? 'CAM OFF' : 'NO CAM', seen: 'AT DESK', grace: 'LOOKING…', away: 'AWAY' }[cam];
  };
  update();
  const offs = [onTimer(update), onPresence(update)];
  return () => offs.forEach((off) => off());
}

export async function openMini() {
  if (win && !win.closed) { win.focus(); return; }
  try {
    win = miniMode === 'pip'
      ? await window.documentPictureInPicture.requestWindow({ width: 340, height: 230 })
      : window.open('', '301mini', 'popup,width=340,height=260');
  } catch {
    win = window.open('', '301mini', 'popup,width=340,height=260');
  }
  if (!win) return;
  const cleanup = mountMini(win.document);
  win.addEventListener('pagehide', () => { cleanup(); win = null; });
}
