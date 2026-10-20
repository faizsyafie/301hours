// On-track chart: from your first study day to exam day, three lines —
//   actual      cumulative hours so far
//   target      the steady path to your goal, rising only on study days
//   projection  where your last 14 days' pace takes you by exam day
import { store } from './store.js';
import { stats, examCountdown, isRestDay, DAY } from './model.js';
import { dayKey, startOfDay, shortDate, esc } from './util.js';

const PACE_DAYS = 14;

export function onTrackData() {
  const exam = examCountdown();
  if (!exam || exam.days <= 0) return null;
  const st = stats();
  const goal = store.doc.settings.goalHours || 301;
  const today = startOfDay(Date.now());
  const first = st.sessions.length ? startOfDay(Math.min(...st.sessions.map((s) => s.start))) : today;
  const start = Math.min(first, today);
  const end = exam.date; // exam day itself isn't a study day
  const n = Math.round((end - start) / DAY);
  const studyDay = (ts) => !isRestDay(ts);
  let totalStudy = 0;
  for (let i = 0; i < n; i++) if (studyDay(start + i * DAY)) totalStudy++;
  totalStudy = Math.max(1, totalStudy);

  // Pace: hours per study day over the last 14 days.
  let recent = 0, recentDays = 0;
  for (let i = 0; i < PACE_DAYS; i++) {
    const d = today - i * DAY;
    if (d < start) break;
    const sec = st.byDay.get(dayKey(d)) || 0;
    recent += sec;
    if (sec > 0 || studyDay(d)) recentDays++;
  }
  const pace = recentDays ? recent / 3600 / recentDays : 0;

  const pts = [];
  let cum = 0, studied = 0, proj = 0;
  for (let i = 0; i <= n; i++) {
    const d = start + i * DAY;
    if (i < n && studyDay(d)) studied++;
    const target = goal * Math.min(1, studied / totalStudy);
    let actual = null;
    if (d <= today) {
      cum += (st.byDay.get(dayKey(d)) || 0) / 3600;
      actual = cum;
      proj = cum;
    } else if (i < n && studyDay(d)) {
      proj += pace;
    }
    pts.push({ ts: d, target, actual, proj: d >= today ? proj : null });
  }
  const now = pts.find((p) => p.ts === today) || pts[0];
  const diff = now.actual - now.target;
  const band = Math.max(1, goal * 0.01);
  const status = Math.abs(diff) <= band ? 'ON TRACK' : diff > 0 ? 'AHEAD' : 'BEHIND';
  const finish = pts[pts.length - 1].proj;
  return { pts, goal, today, end, diff, status, pace, finish };
}

export function paceCell(d) {
  if (!d) return { text: '<a href="#/settings">SET EXAM</a>', cls: '' };
  const h = Math.abs(d.diff).toFixed(1);
  if (d.status === 'ON TRACK') return { text: 'ON TRK', cls: 'up', title: 'On track for your goal' };
  return d.status === 'AHEAD'
    ? { text: `+${h}H`, cls: 'up', title: `${h}h ahead of the path to exam day` }
    : { text: `−${h}H`, cls: 'down', title: `${h}h behind the path to exam day` };
}

