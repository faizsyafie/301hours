// Topic heatmap: a treemap shaped like the exam. Each tile's size is the
// topic's exam weight; its colour is the hours you've logged on it (one amber
// scale, dark = little, bright = a lot). A big dark tile is a big part of the
// exam you haven't covered yet. Hours and the 7-day change are written on each
// tile, so nothing depends on colour alone.
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

const fmtDelta = (d) => (Math.abs(d) < 0.05 ? '■ 0.0' : `${d > 0 ? '▲ +' : '▼ −'}${Math.abs(d).toFixed(1)}`);

// `general` is the GEN row from stats(). It has no exam weight, so it is listed
// under the map rather than drawn as a tile.
export function heatmapPanel(topics, general = null) {
  const weighted = topics.filter((t) => weightMid(t.topic.weight) !== null);
  const unweighted = topics.filter((t) => weightMid(t.topic.weight) === null);
  const maxSec = Math.max(...topics.map((t) => t.sec), general?.sec || 0, 1);
  const items = weighted.map((t) => ({ t, value: weightMid(t.topic.weight) })).sort((a, b) => b.value - a.value);
  const weightSum = items.reduce((a, i) => a + i.value, 0) || 1;
  const W = 200, H = 100;
  const tiles = squarify(items, { x: 0, y: 0, w: W, h: H }).map((r) => {
    const k = r.t.sec / maxSec;
    const delta = (r.t.week - r.t.prevWeek) / 3600;
    const big = r.w * r.h > 600;
    const examPct = Math.round((r.value / weightSum) * 100);
    return `<div class="tile-h${k > 0.55 ? ' bright' : ''}${r.t.sec === 0 ? ' empty' : ''}" style="left:${(r.x / W) * 100}%;top:${(r.y / H) * 100}%;width:${(r.w / W) * 100}%;height:${(r.h / H) * 100}%;--k:${(0.08 + k * 0.92).toFixed(2)}"
      title="${esc(r.t.topic.name)} · ~${examPct}% of the exam · ${(r.t.sec / 3600).toFixed(1)}h logged · ${fmtDelta(delta)}h last 7 days vs the 7 before">
      <span class="th-tk">${esc(r.t.ticker)}</span>
      <span class="th-h">${(r.t.sec / 3600).toFixed(1)}H</span>
      ${big ? `<span class="th-w">~${examPct}% OF EXAM</span>` : ''}
      <span class="th-d">${fmtDelta(delta)}</span>
    </div>`;
  }).join('');
  const extra = unweighted.map((t) => `<span><b>${esc(t.ticker)}</b> ${(t.sec / 3600).toFixed(1)}H <span class="muted">· no exam weight set</span></span>`);
  // GEN gets its own tile outside the exam-shaped map (it has no exam weight),
  // coloured on the same hours scale.
  const g = general || { sec: 0, week: 0, prevWeek: 0 };
  const gk = g.sec / maxSec;
  const genTile = `
      <div class="tile-h gen-tile${gk > 0.55 ? ' bright' : ''}${g.sec === 0 ? ' empty' : ''}" style="--k:${(0.08 + gk * 0.92).toFixed(2)}"
        title="General study (no topic) · ${(g.sec / 3600).toFixed(1)}h logged · counts towards your total, not part of the exam weights">
        <span class="th-tk">GEN</span>
        <span class="th-h">${(g.sec / 3600).toFixed(1)}H</span>
        <span class="th-w">GENERAL STUDY · NO TOPIC · NOT IN EXAM WEIGHTS</span>
        <span class="th-d">${fmtDelta((g.week - g.prevWeek) / 3600)}</span>
      </div>`;
  return `
    <section class="panel">
      <div class="phead"><span>HEATMAP</span><span class="muted">SIZE = EXAM WEIGHT · COLOUR = HOURS LOGGED</span></div>
      <div class="heat">${tiles || '<p class="note">Set exam weights on your topics to draw the map.</p>'}</div>
      ${genTile}
      <div class="heat-foot">
        <span class="heat-legend"><span class="muted">0H</span><span class="heat-ramp"></span><span class="muted">${(maxSec / 3600).toFixed(1)}H</span></span>
        ${extra.length ? `<span class="heat-extra">${extra.join('')}</span>` : ''}
      </div>
    </section>`;
}
