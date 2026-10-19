// "Reset progress": clears logged hours, module ticks and reviews, practice
// scores, milestones and ratings for one level or all of them. Topic and module
// names, settings and the passcode are kept. Records are tombstoned (deleted +
// newer timestamp) rather than removed, so the reset syncs to other devices
// instead of being merged back from their older copies.
import { store, save } from './store.js';
import { levelOf, sessionLevel } from './model.js';
import { resetTimer } from './timer.js';

export function resetProgress(levels) {
  resetTimer();
  const now = Date.now();
  const inScope = (lvl) => levels.includes(lvl);
  let sessions = 0, modules = 0, scores = 0;

  for (const s of store.doc.sessions) {
    if (s.deleted || !inScope(sessionLevel(s))) continue;
    Object.assign(s, { deleted: true, u: now });
    sessions++;
  }
  for (const t of store.doc.topics) {
    if (!inScope(levelOf(t))) continue;
    for (const i of t.items) {
      if (!i.done && !i.rev) continue;
      Object.assign(i, { done: false, doneAt: null, rev: null, u: now });
      modules++;
    }
  }
  for (const r of store.doc.scores || []) {
    if (r.deleted || !inScope(r.level || 1)) continue;
    Object.assign(r, { deleted: true, u: now });
    scores++;
  }
  const st = store.doc.settings;
  st.celebrated = (st.celebrated || []).filter((k) => !inScope(Number(String(k).split(':')[0])));
  st.creditRatings = Object.fromEntries(Object.entries(st.creditRatings || {}).filter(([lvl]) => !inScope(Number(lvl))));
  st.u = now;
  save({ immediate: true });
  return { sessions, modules, scores };
}
