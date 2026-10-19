import { store } from './store.js';
import { esc, hours, duration, dayKey, startOfDay, shortDate, timeOfDay } from './util.js';

const DAY = 86400000;
const CHART_DAYS = 30;

function liveSessions() {
  return store.doc.sessions.filter((s) => !s.deleted && s.sec > 0);
}

export function topicStats() {
  const secByTopic = new Map();
  for (const s of liveSessions()) secByTopic.set(s.topicId, (secByTopic.get(s.topicId) || 0) + s.sec);
  return store.doc.topics.filter((t) => !t.deleted).map((t) => {
    const items = t.items.filter((i) => !i.deleted);
    return { topic: t, sec: secByTopic.get(t.id) || 0, done: items.filter((i) => i.done).length, total: items.length };
  });
}

function computeStats() {
  const sessions = liveSessions();
  const now = Date.now();
  const today = startOfDay(now);
  const weekStart = today - ((new Date(today).getDay() + 6) % 7) * DAY; // Monday

  const byDay = new Map();
  let total = 0, verified = 0, week = 0;
  for (const s of sessions) {
    total += s.sec;
    if (s.verified) verified += s.sec;
    if (s.start >= weekStart) week += s.sec;
    const k = dayKey(s.start);
    byDay.set(k, (byDay.get(k) || 0) + s.sec);
  }

  let streak = 0;
  for (let d = byDay.has(dayKey(today)) ? today : today - DAY; byDay.get(dayKey(d)) > 0; d -= DAY) streak++;

  const days = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const d = today - i * DAY;
    days.push({ ts: d, sec: byDay.get(dayKey(d)) || 0 });
  }

  return { total, verified, week, today: byDay.get(dayKey(today)) || 0, streak, days, recent: sessions.slice(-6).reverse() };
}

function paceLine(totalSec) {
  const { goalHours, examDate } = store.doc.settings;
  const left = Math.max(0, goalHours - totalSec / 3600);
  if (left === 0) return `Goal reached. ${goalHours} h done.`;
  if (!examDate) return `<a href="#/settings">Set your exam date</a> to see the daily pace you need.`;
  const daysLeft = Math.ceil((new Date(examDate + 'T00:00').getTime() - startOfDay(Date.now())) / DAY);
  if (daysLeft <= 0) return `Exam date has passed. ${left.toFixed(1)} h short of the goal.`;
  return `<strong>${(left / daysLeft).toFixed(1)} h/day</strong> for the next ${daysLeft} days reaches ${goalHours} h by the exam.`;
}

function examTile() {
  const { examDate } = store.doc.settings;
  if (!examDate) return tile('Exam in', '–', '<a href="#/settings">Set exam date</a>');
  const daysLeft = Math.ceil((new Date(examDate + 'T00:00').getTime() - startOfDay(Date.now())) / DAY);
  return tile('Exam in', daysLeft > 0 ? `${daysLeft}` : '0', daysLeft > 0 ? `days · ${shortDate(new Date(examDate + 'T00:00'))}` : 'exam day has passed');
}

function tile(label, value, sub) {
  return `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`;
}

// Picks a round axis maximum and tick step for `maxHours`.
function axis(maxHours) {
  const step = maxHours <= 2 ? 0.5 : maxHours <= 4 ? 1 : maxHours <= 10 ? 2 : 4;
  return { top: Math.max(step, Math.ceil(maxHours / step) * step), step };
}

