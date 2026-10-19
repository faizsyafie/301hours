import { store } from './store.js';
import { stats, hourStamps, examCountdown, currentLevel, tickerOf, DAY } from './model.js';
import { MILESTONES } from './curriculum.js';
import { analystRatings, topPick, ratingMinHours } from './ratings.js';
import { setTopic } from './timer.js';
import { esc, hours, duration, dayKey, startOfDay, shortDate, timeOfDay } from './util.js';

const CHART_DAYS = 30;
const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };

export const symbol = (level = currentLevel()) => `$CFA${level}`;

const signed = (n, digits = 2) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;

function arrow(delta) {
  if (delta > 0.004) return `<span class="up">▲ ${signed(delta)}</span>`;
  if (delta < -0.004) return `<span class="down">▼ ${signed(delta)}</span>`;
  return `<span class="flat">■ 0.00</span>`;
}

// Milestones that apply to the current goal, plus the goal itself.
export function milestonesFor(goal) {
  const list = MILESTONES.filter(([h]) => h <= goal);
  if (!list.some(([h]) => h === goal)) list.push([goal, `${goal} HOURS. TARGET HIT. ALL-TIME HIGH.`]);
  return list;
}

function pickLine(st) {
  const ratings = analystRatings(st.topics);
  const pick = topPick(st.topics, ratings);
  if (!pick) return '';
  const r = ratings.get(pick.topic.id);
  return `<a class="top-pick" href="#/study" data-pick="${esc(pick.topic.id)}" title="Study ${esc(pick.topic.name)} next">TOP PICK <b>${esc(pick.ticker)}</b> <span class="rating buy">▲ BUY</span> <span class="muted">${Math.round(r.share * 100)}% of hours vs ${Math.round(r.target * 100)}% of exam</span></a>`;
}

