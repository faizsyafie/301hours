// Terminal-style alerts that slide in at the top right and fade after a while.
import { esc } from './util.js';

const MAX = 3;
let box = null;

function container() {
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  return box;
}

// kind: 'study' | 'break' | 'warn' | 'info'
export function toast({ kind = 'info', title, body = '', timeout = 9000 }) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="toast-head"><span class="toast-title">${esc(title)}</span><span class="toast-time">${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</span><button type="button" class="toast-x" aria-label="Dismiss">✕</button></div>
    ${body ? `<div class="toast-body">${esc(body)}</div>` : ''}
    <div class="toast-bar" style="animation-duration:${timeout}ms"></div>`;
  const c = container();
  c.prepend(el);
  while (c.children.length > MAX) c.lastElementChild.remove();

  const close = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector('.toast-x').addEventListener('click', close);
  // The bar's animation is the countdown; hovering pauses both.
  el.querySelector('.toast-bar').addEventListener('animationend', close);
}
