// Study plan ("order book"): queue up today's blocks by topic/module. Each new
// study block picks up the next one; finishing it moves the queue on.
// Stored per level in settings, so it syncs across devices.
import { store, save } from './store.js';
import { timer, onBlockStart, onBlockEnd, setTopic } from './timer.js';
import { currentLevel, levelTopics, tickerOf } from './model.js';
import { esc, uid } from './util.js';

export function plan(level = currentLevel()) {
  return (store.doc.settings.plans || {})[level] || [];
}

function setPlan(list, level = currentLevel()) {
  const s = store.doc.settings;
  s.plans = { ...(s.plans || {}), [level]: list };
  s.u = Date.now();
  save();
}

export function addToPlan(topicId, itemId = '', count = 1) {
  setPlan([...plan(), ...Array.from({ length: count }, () => ({ id: uid(), topicId, itemId }))]);
}

export function removeFromPlan(id) { setPlan(plan().filter((p) => p.id !== id)); }
export function clearPlan() { setPlan([]); }

export function movePlan(id, dir) {
  const list = plan().slice();
  const i = list.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  setPlan(list);
}

export function label(entry) {
  const t = store.doc.topics.find((x) => x.id === entry.topicId);
  const item = t?.items.find((i) => i.id === entry.itemId);
  return { ticker: t ? tickerOf(t) : 'GEN', name: item?.name || t?.name || 'General study' };
}

// New block: load the plan's next entry.
onBlockStart(() => {
  const next = plan()[0];
  if (next) setTopic(next.topicId, next.itemId);
});

// Block done: if it was the plan's next entry, tick it off.
onBlockEnd((block) => {
  const [head, ...rest] = plan();
  if (head && head.topicId === (block.topicId || '') && (!head.itemId || head.itemId === block.itemId)) setPlan(rest);
});

export function planPanel() {
  const list = plan();
  const rows = list.map((p, i) => {
    const l = label(p);
    return `<li data-id="${esc(p.id)}" class="${i === 0 ? 'next' : ''}">
      <span class="pl-n">${i === 0 ? 'NEXT' : `#${i + 1}`}</span>
      <span class="tk">${esc(l.ticker)}</span>
      <span class="pl-name">${esc(l.name)}</span>
      <span class="pl-act">
        <button type="button" class="icon" data-plan="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon" data-plan="down" title="Move down" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon" data-plan="remove" title="Remove">✕</button>
      </span>
    </li>`;
  }).join('');
  const topics = levelTopics();
  return `
    <div class="phead"><span>STUDY PLAN · ORDER BOOK</span><span class="muted">${list.length ? `${list.length} BLOCK${list.length === 1 ? '' : 'S'} QUEUED` : 'EMPTY'}</span></div>
    ${list.length ? `<ol class="plan">${rows}</ol>` : '<p class="note">Queue up today\'s blocks. Each new study block loads the next one automatically.</p>'}
    <div class="plan-add">
      <select name="planTopic"><option value="">GEN · General study</option>${topics.map((t) => `<option value="${esc(t.id)}">${esc(tickerOf(t))} · ${esc(t.name)}</option>`).join('')}</select>
      <select name="planItem"><option value="">Whole topic</option></select>
      <select name="planCount" title="How many blocks">${[1, 2, 3, 4].map((n) => `<option value="${n}">×${n}</option>`).join('')}</select>
      <button type="button" class="btn small" data-plan="add">+ QUEUE</button>
      ${list.length ? '<button type="button" class="btn small" data-plan="clear">CLEAR</button>' : ''}
    </div>`;
}

// Fills the module menu for the chosen topic (call after each render).
export function bindPlanSelects(el) {
  const topicSel = el.querySelector('[name="planTopic"]');
  const itemSel = el.querySelector('[name="planItem"]');
  const fillItems = () => {
    const t = store.doc.topics.find((x) => x.id === topicSel.value);
    itemSel.innerHTML = '<option value="">Whole topic</option>' + (t ? t.items.filter((i) => !i.deleted).map((i) => `<option value="${esc(i.id)}">${i.done ? '✓ ' : ''}${esc(i.name)}</option>`).join('') : '');
    itemSel.disabled = !t;
  };
  topicSel.addEventListener('change', fillItems);
  fillItems();
}

// Handles the panel's buttons. Call once per container; `redraw` re-renders it.
export function wirePlan(el, redraw) {
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-plan]');
    if (!btn) return;
    const id = btn.closest('li')?.dataset.id;
    const act = btn.dataset.plan;
    if (act === 'add') {
      addToPlan(el.querySelector('[name="planTopic"]').value, el.querySelector('[name="planItem"]').value, Number(el.querySelector('[name="planCount"]').value));
    } else if (act === 'clear') clearPlan();
    else if (act === 'remove') removeFromPlan(id);
    else if (act === 'up') movePlan(id, -1);
    else if (act === 'down') movePlan(id, 1);
    // About to start a new block? Load the new head straight away.
    if (!timer.running && !timer.elapsedMs && timer.phase === 'study' && plan()[0]) setTopic(plan()[0].topicId, plan()[0].itemId);
    redraw();
  });
}
