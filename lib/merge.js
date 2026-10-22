// Merges two copies of the study data (e.g. this device vs. the server).
// Every topic, module and session carries `u` (last-modified ms); the newer copy
// of each wins, so edits made on different devices don't overwrite each other.
// Deletions are kept as `deleted: true` tombstones so they survive a merge.
// Shared by the browser and the /api/data function.

function newer(a, b) {
  return (b.u || 0) >= (a.u || 0) ? b : a;
}

function mergeById(a = [], b = [], mergeChildren) {
  const out = new Map();
  for (const x of a) out.set(x.id, x);
  for (const y of b) {
    const x = out.get(y.id);
    if (!x) { out.set(y.id, y); continue; }
    const win = newer(x, y);
    out.set(y.id, mergeChildren ? { ...win, items: mergeChildren(x.items, y.items) } : win);
  }
  return [...out.values()];
}

const byOrder = (p, q) => (p.o ?? 0) - (q.o ?? 0);

export function mergeDocs(a, b) {
  if (!a) return b;
  if (!b) return a;
  const topics = mergeById(a.topics, b.topics, (x, y) => mergeById(x, y).sort(byOrder)).sort(byOrder);
  const sessions = mergeById(a.sessions, b.sessions).sort((p, q) => p.start - q.start);
  const scores = mergeById(a.scores, b.scores).sort((p, q) => p.date - q.date);
  const cards = mergeById(a.cards, b.cards);
  return {
    v: 1,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
    settings: { ...a.settings, ...newer(a.settings || {}, b.settings || {}) },
    topics,
    sessions,
    scores,
    cards,
  };
}
