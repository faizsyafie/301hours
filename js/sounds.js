// Small synthesized sounds: an exchange opening bell, a cash register, a
// news-flash fanfare. No audio files needed.
let ctx = null;

function audio() {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.2, decay = dur } = {}) {
  const a = audio();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = a.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(start, dur, gain = 0.15) {
  const a = audio();
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  const g = a.createGain();
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 2500;
  src.buffer = buf;
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(a.currentTime + start);
}

// A struck bell: a fundamental plus inharmonic partials, rung three times.
function bell(start) {
  for (const [ratio, gain] of [[1, 0.22], [2.76, 0.08], [5.4, 0.04]]) tone(880 * ratio, start, 1.6, { gain, decay: 1.6 });
}

const SOUNDS = {
  open() { bell(0); bell(0.35); bell(0.7); },
  register() {
    noise(0, 0.08, 0.2);
    tone(2093, 0.09, 0.9, { gain: 0.16, decay: 0.9 });
    tone(2637, 0.16, 1.1, { gain: 0.14, decay: 1.1 });
  },
  close() { tone(660, 0, 0.5, { type: 'triangle', gain: 0.15 }); tone(440, 0.22, 0.8, { type: 'triangle', gain: 0.15 }); },
  breaking() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.5, { type: 'square', gain: 0.06, decay: 0.45 }));
    tone(1047, 0.5, 1.2, { type: 'square', gain: 0.05, decay: 1.2 });
  },
};

export function play(name) {
  try { SOUNDS[name]?.(); } catch { /* audio unavailable */ }
}
