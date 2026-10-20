// Weekly 10-K: a one-page filing for a Monday–Sunday week, viewable in the app
// and savable as an image.
import { store } from './store.js';
import { stats, levelScores, accuracy, currentLevel, levelTopics, tickerOf, isRestDay, DAY } from './model.js';
import { creditRating } from './ratings.js';
import { reviewsBetween } from './reviews.js';
import { panel } from './dialog.js';
import { toast } from './toast.js';
import { esc, duration, dayKey, startOfDay, shortDate } from './util.js';

const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
const SEEN_KEY = '301hours:10kSeen';

export function weekStart(offset = 0) {
  const today = startOfDay(Date.now());
  return today - ((new Date(today).getDay() + 6) % 7) * DAY + offset * 7 * DAY;
}

export function weekReport(offset = 0) {
  const level = currentLevel();
  const from = weekStart(offset), to = from + 7 * DAY;
  const st = stats(level);
  const inWeek = (s) => s.start >= from && s.start < to;
  const sessions = st.sessions.filter(inWeek);
  const prev = st.sessions.filter((s) => s.start >= from - 7 * DAY && s.start < from);
  const sec = sessions.reduce((a, s) => a + s.sec, 0);
  const prevSec = prev.reduce((a, s) => a + s.sec, 0);
  const verified = sessions.reduce((a, s) => a + (s.verified ? s.sec : 0), 0);

  const byDay = new Map();
  const byTopic = new Map();
  for (const s of sessions) {
    byDay.set(dayKey(s.start), (byDay.get(dayKey(s.start)) || 0) + s.sec);
    byTopic.set(s.topicId, (byTopic.get(s.topicId) || 0) + s.sec);
  }
  const days = [];
  for (let i = 0; i < 7; i++) days.push({ ts: from + i * DAY, sec: byDay.get(dayKey(from + i * DAY)) || 0 });
  const best = days.reduce((a, d) => (d.sec > a.sec ? d : a), days[0]);
  const topics = levelTopics(level);
  const topRows = [...byTopic.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, v]) => {
    const t = topics.find((x) => x.id === id);
    return { ticker: t ? tickerOf(t) : 'GEN', name: t ? t.name : 'General study', sec: v };
  });
  let modules = 0;
  for (const t of topics) for (const i of t.items) if (!i.deleted && i.done && i.doneAt >= from && i.doneAt < to) modules++;
  const reports = levelScores(level).filter((r) => r.date >= from && r.date < to);
  const acc = accuracy(reports);
  const goal = (store.doc.settings.dailyGoalHours || 0) * 3600;
  const rated = sessions.filter((x) => x.focus);
  const focusAvg = rated.length ? rated.reduce((a, x) => a + x.focus, 0) / rated.length : null;
  return {
    level, from, to, sec, prevSec, verified, days, best, topRows, modules,
    reviews: reviewsBetween(from, to),
    questions: acc.total, accuracy: acc.pct,
    studied: days.filter((d) => d.sec > 0).length,
    restDays: days.filter((d) => !d.sec && isRestDay(d.ts)).length,
    targetHits: goal ? days.filter((d) => d.sec >= goal).length : null,
    rating: creditRating(st, store.doc.settings.dailyGoalHours),
    focusAvg,
    partial: offset === 0,
  };
}

function change(r) {
  if (!r.prevSec) return r.sec ? 'NEW' : '—';
  const pct = ((r.sec - r.prevSec) / r.prevSec) * 100;
  return `${pct >= 0 ? '▲ +' : '▼ −'}${Math.abs(pct).toFixed(0)}%`;
}

