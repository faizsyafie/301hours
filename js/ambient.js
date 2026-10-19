// Focus sounds: generated ambience that plays during study blocks and fades
// out on breaks and pauses. No audio files; everything is synthesized.
//   brown  - deep, even noise
//   rain   - soft hiss with scattered droplets
//   floor  - a distant trading-floor murmur with the odd phone and keyboard
import { timer, onTimer } from './timer.js';

const KEY = '301hours:ambient';
export const MODES = { off: 'OFF', brown: 'BROWN NOISE', rain: 'RAIN', floor: 'TRADING FLOOR' };

let prefs = { mode: 'off', volume: 40 };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }

let ctx = null, master = null, voice = null, playing = false;

export const ambient = {
  get mode() { return prefs.mode; },
  get volume() { return prefs.volume; },
  get playing() { return playing; },
};

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(kind, seconds = 6) {
  const a = audio();
  const buf = a.createBuffer(2, a.sampleRate * seconds, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.5;
      } else {
        // pink-ish (Paul Kellet, economy version)
        b0 = 0.99765 * b0 + white * 0.099;
        b1 = 0.963 * b1 + white * 0.2965;
        b2 = 0.57 * b2 + white * 1.0526;
        d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
      }
    }
  }
  return buf;
}

function loop(buffer, out) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(out);
  src.start();
  return src;
}

function filter(type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// Short filtered noise burst (droplet, key click).
function burst(out, { freq, q = 4, gain = 0.2, dur = 0.04 }) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = burst.buf ||= noiseBuffer('white', 0.2);
  const f = filter('bandpass', freq, q);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.1);
  src.stop(t + dur + 0.02);
}

function ring(out) {
  // A faraway desk phone: two short warbling tones.
  const t = ctx.currentTime;
  for (const [start, len] of [[0, 0.35], [0.5, 0.35]]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1100 + Math.random() * 300;
    g.gain.setValueAtTime(0.0001, t + start);
    g.gain.exponentialRampToValueAtTime(0.012, t + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + start + len);
    o.connect(g).connect(out);
    o.start(t + start);
    o.stop(t + start + len + 0.05);
  }
}

function build(mode) {
  const out = ctx.createGain();
  out.connect(master);
  const nodes = [out];
  const timers = [];
  if (mode === 'brown') {
    nodes.push(loop(noiseBuffer('brown'), out));
  } else if (mode === 'rain') {
    const hiss = filter('highpass', 900);
    const soft = filter('lowpass', 7000);
    hiss.connect(soft).connect(out);
    nodes.push(loop(noiseBuffer('pink'), hiss));
    timers.push(setInterval(() => {
      for (let i = 0; i < 3; i++) if (Math.random() < 0.6) burst(out, { freq: 2500 + Math.random() * 4000, q: 6, gain: 0.05 + Math.random() * 0.08, dur: 0.02 + Math.random() * 0.03 });
    }, 90));
  } else if (mode === 'floor') {
    const murmur = filter('bandpass', 420, 0.6);
    const g = ctx.createGain();
    g.gain.value = 0.8;
    murmur.connect(g).connect(out);
    nodes.push(loop(noiseBuffer('brown'), murmur));
    // Slow swell, like a room of voices rising and falling.
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.07;
    depth.gain.value = 0.25;
    lfo.connect(depth).connect(g.gain);
    lfo.start();
    nodes.push(lfo);
    timers.push(setInterval(() => {
      if (Math.random() < 0.35) for (let i = 0; i < 2 + Math.floor(Math.random() * 6); i++) setTimeout(() => burst(out, { freq: 1800 + Math.random() * 1200, q: 3, gain: 0.03, dur: 0.025 }), i * (70 + Math.random() * 60));
    }, 1300));
    timers.push(setInterval(() => { if (Math.random() < 0.25) ring(out); }, 9000));
  }
  return { nodes, timers };
}

function teardown(v) {
  if (!v) return;
  v.timers.forEach(clearInterval);
  for (const n of v.nodes) { try { n.stop?.(); } catch { /* already stopped */ } try { n.disconnect(); } catch { /* ignore */ } }
}

function level() {
  return (prefs.volume / 100) ** 2 * 0.6;
}

function fadeTo(value, seconds = 1.2) {
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(value, t + seconds);
}

// Plays only while a study block is running.
function sync() {
  const want = prefs.mode !== 'off' && timer.running && timer.phase === 'study';
  if (want === playing && (!want || voice?.mode === prefs.mode)) return;
  if (want) {
    audio();
    if (voice?.mode !== prefs.mode) {
      const old = voice;
      voice = { mode: prefs.mode, ...build(prefs.mode) };
      if (old) setTimeout(() => teardown(old), 1300);
    }
    fadeTo(level());
    playing = true;
  } else if (ctx) {
    fadeTo(0);
    playing = false;
    const v = voice;
    setTimeout(() => { if (!playing && voice === v) { teardown(v); voice = null; } }, 1400);
  }
}

export function setMode(mode) {
  prefs.mode = MODES[mode] ? mode : 'off';
  save();
  sync();
}

export function setVolume(v) {
  prefs.volume = Math.max(0, Math.min(100, Number(v) || 0));
  save();
  if (playing) fadeTo(level(), 0.15);
}

// Preview the current sound for a few seconds, e.g. while choosing one.
export function preview() {
  if (prefs.mode === 'off' || playing) return;
  audio();
  if (voice?.mode !== prefs.mode) { teardown(voice); voice = { mode: prefs.mode, ...build(prefs.mode) }; }
  fadeTo(level(), 0.4);
  setTimeout(() => { if (!playing) fadeTo(0, 0.8); }, 3500);
}

onTimer(sync);
