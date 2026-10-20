// Study plan ("order book"): queue up today's blocks by topic/module. Each new
// study block picks up the next one; finishing it moves the queue on.
// Stored per level in settings, so it syncs across devices.
import { store, save } from './store.js';
import { timer, onBlockStart, onBlockEnd, setTopic } from './timer.js';
import { currentLevel, levelTopics, tickerOf } from './model.js';
import { esc, uid } from './util.js';
import { confirmBox } from './dialog.js';

const confirmReplace = () => confirmBox('REPLACE YOUR PLAN?', 'Auto-plan will replace the blocks already queued.', { okLabel: 'REPLACE' });

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
      <span class="pl-name">${esc(l.name)}${p.why ? `<span class="pl-why">${esc(p.why)}</span>` : ''}</span>
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
    <div class="row plan-auto"><button type="button" class="btn small primary" data-plan="auto" title="Build today's plan from reviews due, underweight topics and low accuracy">⚡ AUTO-PLAN TODAY</button><span class="muted small">reviews due · underweight topics · weak accuracy</span></div>
    ${list.length ? `<ol class="plan">${rows}</ol>` : '<p class="note">Queue up today\'s blocks, or let AUTO-PLAN pick them. Each new study block loads the next one automatically.</p>'}
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
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-plan]');
    if (!btn) return;
    const id = btn.closest('li')?.dataset.id;
    const act = btn.dataset.plan;
    if (act === 'auto') {
      const replace = !plan().length || await confirmReplace();
      if (!replace) return;
      setPlan(await buildAutoPlan());
    } else if (act === 'add') {
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

// ---------- Auto-plan ----------
// Builds today's plan from what needs attention most: reviews due first, then
// topics that are underweight against the exam or below your score target.
// Each entry carries a short reason.
export async function buildAutoPlan() {
  const [{ schedule }, { analystRatings }, { stats, levelScores, accuracy }, { todayTarget }] = await Promise.all([
    import('./reviews.js'), import('./ratings.js'), import('./model.js'), import('./focus.js'),
  ]);
  const st = stats();
  const ratings = analystRatings(st.topics);
  const target = store.doc.settings.scoreTarget || 70;
  const reports = levelScores();
  const blocks = Math.max(2, Math.min(8, todayTarget().blocks || 4));
  const out = [];

  // 1. Reviews: one block on the topic with the most due.
  const { due } = schedule();
  const dueBy = new Map();
  for (const r of due) dueBy.set(r.topic.id, [...(dueBy.get(r.topic.id) || []), r]);
  const reviewTopic = [...dueBy.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (reviewTopic) {
    const [topicId, rows] = reviewTopic;
    out.push({ id: uid(), topicId, itemId: rows[0].item.id, why: `${rows.length} review${rows.length === 1 ? '' : 's'} due` });
  }

  // 2. Score each topic: underweight gap + accuracy shortfall (+ a little for unfinished modules).
  const scored = st.topics.map((t) => {
    const r = ratings.get(t.topic.id);
    const acc = accuracy(reports.filter((x) => x.topicId === t.topic.id));
    const under = r.target ? Math.max(0, r.target - r.share) / r.target : 0;
    const weak = acc.pct !== null && acc.pct < target ? (target - acc.pct) / target : 0;
    const left = t.total ? (t.total - t.done) / t.total : 0;
    const why = [];
    if (r.key === 'BUY') why.push('underweight vs exam');
    if (weak) why.push(`accuracy ${acc.pct.toFixed(0)}% < ${target}%`);
    if (!why.length && left) why.push(`${t.total - t.done} module${t.total - t.done === 1 ? '' : 's'} to go`);
    // With no hours yet, lean on exam weight so the plan still makes sense.
    const weight = r.target || 0;
    return { t, score: under * 2 + weak * 3 + left * 0.5 + (st.total ? 0 : weight * 3), why: why.join(' · ') || 'keep it moving' };
  }).filter((x) => x.t.total > x.t.done || x.why !== 'keep it moving').sort((a, b) => b.score - a.score);

  // 3. Fill the remaining blocks, at most two per topic, on the next unfinished module.
  const used = new Map();
  for (let pass = 0; pass < 2 && out.length < blocks; pass++) {
    for (const x of scored) {
      if (out.length >= blocks) break;
      if ((used.get(x.t.topic.id) || 0) > pass) continue;
      const next = x.t.topic.items.find((i) => !i.deleted && !i.done);
      out.push({ id: uid(), topicId: x.t.topic.id, itemId: next?.id || '', why: x.why });
      used.set(x.t.topic.id, (used.get(x.t.topic.id) || 0) + 1);
    }
  }
  return out;
}

export function setPlanEntries(list) { setPlan(list); }
