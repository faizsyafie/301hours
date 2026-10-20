// End-of-block wrap-up: a quick screen after each study block. Every question
// can be switched off in Setup (or the whole screen). Nothing is compulsory:
// SKIP closes it, and the module stays "in progress" unless you say otherwise.
import { store, save } from './store.js';
import { onDoneChange } from './reviews.js';
import { tickerOf } from './model.js';
import { esc, uid, duration } from './util.js';

const FOCUS = ['', 'DISTRACTED', 'PATCHY', 'OK', 'FOCUSED', 'LOCKED IN'];

function findTopic(id) {
  return store.doc.topics.find((t) => t.id === id);
}

// Resolves when the wrap-up closes (immediately if it's switched off).
export function showWrapUp(block) {
  const st = store.doc.settings;
  if (st.wrapUp === false || document.querySelector('dialog.wrapup')) return Promise.resolve();
  const ask = { focus: st.wrapFocus !== false, notes: st.wrapNotes !== false, module: st.wrapModule !== false, questions: st.wrapQuestions !== false };
  if (!Object.values(ask).some(Boolean)) return Promise.resolve();

  const topic = findTopic(block.topicId);
  const items = topic ? topic.items.filter((i) => !i.deleted) : [];
  const ticker = topic ? tickerOf(topic) : 'GEN';
  const dlg = document.createElement('dialog');
  dlg.className = 'tdialog wide wrapup';
  dlg.innerHTML = `
    <form method="dialog">
      <div class="phead"><span>◆ BLOCK ${block.number} BANKED · ${esc(ticker)} · ${duration(block.sec)}</span><span class="muted">ALL OPTIONAL · ESC TO SKIP</span></div>
      ${ask.focus ? `
        <div class="wu-q"><span class="k">HOW FOCUSED WERE YOU?</span>
          <div class="wu-focus">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="btn small" data-focus="${n}" title="${FOCUS[n]}">${n}</button>`).join('')}<span class="muted small wu-focus-label"></span></div>
          ${block.pickups || block.walkouts ? `<div class="muted small">This sitting: ${block.walkouts} walkout${block.walkouts === 1 ? '' : 's'}, ${block.pickups} phone pickup${block.pickups === 1 ? '' : 's'}.</div>` : ''}
        </div>` : ''}
      ${ask.notes ? `
        <label class="wu-q"><span class="k">WHAT DID YOU COVER?</span>
          <input name="note" maxlength="200" placeholder="e.g. Duration & convexity. Key rate duration still fuzzy." autocomplete="off">
        </label>` : ''}
      ${ask.module && topic && items.length ? `
        <div class="wu-q"><span class="k">MODULE</span>
          <div class="row">
            <select name="itemId"><option value="">— not tied to one module —</option>${items.map((i) => `<option value="${esc(i.id)}" ${i.id === block.itemId ? 'selected' : ''}>${i.done ? '✓ ' : ''}${esc(i.name)}</option>`).join('')}</select>
            <label class="check"><input type="radio" name="status" value="progress" checked> Still working on it</label>
            <label class="check"><input type="radio" name="status" value="done"> Finished: mark done</label>
          </div>
        </div>` : ''}
      ${ask.questions ? `
        <div class="wu-q"><span class="k">PRACTICE QUESTIONS IN THIS BLOCK</span>
          <div class="row"><input name="correct" type="number" min="0" inputmode="numeric" placeholder="correct"> <span class="muted">/</span> <input name="total" type="number" min="1" inputmode="numeric" placeholder="out of"> <span class="muted small">logged to 4 EARNINGS · leave blank if none</span></div>
        </div>` : ''}
      <p class="error small" hidden></p>
      <div class="row end">
        <button value="cancel" class="btn">SKIP</button>
        <button value="ok" class="btn primary">SAVE</button>
      </div>
    </form>`;
  document.body.append(dlg);

  let focus = 0;
  dlg.querySelectorAll('[data-focus]').forEach((b) => b.addEventListener('click', () => {
    focus = focus === Number(b.dataset.focus) ? 0 : Number(b.dataset.focus);
    dlg.querySelectorAll('[data-focus]').forEach((x) => x.classList.toggle('primary', Number(x.dataset.focus) <= focus));
    dlg.querySelector('.wu-focus-label').textContent = FOCUS[focus];
  }));
  const err = dlg.querySelector('.error');
  dlg.querySelector('form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'ok') return;
    const f = e.target;
    const c = f.correct?.value, t = f.total?.value;
    if ((c || t) && !(Number(t) > 0 && Number(c) >= 0 && Number(c) <= Number(t))) {
      e.preventDefault();
      err.textContent = 'Questions: enter correct and out of, with correct no more than the total.';
      err.hidden = false;
    }
  });
  // Enter saves (the first button is SKIP).
  dlg.querySelector('form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); dlg.querySelector('button[value="ok"]').click(); }
  });
  dlg.showModal();
  (dlg.querySelector('[data-focus]') || dlg.querySelector('input, select'))?.focus();

  let done;
  const closed = new Promise((r) => { done = r; });
  dlg.addEventListener('close', () => {
    setTimeout(done, 0);
    const f = dlg.querySelector('form');
    if (dlg.returnValue === 'ok') apply(block, {
      focus,
      note: f.note?.value.trim() || '',
      itemId: f.itemId ? f.itemId.value : null,
      done: f.status?.value === 'done',
      correct: f.correct?.value ? Number(f.correct.value) : null,
      total: f.total?.value ? Number(f.total.value) : null,
    });
    dlg.remove();
  });
  return closed;
}

function apply(block, a) {
  const now = Date.now();
  const s = store.doc.sessions.find((x) => x.id === block.sessionId);
  if (s) {
    if (a.focus) s.focus = a.focus;
    if (a.note) s.note = a.note;
    if (a.itemId !== null) s.itemId = a.itemId;
    s.u = now;
  }
  const topic = findTopic(block.topicId);
  if (a.done && topic && a.itemId) {
    const item = topic.items.find((i) => i.id === a.itemId);
    if (item && !item.done) {
      Object.assign(item, { done: true, doneAt: now, u: now });
      onDoneChange(item);
    }
  }
  if (a.total) {
    store.doc.scores ||= [];
    store.doc.scores.push({ id: uid(), level: s?.level || store.doc.settings.level || 1, kind: 'qbank', topicId: block.topicId || '', date: now, correct: a.correct, total: a.total, note: 'From block wrap-up', u: now });
  }
  save({ immediate: true });
}

