// In-page replacements for prompt(), confirm() and alert(), styled like the
// rest of the terminal. Each returns a promise.
import { esc } from './util.js';

function open({ title, body, input, okLabel = 'OK', cancelLabel = 'CANCEL', danger = false }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'tdialog';
  dlg.innerHTML = `
    <form method="dialog">
      <div class="phead"><span>${esc(title)}</span><span class="muted">ESC TO CANCEL</span></div>
      ${body ? `<p class="tdialog-body">${body}</p>` : ''}
      ${input ? `<label class="tdialog-field"><span class="prompt-caret">&gt;</span><input name="value" autocomplete="off" spellcheck="false"></label><p class="tdialog-hint muted small">${esc(input.hint || '')}</p>` : ''}
      <div class="row end">
        ${cancelLabel ? `<button value="cancel" formnovalidate class="btn">${esc(cancelLabel)}</button>` : ''}
        <button value="ok" class="btn ${danger ? 'danger-solid' : 'primary'}">${esc(okLabel)}</button>
      </div>
    </form>`;
  document.body.append(dlg);
  const field = dlg.querySelector('input');
  if (field) {
    field.value = input.value ?? '';
    if (input.maxLength) field.maxLength = input.maxLength;
    if (input.placeholder) field.placeholder = input.placeholder;
  }
  // Enter means OK (the browser would otherwise pick the first button, CANCEL).
  dlg.querySelector('form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      dlg.close('ok');
    }
  });
  dlg.showModal();
  if (field) { field.focus(); field.select(); }
  else dlg.querySelector('button[value="ok"]').focus();

  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      resolve({ ok, value: field ? field.value : '' });
      dlg.remove();
    });
  });
}

// Resolves to the entered text, or null if cancelled.
export async function ask(title, { value = '', hint = '', placeholder = '', maxLength, okLabel = 'SAVE' } = {}) {
  const r = await open({ title, input: { value, hint, placeholder, maxLength }, okLabel });
  return r.ok ? r.value : null;
}

// Resolves to true if confirmed. `message` is plain text.
export async function confirmBox(title, message, { okLabel = 'CONFIRM', danger = false } = {}) {
  return (await open({ title, body: esc(message), okLabel, danger })).ok;
}

export async function notice(title, message) {
  await open({ title, body: esc(message), okLabel: 'OK', cancelLabel: '' });
}