function quote(st) {
  const s = store.doc.settings;
  const level = currentLevel();
  const totalH = st.total / 3600;
  const todayH = st.today / 3600;
  const prev = totalH - todayH;
  const pct = prev > 0 ? (todayH / prev) * 100 : 0;
  const exam = examCountdown();
  const remaining = Math.max(0, s.goalHours - totalH);
  const req = exam && exam.days > 0 ? (remaining / exam.days).toFixed(2) : '—';
  const mods = st.topics.reduce((a, t) => ({ done: a.done + t.done, total: a.total + t.total }), { done: 0, total: 0 });

  const cell = (k, v, cls = '') => `<div class="qcell"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;

  return `
    <section class="panel quote">
      <div class="quote-main">
        <div class="quote-sym"><span class="sym">${symbol(level)}</span><span class="muted">CFA LEVEL ${ROMAN[level]} CANDIDATE · HOURS BANKED</span></div>
        <div class="quote-px">
          <span class="px">${totalH.toFixed(2)}</span>
          <span class="chg">${arrow(todayH)} <span class="muted">(${todayH > 0 && prev > 0 ? signed(pct, 1) + '%' : todayH > 0 ? 'IPO' : '0.0%'}) TODAY</span></span>
        </div>
      </div>
      <div class="quote-side">
        <a class="btn primary big" href="#/study">OPEN MARKET ▸</a>
        ${pickLine(st)}
      </div>
      <div class="qstrip">
        ${cell('TGT', s.goalHours.toFixed(2))}
        ${cell('REM', remaining.toFixed(2))}
        ${cell('EXAM', exam ? (exam.days > 0 ? `T-${exam.days}D` : 'DONE') : '<a href="#/settings">SET</a>')}
        ${cell('REQ/D', req, exam && exam.days > 0 && st.today / 3600 >= Number(req) ? 'up' : '')}
        ${cell('WK', (st.week / 3600).toFixed(2))}
        ${cell('STRK', `${st.streak}D`, st.streak ? 'up' : '')}
        ${cell('MODS', `${mods.done}/${mods.total}`)}
        ${cell('CAM', st.total ? `${Math.round((st.verified / st.total) * 100)}%` : '—')}
      </div>
    </section>`;
}

function grid(st) {
  const goal = Math.max(1, Math.min(1000, Math.round(store.doc.settings.goalHours)));
  const totalH = st.total / 3600;
  const stamps = hourStamps(st.sessions);
  const ms = milestonesFor(goal);
  const msSet = new Set(ms.map(([h]) => h));
  const partial = totalH - Math.floor(totalH);

  let cells = '';
  for (let h = 1; h <= goal; h++) {
    const filled = h <= totalH;
    const current = !filled && h === Math.floor(totalH) + 1;
    const tip = filled ? `HR ${h} · BANKED ${shortDate(stamps[h - 1])}` : current ? `HR ${h} · ${Math.round(partial * 100)}% FILLED` : `HR ${h}`;
    const cls = ['sq', filled && 'on', current && 'cur', msSet.has(h) && 'ms'].filter(Boolean).join(' ');
    cells += `<i class="${cls}" data-tip="${tip}${msSet.has(h) ? ' · MILESTONE' : ''}"${current ? ` style="--fill:${(partial * 100).toFixed(0)}%"` : ''}></i>`;
  }

  const next = ms.find(([h]) => h > totalH);
  const track = ms.map(([h]) => `<span class="ms-chip ${totalH >= h ? 'hit' : ''}">${totalH >= h ? '✓' : '·'} ${h}H</span>`).join('');

  return `
    <section class="panel">
      <div class="phead"><span>HOUR GRID · ${Math.floor(totalH)} / ${goal}</span><span class="muted">${next ? `NEXT MILESTONE ${next[0]}H IN ${(next[0] - totalH).toFixed(2)}H` : 'ALL MILESTONES HIT'}</span></div>
      <div class="grid301" aria-label="${Math.floor(totalH)} of ${goal} hours completed">${cells}</div>
      <div class="ms-track">${track}</div>
      <div class="grid-tip muted small">&nbsp;</div>
    </section>`;
}

function chartData(st) {
  const today = startOfDay(Date.now());
  const first = today - (CHART_DAYS - 1) * DAY;
  let before = 0;
  for (const s of st.sessions) if (s.start < first) before += s.sec;
  const days = [];
  let cum = before;
  for (let i = 0; i < CHART_DAYS; i++) {
    const d = first + i * DAY;
    const vol = st.byDay.get(dayKey(d)) || 0;
    cum += vol;
    days.push({ ts: d, vol: vol / 3600, close: cum / 3600 });
  }
  return days;
}

function niceStep(range, target) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
}

function drawChart(el, days) {
  const W = el.clientWidth;
  if (!W) return;
  const AX = 52, PH = 170, GAP = 18, VH = 64, XH = 20;
  const H = PH + GAP + VH + XH;
  const iw = W - AX;
  const x = (i) => (i + 0.5) * (iw / days.length);

  const closes = days.map((d) => d.close);
  let lo = Math.min(...closes), hi = Math.max(...closes);
  if (hi - lo < 1) { hi += 0.5; lo = Math.max(0, lo - 0.5); }
  const pStep = niceStep(hi - lo, 4);
  lo = Math.floor(lo / pStep) * pStep; hi = Math.ceil(hi / pStep) * pStep;
  const py = (v) => PH - ((v - lo) / (hi - lo)) * (PH - 8) - 4;

  const vmax = Math.max(store.doc.settings.dailyGoalHours || 0, ...days.map((d) => d.vol), 1);
  const vStep = niceStep(vmax, 2);
  const vtop = Math.ceil(vmax / vStep) * vStep;
  const vy = (v) => PH + GAP + VH - (v / vtop) * VH;

  let svg = '';
  for (let v = lo; v <= hi + 1e-9; v += pStep) svg += `<line class="gl" x1="0" x2="${iw}" y1="${py(v)}" y2="${py(v)}"/><text class="ax" x="${iw + 6}" y="${py(v) + 4}">${v.toFixed(pStep < 1 ? 1 : 0)}</text>`;
  for (let v = 0; v <= vtop + 1e-9; v += vStep) svg += `<line class="gl${v === 0 ? ' base' : ''}" x1="0" x2="${iw}" y1="${vy(v)}" y2="${vy(v)}"/><text class="ax" x="${iw + 6}" y="${vy(v) + 4}">${v}h</text>`;

  const pts = days.map((d, i) => `${x(i).toFixed(1)},${py(d.close).toFixed(1)}`);
  svg += `<path class="area" d="M${x(0)},${PH} L${pts.join(' L')} L${x(days.length - 1)},${PH} Z"/>`;
  svg += `<path class="line" d="M${pts.join(' L')}"/>`;

  const goal = store.doc.settings.dailyGoalHours;
  const bw = Math.max(2, iw / days.length - 2);
  days.forEach((d, i) => {
    if (d.vol > 0) {
      const top = vy(d.vol);
      const h = PH + GAP + VH - top;
      svg += `<path class="vol${d.vol >= goal && goal ? ' hit' : ''}" d="M${x(i) - bw / 2},${top + h} V${top + Math.min(2, h)} q0,-2 2,-2 H${x(i) + bw / 2 - 2} q2,0 2,2 V${top + h} Z"/>`;
    }
    const dt = new Date(d.ts);
    if (i === 0 || i === days.length - 1 || (dt.getDay() === 1 && i > 2 && i < days.length - 3)) {
      svg += `<text class="ax" x="${x(i)}" y="${H - 4}" text-anchor="middle">${shortDate(d.ts).toUpperCase()}</text>`;
    }
  });
  if (goal) svg += `<line class="goal" x1="0" x2="${iw}" y1="${vy(goal)}" y2="${vy(goal)}"/>`;
  svg += `<text class="plabel" x="4" y="14">CLOSE · CUMULATIVE HRS</text><text class="plabel" x="4" y="${PH + GAP + 10}">VOL · HRS/DAY${goal ? ` · TARGET ${goal}H` : ''}</text>`;
  svg += `<line class="cross" x1="0" x2="0" y1="0" y2="${PH + GAP + VH}" visibility="hidden"/><circle class="dot" r="4" visibility="hidden"/>`;
  svg += `<rect class="hit-area" x="0" y="0" width="${iw}" height="${PH + GAP + VH}"/>`;

  el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Cumulative hours and daily hours, last ${CHART_DAYS} days">${svg}</svg><div class="tooltip" hidden></div>`;

  const svgEl = el.querySelector('svg');
  const cross = el.querySelector('.cross');
  const dot = el.querySelector('.dot');
  const tip = el.querySelector('.tooltip');
  const move = (clientX) => {
    const r = svgEl.getBoundingClientRect();
    const i = Math.max(0, Math.min(days.length - 1, Math.floor(((clientX - r.left) / iw) * days.length)));
    const d = days[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', py(d.close)); dot.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="muted">${new Date(d.ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}</div><div>CLOSE <b>${d.close.toFixed(2)}</b></div><div>VOL <b>${d.vol ? duration(d.vol * 3600) : '—'}</b></div>`;
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(x(i), 70), iw - 70)}px`;
  };
  const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  const area = el.querySelector('.hit-area');
  area.addEventListener('pointermove', (e) => move(e.clientX));
  area.addEventListener('pointerleave', leave);
}

function chartTable(days) {
  return `<details class="table-view"><summary>VIEW AS TABLE</summary><table><thead><tr><th>DATE</th><th class="num">VOL (H)</th><th class="num">CLOSE (H)</th></tr></thead><tbody>${
    days.slice().reverse().map((d) => `<tr><td>${shortDate(d.ts).toUpperCase()}</td><td class="num">${d.vol.toFixed(2)}</td><td class="num">${d.close.toFixed(2)}</td></tr>`).join('')
  }</tbody></table></details>`;
}

function ratingChip(r) {
  return `<span class="rating ${r.cls}" title="${r.target === null ? 'No exam weight set' : `${Math.round(r.share * 100)}% of your hours vs ${Math.round(r.target * 100)}% of the exam`}">${r.icon} ${r.short}</span>`;
}

function watchlist(st) {
  const ratings = analystRatings(st.topics);
  const rows = st.topics.map((t) => {
    const chg = (t.week - t.prevWeek) / 3600;
    const r = ratings.get(t.topic.id);
    return `<tr data-href="#/topics?open=${encodeURIComponent(t.topic.id)}" tabindex="0">
      <td class="tk">${esc(t.ticker)}</td>
      <td class="nm">${esc(t.topic.name)}</td>
      <td class="num">${hours(t.sec, 2)}</td>
      <td class="num">${hours(t.week, 2)}</td>
      <td class="num">${arrow(chg)}</td>
      <td class="num">${t.done}/${t.total}</td>
      <td class="bar-cell"><div class="meter"><div style="width:${t.total ? (t.done / t.total) * 100 : 0}%"></div></div></td>
      <td class="num muted">${r.target === null ? '—' : `${Math.round(r.share * 100)}/${Math.round(r.target * 100)}%`}</td>
      <td>${ratingChip(r)}</td>
    </tr>`;
  }).join('');
  const unrated = st.total < ratingMinHours * 3600;
  return `
    <section class="panel">
      <div class="phead"><span>WATCHLIST · LEVEL ${ROMAN[currentLevel()]}</span><span class="muted">${unrated ? `RATINGS START AFTER ${ratingMinHours}H BANKED` : 'MIX = YOUR SHARE OF HOURS / SHARE OF THE EXAM'}</span></div>
      <div class="table-wrap"><table class="watch">
        <thead><tr><th>TKR</th><th>TOPIC</th><th class="num">HRS</th><th class="num">7D</th><th class="num">7D CHG</th><th class="num">MODS</th><th>DONE</th><th class="num">MIX</th><th>RATING</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
}

