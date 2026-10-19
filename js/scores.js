// EARNINGS: practice question sets and mock exams, reported like company
// earnings. Each report BEATs or MISSes your target score.
import { store, save, subscribe } from './store.js';
import { levelTopics, levelScores, tickerOf, currentLevel, accuracy, pct, DAY } from './model.js';
import { confirmBox } from './dialog.js';
import { $, esc, uid, dayKey, shortDate } from './util.js';

const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
const KIND = { qbank: 'QBANK', mock: 'MOCK' };

const target = () => store.doc.settings.scoreTarget || 70;

function verdict(p) {
  const d = p - target();
  return d >= 0
    ? `<span class="rating buy">▲ BEAT ${d.toFixed(1)}</span>`
    : `<span class="rating miss">▼ MISS ${Math.abs(d).toFixed(1)}</span>`;
}

function topicOptions(selected) {
  return `<option value="">ALL · Mixed / all topics</option>` + levelTopics().map((t) => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(tickerOf(t))} · ${esc(t.name)}</option>`).join('');
}

function mockChart(mocks) {
  if (!mocks.length) return '<p class="note">No mock exams filed yet. File one with type MOCK to see your trend.</p>';
  const W = 560, H = 150, L = 34, R = 10, T = 10, B = 22;
  const iw = W - L - R, ih = H - T - B;
  const x = (i) => L + (mocks.length === 1 ? iw / 2 : (i / (mocks.length - 1)) * iw);
  const y = (v) => T + ih - (v / 100) * ih;
  let g = '';
  for (const v of [0, 25, 50, 75, 100]) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  g += `<line class="goal" x1="${L}" x2="${W - R}" y1="${y(target())}" y2="${y(target())}"/><text class="plabel" x="${W - R}" y="${y(target()) - 4}" text-anchor="end">TARGET ${target()}%</text>`;
  const pts = mocks.map((m, i) => `${x(i)},${y(pct(m))}`).join(' ');
  if (mocks.length > 1) g += `<polyline class="line" points="${pts}"/>`;
  mocks.forEach((m, i) => {
    const p = pct(m);
    g += `<circle class="mdot ${p >= target() ? 'beat' : 'miss'}" cx="${x(i)}" cy="${y(p)}" r="5"><title>${shortDate(m.date)} · ${p.toFixed(1)}%</title></circle>`;
    g += `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="middle">${shortDate(m.date).toUpperCase()}</text>`;
  });
  return `<div class="chart mock-chart"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Mock exam scores over time">${g}</svg></div>`;
}

