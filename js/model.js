// Read helpers over store.doc that know about levels, pathways and tickers.
import { store } from './store.js';
import { dayKey, startOfDay } from './util.js';

export const DAY = 86400000;

// Stand-in topic for sessions logged as "GEN · General study".
export const GENERAL = { id: '', name: 'General study', weight: '', items: [] };

export const levelOf = (t) => t.level || 1;

export function tickerOf(t) {
  if (t.ticker) return t.ticker;
  const words = t.name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0] || 'TOP').slice(0, 4).toUpperCase();
}

export const currentLevel = () => store.doc.settings.level || 1;

// Topics shown for a level: not deleted, and for Level III only the chosen pathway.
export function levelTopics(level = currentLevel()) {
  const { pathway } = store.doc.settings;
  return store.doc.topics.filter((t) => !t.deleted && levelOf(t) === level && (!t.pathway || t.pathway === pathway));
}

export function sessionLevel(s) {
  if (s.level) return s.level;
  const t = store.doc.topics.find((x) => x.id === s.topicId);
  return t ? levelOf(t) : 1;
}

export function levelSessions(level = currentLevel()) {
  return store.doc.sessions.filter((s) => !s.deleted && s.sec > 0 && sessionLevel(s) === level);
}

export function examCountdown() {
  const { examDate } = store.doc.settings;
  if (!examDate) return null;
  const date = new Date(examDate + 'T00:00').getTime();
  return { date, days: Math.ceil((date - startOfDay(Date.now())) / DAY) };
}

export function stats(level = currentLevel()) {
  const sessions = levelSessions(level);
  const now = Date.now();
  const today = startOfDay(now);
  const weekStart = today - ((new Date(today).getDay() + 6) % 7) * DAY; // Monday

  const byDay = new Map();
  const byTopic = new Map();
  const byTopicWeek = new Map();
  const byTopicPrevWeek = new Map();
  let total = 0, verified = 0, week = 0;
  for (const s of sessions) {
    total += s.sec;
    if (s.verified) verified += s.sec;
    if (s.start >= weekStart) week += s.sec;
    const k = dayKey(s.start);
    byDay.set(k, (byDay.get(k) || 0) + s.sec);
    byTopic.set(s.topicId, (byTopic.get(s.topicId) || 0) + s.sec);
    if (s.start >= now - 7 * DAY) byTopicWeek.set(s.topicId, (byTopicWeek.get(s.topicId) || 0) + s.sec);
    else if (s.start >= now - 14 * DAY) byTopicPrevWeek.set(s.topicId, (byTopicPrevWeek.get(s.topicId) || 0) + s.sec);
  }

  let streak = 0;
  for (let d = byDay.has(dayKey(today)) ? today : today - DAY; byDay.get(dayKey(d)) > 0; d -= DAY) streak++;

  const topics = levelTopics(level).map((t) => {
    const items = t.items.filter((i) => !i.deleted);
    return {
      topic: t,
      ticker: tickerOf(t),
      sec: byTopic.get(t.id) || 0,
      week: byTopicWeek.get(t.id) || 0,
      prevWeek: byTopicPrevWeek.get(t.id) || 0,
      done: items.filter((i) => i.done).length,
      total: items.length,
    };
  });

  return {
    sessions,
    total,
    verified,
    week,
    today: byDay.get(dayKey(today)) || 0,
    streak,
    byDay,
    topics,
    generalSec: byTopic.get('') || 0,
    // General study (no topic) as its own row. Kept out of `topics` so it
    // never affects module progress or analyst ratings.
    general: {
      topic: GENERAL,
      ticker: 'GEN',
      sec: byTopic.get('') || 0,
      week: byTopicWeek.get('') || 0,
      prevWeek: byTopicPrevWeek.get('') || 0,
      done: 0,
      total: 0,
      general: true,
    },
  };
}

// Timestamp at which each whole hour was completed, in order.
export function hourStamps(sessions) {
  const sorted = [...sessions].sort((a, b) => a.start - b.start);
  const stamps = [];
  let acc = 0;
  for (const s of sorted) {
    const before = acc;
    acc += s.sec;
    for (let h = Math.floor(before / 3600) + 1; h <= Math.floor(acc / 3600); h++) {
      const into = h * 3600 - before;
      stamps.push(s.start + (into / s.sec) * (s.end - s.start || s.sec * 1000));
    }
  }
  return stamps;
}

// ---------- Practice scores ("earnings") ----------
export function levelScores(level = currentLevel()) {
  return (store.doc.scores || []).filter((r) => !r.deleted && (r.level || 1) === level && r.total > 0);
}

export const pct = (r) => (r.correct / r.total) * 100;

// Aggregate accuracy over reports, optionally since a timestamp.
export function accuracy(reports, since = 0) {
  let correct = 0, total = 0;
  for (const r of reports) if (r.date >= since) { correct += r.correct; total += r.total; }
  return { correct, total, pct: total ? (correct / total) * 100 : null };
}