function tape(st) {
  const topics = new Map(store.doc.topics.map((t) => [t.id, t]));
  const recent = st.sessions.slice().sort((a, b) => b.start - a.start).slice(0, 10);
  const body = recent.length
    ? recent.map((s) => {
      const t = topics.get(s.topicId);
      const flag = s.manual ? 'MAN' : s.verified ? 'CAM' : 'NOCAM';
      return `<tr><td class="muted">${shortDate(s.start).toUpperCase()} ${timeOfDay(s.start)}</td><td class="tk">${t ? esc(tickerOf(t)) : 'GEN'}</td><td class="num up">${duration(s.sec)}</td><td class="flag flag-${flag.toLowerCase()}">${flag}</td></tr>`;
    }).join('')
    : '<tr><td colspan="4" class="muted empty">NO TRADES YET. THE CURRICULUM ISN\'T GOING TO READ ITSELF.</td></tr>';
  return `
    <section class="panel">
      <div class="phead"><span>TIME &amp; SALES</span><span class="muted">LAST 10</span></div>
      <table class="tape"><tbody>${body}</tbody></table>
    </section>`;
}

export function renderDashboard(root) {
  const st = stats();
  const days = chartData(st);
  root.innerHTML = `
    ${quote(st)}
    ${grid(st)}
    <div class="row-2">
      <section class="panel">
        <div class="phead"><span>${symbol()} · ${CHART_DAYS}D</span><span class="muted">HOVER FOR DETAIL</span></div>
        <div class="chart"></div>
        ${chartTable(days)}
      </section>
      ${tape(st)}
    </div>
    ${watchlist(st)}`;

  const chart = root.querySelector('.chart');
  drawChart(chart, days);
  const ro = new ResizeObserver(() => drawChart(chart, days));
  ro.observe(chart);

  const gridTip = root.querySelector('.grid-tip');
  root.querySelector('.grid301').addEventListener('pointerover', (e) => {
    if (e.target.dataset.tip) gridTip.textContent = e.target.dataset.tip;
  });

  root.querySelectorAll('.watch tr[data-href]').forEach((tr) => {
    const go = () => { location.hash = tr.dataset.href; };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });

  root.querySelector('[data-pick]')?.addEventListener('click', (e) => setTopic(e.currentTarget.dataset.pick, ''));

  return () => ro.disconnect();
}

// Short items for the scrolling ticker tape in the header.
export function tickerItems() {
  const st = stats();
  const totalH = st.total / 3600;
  const exam = examCountdown();
  const items = [`<b>${symbol()}</b> ${totalH.toFixed(2)} ${arrow(st.today / 3600)}`];
  for (const t of st.topics) items.push(`<b>${esc(t.ticker)}</b> ${hours(t.sec, 1)}H ${arrow((t.week - t.prevWeek) / 3600)}`);
  items.push(`<b>STREAK</b> ${st.streak}D`);
  if (exam && exam.days > 0) items.push(`<b>EXAM</b> T-${exam.days}D`);
  items.push(`<b>TGT</b> ${store.doc.settings.goalHours}H`);
  return items;
}
