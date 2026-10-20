// Colour themes, saved per device (a laptop by day and a phone at night can differ).
const KEY = '301hours:skin';
export const SKINS = [
  ['amber', 'AMBER', '#0b0b0a', '#ffb000'],
  ['green', 'PHOSPHOR', '#050a06', '#39ff7a'],
  ['blue', 'REUTERS', '#070b12', '#4da3ff'],
  ['paper', 'PAPER', '#f3efe4', '#a85f00'],
];

export function currentSkin() {
  try { return localStorage.getItem(KEY) || 'amber'; } catch { return 'amber'; }
}

export function setSkin(name) {
  try { localStorage.setItem(KEY, name); } catch { /* ignore */ }
  if (name === 'amber') delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = name;
  const bg = SKINS.find(([k]) => k === name)?.[2] || '#0b0b0a';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export function skinPicker() {
  const cur = currentSkin();
  return `<div class="skins">${SKINS.map(([k, label, bg, fg]) => `<button type="button" class="skin" data-skin="${k}" aria-pressed="${k === cur}" style="--sw-bg:${bg};--sw-fg:${fg}"><i></i>${label}</button>`).join('')}</div>`;
}
