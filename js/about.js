import { panel } from './dialog.js';

const GITHUB = 'https://github.com/faizsyafie';
const REPO = 'https://github.com/faizsyafie/301hours';

const HTML = `
  <div class="about">
    <div class="about-hero">
      <span class="brand-box">301</span>
      <div>
        <div class="about-title">301 TERMINAL</div>
        <div class="muted small">A CFA study tracker. Your hours trade as <b class="tk">$CFA1–3</b>, and the market only opens while you're at the desk.</div>
      </div>
    </div>
    <ul class="about-list">
      <li><b>DASH</b> Hours, pace, 301-hour grid</li>
      <li><b>STUDY</b> Pomodoro + desk cam (video stays on device)</li>
      <li><b>TOPICS</b> Level I–III checklist + reviews</li>
      <li><b>EARNINGS</b> Practice scores: BEAT or MISS</li>
      <li><b>RATINGS</b> BUY/HOLD/TRIM, AAA–CCC, 10-K</li>
      <li><b>SYNC</b> Passcode-protected, every device</li>
    </ul>
    <div class="about-keys">
      <span><kbd>1</kbd>–<kbd>5</kbd> pages</span>
      <span><kbd>SPACE</kbd> open/halt</span>
      <span><kbd>S</kbd> skip</span>
      <span><kbd>R</kbd> reset</span>
      <span><kbd>P</kbd> pop out</span>
    </div>
    <div class="about-links">
      <a class="btn primary small" href="${GITHUB}" target="_blank" rel="noopener">GITHUB · @FAIZSYAFIE ↗</a>
      <a class="btn small" href="${REPO}" target="_blank" rel="noopener">SOURCE ↗</a>
    </div>
    <p class="muted small about-legal">Independent project, not affiliated with CFA Institute. CFA® is a trademark of CFA Institute.</p>
  </div>`;

export function showAbout() {
  return panel('ABOUT', HTML);
}

