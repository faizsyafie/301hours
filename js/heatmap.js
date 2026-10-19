// Topic heatmap: a treemap of tiles sized by hours studied and coloured by the
// week-on-week change (green = more than the week before, red = less).
import { esc } from './util.js';
import { weightMid } from './ratings.js';

// Squarified treemap (Bruls et al.) into the rect {x, y, w, h}.
function squarify(items, rect) {
  const out = [];
  let { x, y, w, h } = rect;
  let rest = items.slice();
  const total = rest.reduce((a, i) => a + i.value, 0) || 1;
  const scale = (w * h) / total;
  rest = rest.map((i) => ({ ...i, area: i.value * scale }));

  const worst = (row, side) => {
    const sum = row.reduce((a, r) => a + r.area, 0);
    const max = Math.max(...row.map((r) => r.area));
    const min = Math.min(...row.map((r) => r.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  while (rest.length) {
    const side = Math.min(w, h);
    let row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
    rest = rest.slice(i);
    const sum = row.reduce((a, r) => a + r.area, 0);
    if (w >= h) {
      const cw = sum / h;
      let cy = y;
      for (const r of row) { const ch = r.area / cw; out.push({ ...r, x, y: cy, w: cw, h: ch }); cy += ch; }
      x += cw; w -= cw;
    } else {
      const ch = sum / w;
      let cx = x;
      for (const r of row) { const cw = r.area / ch; out.push({ ...r, x: cx, y, w: cw, h: ch }); cx += cw; }
      y += ch; h -= ch;
    }
  }
  return out;
}

export function heatmapPanel(topics) {
  const totalSec = topics.reduce((a, t) => a + t.sec, 0);
  const byWeight = totalSec === 0;
  const items = topics.map((t) => ({
    t,
    value: byWeight ? (weightMid(t.topic.weight) || 5) : Math.max(t.sec, totalSec * 0.015),
    delta: (t.week - t.prevWeek) / 3600,
  })).sort((a, b) => b.value - a.value);
  const maxDelta = Math.max(0.5, ...items.map((i) => Math.abs(i.delta)));
  const W = 200, H = 100;
  const tiles = squarify(items, { x: 0, y: 0, w: W, h: H }).map((r) => {
    const k = Math.min(1, Math.abs(r.delta) / maxDelta);
    const tone = Math.abs(r.delta) < 0.05 ? 'flat' : r.delta > 0 ? 'up' : 'down';
    const sign = tone === 'flat' ? '■ 0.0' : `${r.delta > 0 ? '▲ +' : '▼ −'}${Math.abs(r.delta).toFixed(1)}`;
    const big = r.w * r.h > 600;
    return `<div class="tile-h ${tone}" style="left:${(r.x / W) * 100}%;top:${(r.y / H) * 100}%;width:${(r.w / W) * 100}%;height:${(r.h / H) * 100}%;--k:${(0.25 + k * 0.6).toFixed(2)}"
      title="${esc(r.t.topic.name)} · ${(r.t.sec / 3600).toFixed(1)}h total · ${(r.t.week / 3600).toFixed(1)}h last 7 days (${sign}h vs the 7 before)">
      <span class="th-tk">${esc(r.t.ticker)}</span>
      ${big ? `<span class="th-h">${(r.t.sec / 3600).toFixed(1)}H</span>` : ''}
      <span class="th-d">${sign}</span>
    </div>`;
  }).join('');
  return `
    <section class="panel">
      <div class="phead"><span>HEATMAP</span><span class="muted">${byWeight ? 'SIZED BY EXAM WEIGHT UNTIL YOU LOG HOURS' : 'SIZE = HOURS · COLOUR = 7D CHANGE (H)'}</span></div>
      <div class="heat">${tiles}</div>
    </section>`;
}
