// End-of-block sequence: the wrap-up (if on), then — in gate mode — the
// flashcard gate. The break's clock only starts once the gate is cleared.
import { store, save } from './store.js';
import { timer, onBlockEnd, onGateRequest, setGateSource, unlockGate } from './timer.js';
import { showWrapUp } from './wrapup.js';
import { cardMode, cardsFor, mountReview } from './cards.js';
import { toast } from './toast.js';

setGateSource(() => {
  const s = store.doc.settings;
  return cardMode() === 'gate' && cardsFor(undefined).length ? Math.max(1, Math.min(5, s.gateCount || 1)) : 0;
});

function markSession(sessionId, fields) {
  const s = store.doc.sessions.find((x) => x.id === sessionId);
  if (s) { Object.assign(s, fields, { u: Date.now() }); save(); }
}

export function showGate() {
  const g = timer.gate;
  if (!g || document.querySelector('dialog.gate')) return;
  const strict = store.doc.settings.gateStrict === true;
  let answered = 0;
  const dlg = document.createElement('dialog');
  dlg.className = 'tdialog wide gate';
  dlg.innerHTML = `
    <div class="gate-head"><span class="gate-lock">◆ BREAK LOCKED</span><span class="muted small">${strict ? 'Get' : 'Answer'} ${g.need} card${g.need === 1 ? '' : 's'}${strict ? ' right' : ''} to start your break. The break clock hasn't started yet.</span></div>
    <div class="gate-cards"></div>
    <div class="row end"><button type="button" class="link small" data-gate="skip">skip gate (shows in your 10-K)</button></div>`;
  document.body.append(dlg);
  const finish = (skipped) => {
    markSession(g.sessionId, skipped ? { gateSkipped: true, gateCards: answered } : { gateCards: answered });
    dlg.close();
    unlockGate();
    if (!skipped) toast({ kind: 'break', title: '◆ BREAK UNLOCKED', body: timer.running ? 'Your break starts now.' : 'Press SPACE to start your break.', timeout: 5000 });
  };
  mountReview(dlg.querySelector('.gate-cards'), {
    title: 'GATE',
    topicId: () => store.doc.sessions.find((x) => x.id === g.sessionId)?.topicId || timer.topicId,
    allowRepeat: true,
    requeueMisses: strict,
    header: () => `${answered}/${g.need} ${strict ? 'RIGHT' : 'ANSWERED'}`,
    onGrade: (gotIt) => {
      if (!strict || gotIt) answered++;
      if (answered >= g.need) setTimeout(() => finish(false), 250);
    },
  });
  dlg.querySelector('[data-gate="skip"]').addEventListener('click', () => finish(true));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

// Block ends → wrap-up → gate.
onBlockEnd((block) => setTimeout(async () => {
  await showWrapUp(block);
  if (timer.gate) showGate();
}, 400));
onGateRequest(showGate);
