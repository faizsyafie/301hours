import { store, save } from './store.js';
import { setTopic } from './timer.js';
import { topicStats } from './dashboard.js';
import { $, esc, uid, hours, shortDate } from './util.js';

const OPEN_KEY = '301hours:openTopics';

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
    const stats = topicStats();
    const done = stats.reduce((a, s) => a + s.done, 0);
    const total = stats.reduce((a, s) => a + s.total, 0);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Topics</h1>
          <p class="muted">${done} of ${total} modules done. Tick a module when you've finished it; it stays ticked on every device.</p>
        </div>
        <div class="row">
          <button type="button" class="btn ghost" data-act="expand">Expand all</button>
          <button type="button" class="btn ghost" data-act="collapse">Collapse all</button>
        </div>
      </div>
      <div class="topics">
        ${stats.map(({ topic, sec, done: d, total: n }) => `
          <details class="topic card" data-id="${esc(topic.id)}" ${open.has(topic.id) ? 'open' : ''}>
            <summary>
              <div class="topic-title">
                <span class="name">${esc(topic.name)}</span>
                ${topic.weight ? `<span class="weight">${esc(topic.weight)}</span>` : ''}
              </div>
              <div class="topic-meta">
                <span class="num">${hours(sec)}h</span>
                <div class="meter"><div style="width:${n ? (d / n) * 100 : 0}%"></div></div>
                <span class="num">${d}/${n}</span>
              </div>
            </summary>
            <ul class="modules">
              ${topic.items.filter((i) => !i.deleted).map((i) => `
                <li data-item="${esc(i.id)}" class="${i.done ? 'done' : ''}">
                  <label class="check"><input type="checkbox" ${i.done ? 'checked' : ''}><span>${esc(i.name)}</span></label>
                  <span class="muted small">${i.done && i.doneAt ? shortDate(i.doneAt) : ''}</span>
                  <span class="actions">
                    <button type="button" class="icon" data-act="study-item" title="Study this module">▶</button>
                    <button type="button" class="icon" data-act="rename-item" title="Rename">✎</button>
                    <button type="button" class="icon" data-act="delete-item" title="Delete">✕</button>
                  </span>
                </li>`).join('')}
            </ul>
            <form class="add-item row">
              <input name="name" placeholder="Add a module, reading or practice set…" required>
              <button class="btn" type="submit">Add</button>
            </form>
            <div class="topic-actions row">
              <button type="button" class="btn ghost small" data-act="study-topic">Study this topic</button>
              <button type="button" class="btn ghost small" data-act="rename-topic">Rename</button>
              <button type="button" class="btn ghost small" data-act="weight-topic">Edit weight</button>
              <button type="button" class="btn ghost small danger" data-act="delete-topic">Delete topic</button>
            </div>
          </details>`).join('')}
      </div>
      <form class="add-topic card row">
        <input name="name" placeholder="New topic (e.g. Mock exams)" required>
        <button class="btn" type="submit">Add topic</button>
      </form>`;
  }

  draw();

  root.addEventListener('toggle', (e) => {
    const det = e.target.closest?.('details.topic');
    if (!det) return;
    if (det.open) open.add(det.dataset.id); else open.delete(det.dataset.id);
    rememberOpen(open);
  }, true);

  root.addEventListener('change', (e) => {
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
      store.doc.topics.push({ id, name, weight: '', o, u: Date.now(), items: [] });
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

  root.addEventListener('click', (e) => {
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
    if (act === 'rename-item' || act === 'rename-topic') {
      const target = item || topic;
      const name = prompt('New name', target.name)?.trim();
      if (!name) return;
      target.name = name;
      touch(target);
    } else if (act === 'weight-topic') {
      const w = prompt('Exam weight (e.g. 10–15%)', topic.weight || '');
      if (w === null) return;
      topic.weight = w.trim();
      touch(topic);
    } else if (act === 'delete-item') {
      if (!confirm(`Delete "${item.name}"?`)) return;
      item.deleted = true;
      touch(item);
    } else if (act === 'delete-topic') {
      if (!confirm(`Delete the topic "${topic.name}" and its modules? Study time already logged is kept.`)) return;
      topic.deleted = true;
      touch(topic);
    } else {
      return;
    }
    save();
    draw();
  });
}