export function renderScores(root) {
  let form = { kind: 'qbank', topicId: '', date: dayKey(Date.now()) };

  function draw() {
    const level = currentLevel();
    const reports = levelScores(level).slice().sort((a, b) => b.date - a.date || b.u - a.u);
    const topics = levelTopics(level);
    const acc30 = accuracy(reports, Date.now() - 30 * DAY);
    const accAll = accuracy(reports);
    const beats = reports.filter((r) => pct(r) >= target()).length;
    const mocks = reports.filter((r) => r.kind === 'mock').sort((a, b) => a.date - b.date);
    const lastMock = mocks[mocks.length - 1];

    const byTopic = topics.map((t) => ({ t, ...accuracy(reports.filter((r) => r.topicId === t.id)) }));
    const topicRows = byTopic.map(({ t, total, pct: p }) => `
      <tr>
        <td class="tk">${esc(tickerOf(t))}</td>
        <td class="nm">${esc(t.name)}</td>
        <td class="num">${total || '—'}</td>
        <td class="bar-cell"><div class="acc-track"><div class="acc-fill ${p === null ? '' : p >= target() ? 'beat' : 'miss'}" style="width:${p ?? 0}%"></div><div class="acc-target" style="left:${target()}%"></div></div></td>
        <td class="num">${p === null ? '—' : `${p.toFixed(1)}%`}</td>
        <td>${p === null ? '<span class="rating nr">· NO DATA</span>' : verdict(p)}</td>
      </tr>`).join('');

    const tickers = new Map(store.doc.topics.map((t) => [t.id, tickerOf(t)]));
    const reportRows = reports.length ? reports.map((r) => `
      <tr data-id="${esc(r.id)}">
        <td class="muted">${shortDate(r.date).toUpperCase()}</td>
        <td><span class="kind ${r.kind}">${KIND[r.kind] || 'QBANK'}</span></td>
        <td class="tk">${esc(r.topicId ? tickers.get(r.topicId) || '?' : 'ALL')}</td>
        <td class="num">${r.correct}/${r.total}</td>
        <td class="num">${pct(r).toFixed(1)}%</td>
        <td>${verdict(pct(r))}</td>
        <td class="note-cell muted">${esc(r.note || '')}</td>
        <td><button type="button" class="icon" data-act="delete" title="Delete report">✕</button></td>
      </tr>`).join('') : '<tr><td colspan="8" class="muted empty">NO REPORTS FILED. DO A QUESTION SET AND LOG IT ABOVE.</td></tr>';

    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>EARNINGS · LEVEL ${ROMAN[level]}</h1>
          <p class="note">Log question-bank sets and mock exams. Each one is reported against your ${target()}% target: BEAT or MISS.</p>
        </div>
      </div>

      <div class="row-2">
        <section class="panel">
          <div class="phead"><span>FILE A REPORT</span><span class="muted">TARGET ${target()}% · CHANGE IN SETUP</span></div>
          <form class="score-form">
            <div class="fields">
              <label>TYPE<select name="kind"><option value="qbank" ${form.kind === 'qbank' ? 'selected' : ''}>QBANK · question set</option><option value="mock" ${form.kind === 'mock' ? 'selected' : ''}>MOCK · mock exam</option></select></label>
              <label>TOPIC<select name="topicId">${topicOptions(form.topicId)}</select></label>
              <label>DATE<input type="date" name="date" value="${form.date}" max="${dayKey(Date.now())}" required></label>
              <label>CORRECT<input type="number" name="correct" min="0" step="1" required inputmode="numeric"></label>
              <label>OUT OF<input type="number" name="total" min="1" step="1" required inputmode="numeric"></label>
              <label>NOTE<input name="note" maxlength="80" placeholder="optional, e.g. Kaplan mock 1"></label>
            </div>
            <div class="row"><button class="btn primary" type="submit">FILE REPORT</button><span class="preview note"></span></div>
          </form>
        </section>

        <section class="panel">
          <div class="phead"><span>CONSENSUS</span><span class="muted">LEVEL ${ROMAN[level]}</span></div>
          <div class="kv-grid">
            <div><span class="k">ACCURACY 30D</span><span class="v ${acc30.pct === null ? '' : acc30.pct >= target() ? 'up' : 'down'}">${acc30.pct === null ? '—' : `${acc30.pct.toFixed(1)}%`}</span></div>
            <div><span class="k">ALL-TIME</span><span class="v">${accAll.pct === null ? '—' : `${accAll.pct.toFixed(1)}%`}</span></div>
            <div><span class="k">QUESTIONS</span><span class="v">${accAll.total.toLocaleString()}</span></div>
            <div><span class="k">BEAT / MISS</span><span class="v"><span class="up">${beats}</span> / <span class="down">${reports.length - beats}</span></span></div>
            <div><span class="k">LAST MOCK</span><span class="v ${lastMock ? (pct(lastMock) >= target() ? 'up' : 'down') : ''}">${lastMock ? `${pct(lastMock).toFixed(1)}%` : '—'}</span></div>
            <div><span class="k">MOCKS</span><span class="v">${mocks.length}</span></div>
          </div>
          <div class="phead" style="margin-top:14px"><span>MOCK EXAM TREND</span></div>
          ${mockChart(mocks)}
        </section>
      </div>

      <section class="panel">
        <div class="phead"><span>ACCURACY BY TOPIC</span><span class="muted">│ = ${target()}% TARGET</span></div>
        <div class="table-wrap"><table class="watch">
          <thead><tr><th>TKR</th><th>TOPIC</th><th class="num">QS</th><th>ACCURACY</th><th class="num">%</th><th>VS TARGET</th></tr></thead>
          <tbody>${topicRows}</tbody>
        </table></div>
      </section>

      <section class="panel">
        <div class="phead"><span>REPORTS</span><span class="muted">${reports.length} FILED</span></div>
        <div class="table-wrap"><table class="watch reports">
          <thead><tr><th>DATE</th><th>TYPE</th><th>TKR</th><th class="num">SCORE</th><th class="num">%</th><th>RESULT</th><th>NOTE</th><th></th></tr></thead>
          <tbody>${reportRows}</tbody>
        </table></div>
      </section>`;

    const f = $('.score-form', root);
    const preview = () => {
      const c = Number(f.correct.value), t = Number(f.total.value);
      $('.preview', f).innerHTML = t > 0 && c >= 0 && c <= t ? `${((c / t) * 100).toFixed(1)}% → ${verdict((c / t) * 100)}` : c > t && t ? '<span class="down">Correct can\'t exceed the total.</span>' : '';
    };
    f.addEventListener('input', preview);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const correct = Number(f.correct.value), total = Number(f.total.value);
      if (!(total > 0) || correct < 0 || correct > total) return preview();
      form = { kind: f.kind.value, topicId: f.topicId.value, date: f.date.value };
      const now = Date.now();
      store.doc.scores ||= [];
      store.doc.scores.push({
        id: uid(), level, kind: form.kind, topicId: form.topicId,
        date: new Date(form.date + 'T12:00').getTime(), correct, total, note: f.note.value.trim(), u: now,
      });
      save({ immediate: true });
      draw();
      $('.score-form [name="correct"]', root).focus();
    });
  }

  draw();
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="delete"]');
    if (!btn) return;
    const id = btn.closest('tr').dataset.id;
    if (!(await confirmBox('DELETE REPORT', 'Delete this report? This can\'t be undone.', { okLabel: 'DELETE', danger: true }))) return;
    const r = (store.doc.scores || []).find((x) => x.id === id);
    if (!r) return;
    Object.assign(r, { deleted: true, u: Date.now() });
    save({ immediate: true });
    draw();
  });

  let stamp = store.doc.updatedAt;
  return subscribe(() => {
    if (store.doc.updatedAt === stamp) return;
    stamp = store.doc.updatedAt;
    if (!root.contains(document.activeElement) || !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) draw();
  });
}
