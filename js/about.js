import { panel } from './dialog.js';

const GITHUB = 'https://github.com/faizsyafie';
const REPO = 'https://github.com/faizsyafie/301hours';
const SEEN_KEY = '301hours:aboutSeen';

const HTML = `
  <div class="about">
    <div class="about-hero">
      <span class="brand-box">301</span>
      <div>
        <div class="about-title">301 TERMINAL</div>
        <div class="muted small">A study tracker for CFA candidates.</div>
      </div>
    </div>
    <p>CFA Institute suggests 300+ hours of study per level. This tool banks every one of them, and the 301st too. Your hours trade as <b class="tk">$CFA1</b>, <b class="tk">$CFA2</b> or <b class="tk">$CFA3</b>, and the market only opens while you're actually at the desk.</p>
    <ul class="about-list">
      <li><b>DASH</b> Hours banked, pace needed for exam day, the 301-square hour grid and milestones.</li>
      <li><b>STUDY</b> Pomodoro timer with a desk cam: the clock only runs while you're in frame. Video never leaves your device.</li>
      <li><b>TOPICS</b> The Level I–III curriculum as a checklist you can rename, re-ticker and extend.</li>
      <li><b>SYNC</b> Passcode-protected, so your progress follows you across devices.</li>
    </ul>
    <div class="about-keys">
      <span><kbd>1</kbd>–<kbd>4</kbd> pages</span>
      <span><kbd>SPACE</kbd> open / halt</span>
      <span><kbd>S</kbd> skip</span>
      <span><kbd>R</kbd> reset</span>
      <span><kbd>?</kbd> this screen</span>
    </div>
    <div class="about-links">
      <a class="btn primary" href="${GITHUB}" target="_blank" rel="noopener">GITHUB · @FAIZSYAFIE ↗</a>
      <a class="btn" href="${REPO}" target="_blank" rel="noopener">SOURCE CODE ↗</a>
    </div>
    <p class="muted small about-legal">Independent project, not affiliated with or endorsed by CFA Institute. CFA® is a trademark of CFA Institute.</p>
  </div>`;

export function showAbout() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
  return panel('ABOUT', HTML);
}

// Show the intro once, on someone's first visit.
export function showAboutOnce() {
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* ignore */ }
  if (!seen) showAbout();
}