export function drawOnTrack(el, d) {
  const W = el.clientWidth;
  if (!W) return;
  if (!d) {
    el.innerHTML = '<p class="note">Set your exam date in <a href="#/settings">5 SETUP</a> to see your path to exam day.</p>';
    return;
  }
  const AX = 52, H = 250, XH = 22, T = 10;
  const iw = W - AX;
  const n = d.pts.length - 1;
  const x = (i) => (n ? (i / n) * iw : iw / 2);
  const top = Math.max(d.goal, d.finish || 0, ...d.pts.map((p) => p.actual || 0)) * 1.06;
  const step = top <= 60 ? 10 : top <= 150 ? 25 : top <= 400 ? 50 : 100;
  const y = (v) => T + (H - T) - (v / top) * (H - T);
  let svg = '';
  for (let v = 0; v <= top; v += step) svg += `<line class="gl${v === 0 ? ' base' : ''}" x1="0" x2="${iw}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${iw + 6}" y="${y(v) + 4}">${v}</text>`;
  // goal + exam markers
  svg += `<line class="goal-h" x1="0" x2="${iw}" y1="${y(d.goal)}" y2="${y(d.goal)}"/><text class="plabel" x="4" y="${y(d.goal) - 5}">GOAL ${d.goal}H</text>`;
  const ti = d.pts.findIndex((p) => p.ts === d.today);
  svg += `<line class="today-v" x1="${x(ti)}" x2="${x(ti)}" y1="${T}" y2="${H}"/><text class="plabel" x="${x(ti) + 4}" y="${T + 10}">TODAY</text>`;
  svg += `<text class="plabel exam-l" x="${iw - 4}" y="${H + 16}" text-anchor="end">EXAM ${shortDate(d.end).toUpperCase()}</text>`;
  const path = (key) => d.pts.map((p, i) => (p[key] === null ? null : `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`)).filter(Boolean).join(' L');
  svg += `<path class="ot-target" d="M${path('target')}"/>`;
  svg += `<path class="ot-proj" d="M${path('proj')}"/>`;
  svg += `<path class="ot-actual" d="M${path('actual')}"/>`;
  // month ticks
  let lastX = -Infinity;
  d.pts.forEach((p, i) => {
    const first = i === 0;
    if (!first && (new Date(p.ts).getDate() !== 1 || x(i) - lastX < 64 || x(i) > iw - 110)) return;
    svg += `<text class="ax" x="${x(i)}" y="${H + 16}" text-anchor="${first ? 'start' : 'middle'}">${shortDate(p.ts).toUpperCase()}</text>`;
    lastX = first ? x(i) + 24 : x(i);
  });
  svg += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${H}" visibility="hidden"/>`;
  svg += `<rect class="hit-area" x="0" y="0" width="${iw}" height="${H}"/>`;
  el.innerHTML = `
    <div class="ot-legend"><span><i class="lg-actual"></i>ACTUAL</span><span><i class="lg-target"></i>TARGET PATH</span><span><i class="lg-proj"></i>AT ${d.pace.toFixed(1)}H/STUDY DAY</span>
      <span class="muted">${d.finish >= d.goal ? `PROJECTED ${d.finish.toFixed(0)}H BY EXAM ✓` : `PROJECTED ${d.finish.toFixed(0)}H, ${(d.goal - d.finish).toFixed(0)}H SHORT`}</span></div>
    <svg width="${W}" height="${H + XH}" role="img" aria-label="Hours to date against the target path to exam day">${svg}</svg><div class="tooltip" hidden></div>`;
  const svgEl = el.querySelector('svg');
  const cross = el.querySelector('.cross');
  const tip = el.querySelector('.tooltip');
  const area = el.querySelector('.hit-area');
  area.addEventListener('pointermove', (e) => {
    const r = svgEl.getBoundingClientRect();
    const i = Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / iw) * n)));
    const p = d.pts[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="muted">${esc(new Date(p.ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' }).toUpperCase())}${isRestDay(p.ts) ? ' · REST' : ''}</div>
      ${p.actual !== null ? `<div>ACTUAL <b>${p.actual.toFixed(1)}H</b></div>` : ''}<div>TARGET <b>${p.target.toFixed(1)}H</b></div>${p.proj !== null && p.ts > d.today ? `<div>PROJECTED <b>${p.proj.toFixed(1)}H</b></div>` : ''}`;
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(x(i), 80), iw - 80)}px`;
  });
  area.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}

export function onTrackTable(d) {
  if (!d) return '';
  const rows = d.pts.filter((p, i) => i % 7 === 0 || i === d.pts.length - 1).map((p) => `<tr><td>${shortDate(p.ts).toUpperCase()}</td><td class="num">${p.actual === null ? '—' : p.actual.toFixed(1)}</td><td class="num">${p.target.toFixed(1)}</td><td class="num">${p.proj === null ? '—' : p.proj.toFixed(1)}</td></tr>`).join('');
  return `<details class="table-view"><summary>VIEW AS TABLE (WEEKLY)</summary><table><thead><tr><th>DATE</th><th class="num">ACTUAL</th><th class="num">TARGET</th><th class="num">PROJECTED</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}
