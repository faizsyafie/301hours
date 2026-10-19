import { store, save, subscribe } from './store.js';
import { setTopic } from './timer.js';
import { stats, currentLevel, tickerOf } from './model.js';
import { PATHWAYS } from './curriculum.js';
import { analystRatings } from './ratings.js';
import { esc, uid, hours, shortDate } from './util.js';
import { ask, confirmBox } from './dialog.js';

const OPEN_KEY = '301hours:openTopics';
const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };

function openSet() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || []); } catch { return new Set(); }
}

function rememberOpen(set) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

function findTopic(id) {
  return store.doc.topics.find((t) => t.id === id);
}

function touch(obj) {
  obj.u = Date.now();
}

export function renderTopics(root, params) {
  const open = openSet();
  if (params.get('open')) { open.add(params.get('open')); rememberOpen(open); }

  function draw() {
    const st = stats();
    const level = currentLevel();
    const done = st.topics.reduce((a, t) => a + t.done, 0);
    const total = st.topics.reduce((a, t) => a + t.total, 0);
    const pathway = store.doc.settings.pathway;
    const ratings = analystRatings(st.topics);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>POSITIONS · LEVEL ${ROMAN[level]}</h1>
          <p class="note">${done}/${total} modules closed out. Tick a module when it's done; it stays ticked on every device.</p>
        </div>
        <div class="row">
          ${level === 3 ? `<label class="inline">PATHWAY <select name="pathway">${Object.entries(PATHWAYS).map(([k, v]) => `<option value="${k}" ${k === pathway ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
          <button type="button" class="btn" data-act="expand">EXPAND ALL</button>
          <button type="button" class="btn" data-act="collapse">COLLAPSE ALL</button>
        </div>
      </div>
      <div class="topics">
        ${st.topics.map(({ topic, ticker, sec, done: d, total: n }) => `
          <details class="topic panel" data-id="${esc(topic.id)}" ${open.has(topic.id) ? 'open' : ''}>
            <summary>
              <span class="tk">${esc(ticker)}</span>
              <span class="name">${esc(topic.name)}</span>
              <span class="muted wgt">${esc(topic.weight || '')} <span class="rating ${ratings.get(topic.id).cls}">${ratings.get(topic.id).icon} ${ratings.get(topic.id).short}</span></span>
              <span class="num hrs">${hours(sec, 2)}H</span>
              <span class="meter"><span style="width:${n ? (d / n) * 100 : 0}%"></span></span>
              <span class="num cnt">${d}/${n}</span>
            </summary>
            <ul class="modules">
              ${topic.items.filter((i) => !i.deleted).map((i, idx) => `
                <li data-item="${esc(i.id)}" class="${i.done ? 'done' : ''}">
                  <label class="check"><input type="checkbox" ${i.done ? 'checked' : ''}><span class="idx">${String(idx + 1).padStart(2, '0')}</span><span>${esc(i.name)}</span></label>
                  <span class="muted small">${i.done && i.doneAt ? `CLOSED ${shortDate(i.doneAt).toUpperCase()}` : ''}</span>
                  <span class="actions">
                    <button type="button" class="icon" data-act="study-item" title="Study this module">▶</button>
                    <button type="button" class="icon" data-act="rename-item" title="Rename">✎</button>
                    <button type="button" class="icon" data-act="delete-item" title="Delete">✕</button>
                  </span>
                </li>`).join('')}
            </ul>
            <form class="add-item row">
              <input name="name" placeholder="+ add a module, reading or practice set" required>
              <button class="btn" type="submit">ADD</button>
            </form>
            <div class="topic-actions row">
              <button type="button" class="btn small" data-act="study-topic">▶ STUDY THIS</button>
              <button type="button" class="btn small" data-act="rename-topic">RENAME</button>
              <button type="button" class="btn small" data-act="ticker-topic">TICKER</button>
              <button type="button" class="btn small" data-act="weight-topic">WEIGHT</button>
              <button type="button" class="btn small danger" data-act="delete-topic">DELIST</button>
            </div>
          </details>`).join('')}
      </div>
      <form class="add-topic panel row">
        <input name="name" placeholder="+ new topic, e.g. Mock exams" required>
        <button class="btn" type="submit">LIST IT</button>
      </form>`;
  }

  draw();
  // Redraw when synced data arrives, unless you're typing in one of the fields.
  let stamp = store.doc.updatedAt;
  const offSync = subscribe(() => {
    if (store.doc.updatedAt === stamp) return;
    stamp = store.doc.updatedAt;
    if (!root.contains(document.activeElement) || document.activeElement.tagName !== 'INPUT') draw();
  });

  root.addEventListener('toggle', (e) => {
    const det = e.target.closest?.('details.topic');
    if (!det) return;
    if (det.open) open.add(det.dataset.id); else open.delete(det.dataset.id);
    rememberOpen(open);
  }, true);

  root.addEventListener('change', (e) => {
    if (e.target.name === 'pathway') {
      store.doc.settings.pathway = e.target.value;
      touch(store.doc.settings);
      save();
      return draw();
    }
    if (e.target.type !== 'checkbox') return;
    const li = e.target.closest('li[data-item]');
    const topic = findTopic(e.target.closest('details').dataset.id);
    const item = topic.items.find((i) => i.id === li.dataset.item);
    item.done = e.target.checked;
    item.doneAt = item.done ? Date.now() : null;
    touch(item);
    save();
    draw();
  });

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    if (e.target.classList.contains('add-topic')) {
      const o = Math.max(0, ...store.doc.topics.map((t) => t.o ?? 0)) + 1;
      const id = uid();
      const level = currentLevel();
      store.doc.topics.push({ id, name, weight: '', level, pathway: '', o, u: Date.now(), items: [] });
      open.add(id);
      rememberOpen(open);
    } else {
      const topic = findTopic(e.target.closest('details').dataset.id);
      const o = Math.max(0, ...topic.items.map((i) => i.o ?? 0)) + 1;
      topic.items.push({ id: uid(), name, o, done: false, doneAt: null, u: Date.now() });
    }
    save();
    draw();
  });

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'expand' || act === 'collapse') {
      for (const t of store.doc.topics) act === 'expand' ? open.add(t.id) : open.delete(t.id);
      rememberOpen(open);
      return draw();
    }
    const det = btn.closest('details');
    const topic = det && findTopic(det.dataset.id);
    const li = btn.closest('li[data-item]');
    const item = li && topic.items.find((i) => i.id === li.dataset.item);

    if (act === 'study-item' || act === 'study-topic') {
      setTopic(topic.id, item ? item.id : '');
      location.hash = '#/study';
      return;
    }
    // Ask first, then look the topic/module up again: a sync may have replaced
    // the data while the dialog was open.
    const topicId = topic.id;
    const itemId = item?.id;
    const fresh = () => {
      const t = findTopic(topicId);
      return { t, i: itemId ? t?.items.find((x) => x.id === itemId) : null };
    };
    let apply;
    if (act === 'rename-item' || act === 'rename-topic') {
      const name = (await ask(item ? 'RENAME MODULE' : 'RENAME TOPIC', { value: (item || topic).name }))?.trim();
      if (!name) return;
      apply = ({ t, i }) => { (i || t).name = name; touch(i || t); };
    } else if (act === 'ticker-topic') {
      const tk = (await ask(`SET TICKER · ${topic.name.toUpperCase()}`, { value: tickerOf(topic), hint: 'Up to 5 letters or digits, e.g. FI or QM.', maxLength: 5 }))?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      if (!tk) return;
      apply = ({ t }) => { t.ticker = tk; touch(t); };
    } else if (act === 'weight-topic') {
      const w = await ask(`EXAM WEIGHT · ${topic.name.toUpperCase()}`, { value: topic.weight || '', hint: 'Shown next to the topic, e.g. 10–15%.', placeholder: '10–15%' });
      if (w === null) return;
      apply = ({ t }) => { t.weight = w.trim(); touch(t); };
    } else if (act === 'delete-item') {
      if (!(await confirmBox('DELETE MODULE', `Delete "${item.name}"? Hours already logged are kept.`, { okLabel: 'DELETE', danger: true }))) return;
      apply = ({ i }) => { i.deleted = true; touch(i); };
    } else if (act === 'delete-topic') {
      if (!(await confirmBox('DELIST TOPIC', `Delist "${topic.name}" and all its modules? Hours already logged are kept.`, { okLabel: 'DELIST', danger: true }))) return;
      apply = ({ t }) => { t.deleted = true; touch(t); };
    } else {
      return;
    }
    const target = fresh();
    if (!target.t || (itemId && !target.i)) return;
    apply(target);
    save();
    draw();
  });
  return offSync;
}