function html(r) {
  const max = Math.max(...r.days.map((d) => d.sec), 1);
  const bars = r.days.map((d) => `<div class="tk-day"><div class="tk-bar" style="height:${(d.sec / max) * 100}%"></div><span>${new Date(d.ts).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>`).join('');
  const kv = (k, v, cls = '') => `<div><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  return `
    <div class="tenk">
      <div class="tenk-head">
        <div><div class="tenk-form">FORM 10-K${r.partial ? ' · PRELIMINARY' : ''}</div><div class="muted small">$CFA${r.level} · CFA LEVEL ${ROMAN[r.level]} CANDIDATE · WEEK OF ${shortDate(r.from).toUpperCase()}–${shortDate(r.to - DAY).toUpperCase()}</div></div>
        <div class="tenk-tabs"><button type="button" class="btn small" data-week="-1">LAST WEEK</button><button type="button" class="btn small" data-week="0">THIS WEEK</button></div>
      </div>
      <div class="tenk-hero"><span class="tenk-h">${(r.sec / 3600).toFixed(2)}</span><span class="muted">HRS BANKED</span><span class="${r.sec >= r.prevSec ? 'up' : 'down'}">${change(r)} vs prior week</span></div>
      <div class="tenk-days">${bars}</div>
      <div class="kv-grid">
        ${kv('DAYS STUDIED', `${r.studied}/${7 - r.restDays}${r.restDays ? ` <span class="muted small">+${r.restDays} rest</span>` : ''}`)}
        ${kv('TARGET HIT', r.targetHits === null ? '—' : `${r.targetHits}/7`)}
        ${kv('BEST DAY', r.best.sec ? `${new Date(r.best.ts).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()} ${duration(r.best.sec)}` : '—')}
        ${kv('CAM-VERIFIED', r.sec ? `${Math.round((r.verified / r.sec) * 100)}%` : '—')}
        ${kv('MODULES CLOSED', r.modules)}
        ${kv('REVIEWS DONE', r.reviews)}
        ${kv('QUESTIONS', r.questions || '—')}
        ${kv('ACCURACY', r.accuracy === null ? '—' : `${r.accuracy.toFixed(1)}%`, r.accuracy === null ? '' : r.accuracy >= (store.doc.settings.scoreTarget || 70) ? 'up' : 'down')}
        ${kv('CREDIT RATING', r.rating.grade + (r.rating.outlook ? ` · ${r.rating.outlook}` : ''))}
        ${kv('AVG FOCUS', r.focusAvg === null ? '—' : `${r.focusAvg.toFixed(1)}/5`)}
      </div>
      <div class="tenk-seg"><span class="k">SEGMENTS · TOP TOPICS</span>${r.topRows.length ? r.topRows.map((t) => `<div><b class="tk">${esc(t.ticker)}</b> ${esc(t.name)} <span class="num">${duration(t.sec)}</span></div>`).join('') : '<div class="muted">No study logged this week.</div>'}</div>
      <div class="row end"><button type="button" class="btn" data-save>SAVE AS IMAGE ↓</button></div>
    </div>`;
}

// Draws the report onto a canvas and downloads it as a PNG.
function saveImage(r) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const mono = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
  const amber = '#ffb000', dim = '#a8a495', text = '#e9e5d8', line = '#2a2a25', green = '#2fd47a', red = '#ff5a4f';
  g.fillStyle = '#0b0b0a'; g.fillRect(0, 0, W, H);
  g.fillStyle = amber; g.fillRect(70, 70, 150, 64);
  g.fillStyle = '#0b0b0a'; g.font = `700 44px ${mono}`; g.fillText('301', 104, 118);
  g.fillStyle = text; g.font = `600 30px ${mono}`; g.fillText('T E R M I N A L', 245, 113);
  g.fillStyle = amber; g.font = `700 52px ${mono}`; g.fillText(`FORM 10-K${r.partial ? '*' : ''}`, 70, 230);
  g.fillStyle = dim; g.font = `400 26px ${mono}`;
  g.fillText(`$CFA${r.level} · LEVEL ${ROMAN[r.level]} · WEEK OF ${shortDate(r.from).toUpperCase()}–${shortDate(r.to - DAY).toUpperCase()}`, 70, 280);
  g.strokeStyle = line; g.lineWidth = 2; g.beginPath(); g.moveTo(70, 320); g.lineTo(W - 70, 320); g.stroke();
  g.fillStyle = amber; g.font = `700 150px ${mono}`; g.fillText((r.sec / 3600).toFixed(2), 64, 480);
  g.fillStyle = dim; g.font = `500 30px ${mono}`; g.fillText('HOURS BANKED', 74, 530);
  g.fillStyle = r.sec >= r.prevSec ? green : red; g.fillText(`${change(r)} vs prior week`, 360, 530);
  // day bars
  const max = Math.max(...r.days.map((d) => d.sec), 1);
  r.days.forEach((d, i) => {
    const x = 70 + i * 135, h = (d.sec / max) * 170;
    g.fillStyle = d.sec ? amber : '#23231f'; g.fillRect(x, 760 - Math.max(h, 4), 110, Math.max(h, 4));
    g.fillStyle = dim; g.font = `500 24px ${mono}`; g.fillText(new Date(d.ts).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(), x + 22, 800);
  });
  const rows = [
    ['DAYS STUDIED', `${r.studied}/7`], ['TARGET HIT', r.targetHits === null ? '—' : `${r.targetHits}/7`],
    ['MODULES CLOSED', String(r.modules)], ['REVIEWS DONE', String(r.reviews)],
    ['ACCURACY', r.accuracy === null ? '—' : `${r.accuracy.toFixed(1)}%`], ['CREDIT RATING', r.rating.grade],
  ];
  rows.forEach(([k, v], i) => {
    const x = 70 + (i % 2) * 480, y = 880 + Math.floor(i / 2) * 105;
    g.fillStyle = dim; g.font = `500 22px ${mono}`; g.fillText(k, x, y);
    g.fillStyle = text; g.font = `700 44px ${mono}`; g.fillText(v, x, y + 50);
  });
  g.fillStyle = dim; g.font = `500 22px ${mono}`; g.fillText('TOP TOPICS', 70, 1215);
  g.fillStyle = text; g.font = `600 28px ${mono}`;
  g.fillText(r.topRows.map((t) => `${t.ticker} ${duration(t.sec)}`).join('   ') || '—', 70, 1260);
  g.fillStyle = '#77746a'; g.font = `400 20px ${mono}`;
  g.fillText(r.partial ? '* PRELIMINARY: WEEK IN PROGRESS' : '301 TERMINAL', 70, 1305);
  c.toBlob((blob) => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `301-10K-L${r.level}-${dayKey(r.from)}.png` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

export function showReport(offset = -1) {
  let r = weekReport(offset);
  const p = panel('WEEKLY 10-K', html(r));
  const dlg = document.querySelector('dialog.tdialog:last-of-type');
  const wire = () => {
    dlg.querySelectorAll('[data-week]').forEach((b) => {
      b.classList.toggle('primary', Number(b.dataset.week) === offset);
      b.addEventListener('click', () => {
        offset = Number(b.dataset.week);
        r = weekReport(offset);
        dlg.querySelector('.tenk').outerHTML = html(r);
        wire();
      });
    });
    dlg.querySelector('[data-save]').addEventListener('click', () => saveImage(r));
  };
  wire();
  return p;
}

// Once a week (first visit from Monday on), announce last week's filing.
export function announceWeekly() {
  const key = dayKey(weekStart(0));
  let seen = '';
  try { seen = localStorage.getItem(SEEN_KEY) || ''; } catch { /* ignore */ }
  if (seen === key) return;
  try { localStorage.setItem(SEEN_KEY, key); } catch { /* ignore */ }
  if (weekReport(-1).sec <= 0) return;
  toast({ kind: 'info', title: '◆ WEEKLY 10-K FILED', body: 'Last week\'s report is ready: hours, best day, topics, accuracy and rating.', timeout: 15000, action: { label: 'VIEW 10-K', onClick: () => showReport(-1) } });
}
