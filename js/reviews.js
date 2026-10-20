// Revision schedule ("maturity dates"). A module ticked as done comes back for
// review 1, 7 and 30 days later; after the third review it has matured.
import { store, save } from './store.js';
import { levelTopics, tickerOf, DAY } from './model.js';
import { startOfDay } from './util.js';

export const INTERVALS = [1, 7, 30];
export const STAGE_LABEL = ['1D', '7D', '30D'];

// Modules ticked before this feature existed have no schedule yet: start one.
export function revOf(item) {
  if (!item.done) return null;
  return item.rev || { stage: 0, due: (item.doneAt || Date.now()) + INTERVALS[0] * DAY, log: [] };
}

// Call when a module is ticked or unticked.
export function onDoneChange(item) {
  item.rev = item.done ? { stage: 0, due: item.doneAt + INTERVALS[0] * DAY, log: [] } : null;
}

export function markReviewed(item) {
  const rev = revOf(item);
  if (!rev || rev.due === null) return;
  const now = Date.now();
  const stage = rev.stage + 1;
  item.rev = { stage, due: stage < INTERVALS.length ? now + INTERVALS[stage] * DAY : null, log: [...(rev.log || []), now] };
  item.u = now;
}

export function snooze(item, days = 1) {
  const rev = revOf(item);
  if (!rev || rev.due === null) return;
  item.rev = { ...rev, due: startOfDay(Date.now()) + days * DAY + 12 * 3600000 };
  item.u = Date.now();
}

// Everything scheduled for this level: { due: [...], upcoming: [...] }.
export function schedule() {
  const endOfToday = startOfDay(Date.now()) + DAY;
  const due = [], upcoming = [];
  for (const t of levelTopics()) {
    for (const item of t.items) {
      if (item.deleted || !item.done) continue;
      const rev = revOf(item);
      if (!rev || rev.due === null) continue;
      const row = { topic: t, ticker: tickerOf(t), item, rev, stage: STAGE_LABEL[rev.stage] || '' };
      if (rev.due < endOfToday) due.push(row);
      else if (rev.due < endOfToday + 7 * DAY) upcoming.push(row);
    }
  }
  due.sort((a, b) => a.rev.due - b.rev.due);
  upcoming.sort((a, b) => a.rev.due - b.rev.due);
  return { due, upcoming };
}

// Reviews done since a timestamp (for the weekly report).
export function reviewsBetween(from, to = Infinity) {
  let n = 0;
  for (const t of levelTopics()) for (const item of t.items) for (const ts of item.rev?.log || []) if (ts >= from && ts < to) n++;
  return n;
}

export function findItem(topicId, itemId) {
  return store.doc.topics.find((t) => t.id === topicId)?.items.find((i) => i.id === itemId);
}

export function act(kind, topicId, itemId) {
  const item = findItem(topicId, itemId);
  if (!item) return;
  if (kind === 'reviewed') markReviewed(item);
  else if (kind === 'snooze') snooze(item);
  save();
}