function dailyChart(days) {
  const goal = store.doc.settings.dailyGoalHours || 0;
  const { top, step } = axis(Math.max(goal, ...days.map((d) => d.sec / 3600), 1));
  const pct = (h) => `${(h / top) * 100}%`;

  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(`<div class="tick" style="bottom:${pct(v)}"><span>${v}h</span></div>`);

  const bars = days.map((d, i) => {
    const h = d.sec / 3600;
    const label = new Date(d.ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const last = days.length - 1;
    const showLabel = i === 0 || i === last || (new Date(d.ts).getDay() === 1 && i > 2 && i < last - 2);
    return `<div class="col" tabindex="0" data-tip="${esc(label)}|${d.sec ? duration(d.sec) : 'No study'}">
      ${h > 0 ? `<div class="bar" style="height:${pct(h)}"></div>` : ''}
      ${showLabel ? `<span class="xlabel">${shortDate(d.ts)}</span>` : ''}
    </div>`;
  }).join('');

  const rows = days.slice().reverse().map((d) => `<tr><td>${shortDate(d.ts)}</td><td class="num">${hours(d.sec, 2)}</td></tr>`).join('');

  return `
    <div class="chart" role="img" aria-label="Hours studied per day, last ${CHART_DAYS} days">
      <div class="plot">
        ${ticks.join('')}
        ${goal ? `<div class="goal-line" style="bottom:${pct(goal)}"><span>daily goal ${goal}h</span></div>` : ''}
        <div class="bars">${bars}</div>
      </div>
      <div class="tooltip" hidden></div>
    </div>
    <details class="table-view"><summary>View as table</summary>
      <table><thead><tr><th>Day</th><th class="num">Hours</th></tr></thead><tbody>${rows}</tbody></table>
    </details>`;
}

function topicRows() {
  const stats = topicStats();
  const maxSec = Math.max(...stats.map((s) => s.sec), 1);
  return stats.map(({ topic, sec, done, total }) => `
    <a class="trow" href="#/topics?open=${encodeURIComponent(topic.id)}">
      <div class="trow-name"><span>${esc(topic.name)}</span>${topic.weight ? `<span class="weight">${esc(topic.weight)} of exam</span>` : ''}</div>
      <div class="trow-hours" title="${duration(sec)} studied">
        <div class="hbar-track">${sec > 0 ? `<div class="hbar" style="width:${(sec / maxSec) * 100}%"></div>` : ''}</div>
        <span class="num">${hours(sec)}h</span>
      </div>
      <div class="trow-mods" title="${done} of ${total} modules done">
        <div class="meter"><div style="width:${total ? (done / total) * 100 : 0}%"></div></div>
        <span class="num">${done}/${total}</span>
      </div>
    </a>`).join('');
}

function recentList(recent) {
  if (!recent.length) return '<p class="muted">No sessions yet. Start a study block and it will show up here.</p>';
  const topics = new Map(store.doc.topics.map((t) => [t.id, t]));
  return `<ul class="recent">${recent.map((s) => {
    const t = topics.get(s.topicId);
    const item = t?.items.find((i) => i.id === s.itemId);
    return `<li>
      <div><div>${esc(t?.name || 'General study')}</div>${item ? `<div class="muted small">${esc(item.name)}</div>` : ''}</div>
      <div class="right"><div class="num">${duration(s.sec)}</div><div class="muted small">${shortDate(s.start)}, ${timeOfDay(s.start)}${s.manual ? ' · manual' : s.verified ? '' : ' · no camera'}</div></div>
    </li>`;
  }).join('')}</ul>`;
}

export function renderDashboard(root) {
  const st = computeStats();
  const { goalHours, dailyGoalHours } = store.doc.settings;
  const totalH = st.total / 3600;
  const pctDone = Math.min(100, (totalH / goalHours) * 100);
  const mods = topicStats().reduce((a, t) => ({ done: a.done + t.done, total: a.total + t.total }), { done: 0, total: 0 });

  root.innerHTML = `
    <section class="hero card">
      <div class="hero-main">
        <div class="hero-label">Total study time</div>
        <div class="hero-figure"><span class="hero-num">${totalH.toFixed(1)}</span><span class="hero-unit">/ ${goalHours} h</span></div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${goalHours}" aria-valuenow="${totalH.toFixed(1)}"><div style="width:${pctDone}%"></div></div>
        <div class="hero-sub">${pctDone.toFixed(0)}% of goal · ${Math.max(0, goalHours - totalH).toFixed(1)} h to go</div>
        <p class="pace">${paceLine(st.total)}</p>
      </div>
      <a class="btn primary big" href="#/study">Start studying</a>
    </section>

    <section class="tiles">
      ${tile('Today', duration(st.today), dailyGoalHours ? `of ${dailyGoalHours}h daily goal` : '&nbsp;')}
      ${tile('This week', duration(st.week), 'since Monday')}
      ${tile('Streak', `${st.streak}`, st.streak === 1 ? 'day' : 'days in a row')}
      ${tile('Modules done', `${mods.done}<span class="tile-of">/${mods.total}</span>`, `${mods.total ? Math.round((mods.done / mods.total) * 100) : 0}% of curriculum`)}
      ${examTile()}
    </section>

    <section class="card">
      <div class="card-head"><h2>Daily study, last ${CHART_DAYS} days</h2></div>
      ${dailyChart(st.days)}
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>By topic</h2><span class="legend"><i class="sw-hours"></i>hours <i class="sw-mods"></i>modules done</span></div>
        <div class="trows">${topicRows()}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Recent sessions</h2>${st.total ? `<span class="muted small">${Math.round((st.verified / st.total) * 100)}% camera-verified</span>` : ''}</div>
        ${recentList(st.recent)}
      </section>
    </div>`;

  wireTooltip(root.querySelector('.chart'));
}

function wireTooltip(chart) {
  const tip = chart.querySelector('.tooltip');
  const show = (col) => {
    const [label, value] = col.dataset.tip.split('|');
    tip.innerHTML = `<div class="muted small">${label}</div><div><strong>${value}</strong></div>`;
    tip.hidden = false;
    const c = chart.getBoundingClientRect();
    const r = col.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2 - c.left, 60), c.width - 60);
    tip.style.left = `${x}px`;
    col.classList.add('active');
  };
  const hide = (col) => { tip.hidden = true; col.classList.remove('active'); };
  chart.querySelectorAll('.col').forEach((col) => {
    col.addEventListener('mouseenter', () => show(col));
    col.addEventListener('mouseleave', () => hide(col));
    col.addEventListener('focus', () => show(col));
    col.addEventListener('blur', () => hide(col));
  });
}
