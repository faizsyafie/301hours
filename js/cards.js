// Flashcards: your own question/answer cards per topic, reviewed during breaks
// with a simple Leitner box system. "GOT IT" moves a card up a box (seen less
// often: 1, 3, 7, 14 days); "AGAIN" sends it back to box 1.
import { store, save } from './store.js';
import { timer } from './timer.js';
import { currentLevel, levelTopics, tickerOf, DAY } from './model.js';
import { esc, uid, shortDate } from './util.js';

const INTERVAL_DAYS = [0, 0, 1, 3, 7, 14]; // by box 1..5

export function cardsFor(topicId, level = currentLevel()) {
  return (store.doc.cards || []).filter((c) => !c.deleted && (c.level || 1) === level && (topicId === undefined || c.topicId === topicId));
}

export function addCard(topicId, front, back) {
  store.doc.cards ||= [];
  const now = Date.now();
  store.doc.cards.push({ id: uid(), level: currentLevel(), topicId, front: front.trim(), back: back.trim(), box: 1, due: now, u: now });
}

// "front | back" (or tab-separated) per line. Returns how many were added.
export function addMany(topicId, text) {
  let n = 0;
  for (const line of text.split('\n')) {
    const [front, ...rest] = line.split(/\t|\s\|\s|\|/);
    const back = rest.join(' | ').trim();
    if (front?.trim() && back) { addCard(topicId, front, back); n++; }
  }
  return n;
}

export function grade(card, gotIt) {
  const now = Date.now();
  card.box = gotIt ? Math.min(5, (card.box || 1) + 1) : 1;
  card.due = now + INTERVAL_DAYS[card.box] * DAY;
  card.seen = (card.seen || 0) + 1;
  card.u = now;
  save();
}

// Next card to show: due cards for the given topic first, then any due card
// in this level, lowest box first; otherwise the least recently seen card.
export function pickCard(topicId, skip = new Set()) {
  const all = cardsFor(undefined).filter((c) => !skip.has(c.id));
  if (!all.length) return null;
  const now = Date.now();
  const due = (list) => list.filter((c) => (c.due || 0) <= now).sort((a, b) => (a.box || 1) - (b.box || 1) || (a.due || 0) - (b.due || 0));
  return due(all.filter((c) => c.topicId === topicId))[0] || due(all)[0] || all.slice().sort((a, b) => (a.u || 0) - (b.u || 0))[0];
}

export const dueCount = () => cardsFor(undefined).filter((c) => (c.due || 0) <= Date.now()).length;

// ---------- Review widget (break panel, focus mode, topic review) ----------
// Renders into `el` and keeps going until the cards run out.
export function mountReview(el, { topicId = () => timer.topicId, title = 'BREAK CARD', empty } = {}) {
  const seen = new Set();
  let card = null, revealed = false;
  const tick = (c) => {
    const t = store.doc.topics.find((x) => x.id === c.topicId);
    return t ? tickerOf(t) : 'GEN';
  };
  const draw = () => {
    if (!card) card = pickCard(typeof topicId === 'function' ? topicId() : topicId, seen);
    if (!card) {
      el.innerHTML = `<div class="phead"><span>${title}</span></div>${empty || '<p class="note">No flashcards yet. Add some on <a href="#/topics">3 TOPICS</a> (open a topic → FLASHCARDS).</p>'}`;
      return;
    }
    el.innerHTML = `
      <div class="phead"><span>${title} · <b class="tk">${esc(tick(card))}</b></span><span class="muted">BOX ${card.box || 1}/5 · ${dueCount()} DUE</span></div>
      <div class="fc ${revealed ? 'revealed' : ''}">
        <div class="fc-front">${esc(card.front)}</div>
        ${revealed ? `<div class="fc-back">${esc(card.back)}</div>` : ''}
      </div>
      <div class="row fc-actions">
        ${revealed
          ? '<button type="button" class="btn small danger" data-fc="again">✕ AGAIN</button><button type="button" class="btn small primary" data-fc="got">✓ GOT IT</button>'
          : '<button type="button" class="btn small primary" data-fc="reveal">REVEAL</button><button type="button" class="btn small" data-fc="skip">SKIP ▸</button>'}
      </div>`;
  };
  // Re-mounting on the same element replaces the previous handler (no double grading).
  if (el._fcClick) el.removeEventListener('click', el._fcClick);
  el._fcClick = (e) => {
    const act = e.target.closest('[data-fc]')?.dataset.fc;
    if (!act || !card) return;
    if (act === 'reveal') revealed = true;
    else {
      // Look the card up again: a sync may have replaced the objects since it was drawn.
      const live = (store.doc.cards || []).find((c) => c.id === card.id);
      if (live && (act === 'got' || act === 'again')) grade(live, act === 'got');
      seen.add(card.id);
      card = null;
      revealed = false;
    }
    draw();
  };
  el.addEventListener('click', el._fcClick);
  draw();
  return { redraw: () => { card = null; revealed = false; draw(); } };
}

// ---------- Card manager for one topic (Topics page) ----------
export function cardManagerHTML(topic) {
  const list = cardsFor(topic.id);
  return `
    <div class="fcm">
      <form class="fcm-add">
        <div class="fields">
          <label>FRONT (QUESTION)<textarea name="front" rows="2" required placeholder="e.g. Macaulay duration"></textarea></label>
          <label>BACK (ANSWER)<textarea name="back" rows="2" required placeholder="e.g. Weighted-average time to receive the bond's cash flows"></textarea></label>
        </div>
        <div class="row"><button class="btn small primary" type="submit">+ ADD CARD</button><button type="button" class="btn small" data-fcm="review" ${list.length ? '' : 'disabled'}>▶ REVIEW ${list.length}</button></div>
      </form>
      <details class="fcm-bulk"><summary class="muted small">PASTE MANY · one per line: front | back</summary>
        <textarea name="bulk" rows="5" placeholder="Duration | Sensitivity of price to yield changes&#10;Convexity | Curvature of the price-yield relationship"></textarea>
        <button type="button" class="btn small" data-fcm="bulk">ADD ALL</button>
      </details>
      <ul class="fcm-list">${list.map((c) => `
        <li data-card="${esc(c.id)}"><div><b>${esc(c.front)}</b><div class="muted small">${esc(c.back)}</div></div>
          <span class="muted small">BOX ${c.box || 1}${c.due > Date.now() ? ` · ${shortDate(c.due).toUpperCase()}` : ' · DUE'}</span>
          <button type="button" class="icon" data-fcm="edit" title="Edit">✎</button><button type="button" class="icon" data-fcm="delete" title="Delete">✕</button></li>`).join('') || '<li class="muted small">No cards yet.</li>'}</ul>
    </div>`;
}

export function deleteCard(id) {
  const c = (store.doc.cards || []).find((x) => x.id === id);
  if (c) { Object.assign(c, { deleted: true, u: Date.now() }); save(); }
}

export function editCard(id, front, back) {
  const c = (store.doc.cards || []).find((x) => x.id === id);
  if (c) { Object.assign(c, { front: front.trim(), back: back.trim(), u: Date.now() }); save(); }
}

export { levelTopics };

// Manager dialog for one topic's cards.
export function openCardManager(topic, ask) {
  const dlg = document.createElement('dialog');
  dlg.className = 'tdialog wide';
  const body = () => `
    <div class="phead"><span>FLASHCARDS · ${esc(tickerOf(topic))} · ${esc(topic.name.toUpperCase())}</span><span class="muted">ESC TO CLOSE</span></div>
    <div class="fcm-body">${cardManagerHTML(topic)}</div>
    <div class="row end"><button type="button" class="btn primary" data-fcm="close">CLOSE</button></div>`;
  const draw = () => { dlg.innerHTML = body(); };
  draw();
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.classList.contains('fcm-add')) return;
    addCard(topic.id, f.front.value, f.back.value);
    save();
    draw();
    dlg.querySelector('[name="front"]').focus();
  });
  dlg.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-fcm]')?.dataset.fcm;
    if (!act) return;
    const id = e.target.closest('[data-card]')?.dataset.card;
    if (act === 'close') return dlg.close();
    if (act === 'bulk') {
      const n = addMany(topic.id, dlg.querySelector('[name="bulk"]').value);
      save();
      draw();
      dlg.querySelector('.fcm-body').insertAdjacentHTML('afterbegin', `<p class="note up">${n} card${n === 1 ? '' : 's'} added.</p>`);
    } else if (act === 'delete') {
      deleteCard(id);
      draw();
    } else if (act === 'edit') {
      const c = store.doc.cards.find((x) => x.id === id);
      dlg.close();
      const front = await ask('EDIT CARD · FRONT', { value: c.front });
      if (front === null) return openCardManager(topic, ask);
      const back = await ask('EDIT CARD · BACK', { value: c.back });
      if (back !== null && front.trim() && back.trim()) editCard(id, front, back);
      openCardManager(topic, ask);
    } else if (act === 'review') {
      dlg.innerHTML = `<div class="fc-review"></div><div class="row end"><button type="button" class="btn" data-fcm="back">◂ BACK TO CARDS</button></div>`;
      mountReview(dlg.querySelector('.fc-review'), { topicId: topic.id, title: 'REVIEW', empty: '<p class="note">All done for now.</p>' });
    } else if (act === 'back') {
      draw();
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
}
