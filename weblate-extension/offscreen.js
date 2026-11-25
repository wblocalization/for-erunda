/* Звуки уведомлений. Service worker сам играть звук не умеет, поэтому играем здесь,
   в скрытом offscreen-документе. Звуки синтезируются Web Audio, файлов нет. */
let ctx = null;
const ac = () => (ctx = ctx || new AudioContext());

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(out, type, f0, f1, t, a, peak, d) {
  const c = ac(), o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
  env(g, t, a, peak, d);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + a + d + 0.05);
}

/* кряк: пила с падающим тоном через «носовые» форманты */
function quack(out, t) {
  const c = ac(), o = c.createOscillator(), g = c.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(560, t);
  o.frequency.linearRampToValueAtTime(470, t + 0.05);
  o.frequency.exponentialRampToValueAtTime(330, t + 0.17);
  const vib = c.createOscillator(), vg = c.createGain();
  vib.frequency.value = 38; vg.gain.value = 18;
  vib.connect(vg).connect(o.frequency);
  const mix = c.createGain(); mix.gain.value = 1;
  [[1100, 6, 1], [2500, 8, 0.55], [600, 4, 0.5]].forEach(([f, q, v]) => {
    const bp = c.createBiquadFilter(), bg = c.createGain();
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; bg.gain.value = v;
    o.connect(bp).connect(bg).connect(mix);
  });
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(1.5, t + 0.015);
  g.gain.setValueAtTime(1.5, t + 0.09);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
  mix.connect(g).connect(out);
  o.start(t); vib.start(t); o.stop(t + 0.22); vib.stop(t + 0.22);
}

/* голос: пила/квадрат с кривой тона и полосовыми фильтрами-формантами (кривая форманты — [[время, частота], …]) */
function voice(out, t, dur, type, pitch, formants, peak) {
  const c = ac(), o = c.createOscillator(), g = c.createGain();
  o.type = type;
  pitch.forEach(([dt, f], i) => i ? o.frequency.exponentialRampToValueAtTime(f, t + dt) : o.frequency.setValueAtTime(f, t + dt));
  formants.forEach(([curve, q, v]) => {
    const bp = c.createBiquadFilter(), bg = c.createGain();
    bp.type = 'bandpass'; bp.Q.value = q; bg.gain.value = v;
    curve.forEach(([dt, f], i) => i ? bp.frequency.exponentialRampToValueAtTime(f, t + dt) : bp.frequency.setValueAtTime(f, t + dt));
    o.connect(bp).connect(bg).connect(g);
  });
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
  g.gain.setValueAtTime(peak, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(out, t, dur, freq, q, peak) {
  const c = ac(), n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
  s.buffer = b; bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  env(g, t, 0.005, peak, dur);
  s.connect(bp).connect(g).connect(out); s.start(t);
}

const SOUNDS = {
  quack(out, t) { quack(out, t); quack(out, t + 0.24); },
  ding(out, t) { tone(out, 'sine', 1319, 1319, t, 0.005, 0.5, 1.2); tone(out, 'sine', 2637, 2637, t, 0.005, 0.15, 0.6); },
  pop(out, t) { tone(out, 'sine', 900, 180, t, 0.004, 0.8, 0.09); },
  coin(out, t) { tone(out, 'square', 988, 988, t, 0.003, 0.4, 0.08); tone(out, 'square', 1319, 1319, t + 0.08, 0.003, 0.4, 0.4); },
  meow(out, t) { voice(out, t, 0.75, 'sawtooth', [[0, 620], [0.25, 860], [0.75, 520]], [[[[0, 2600], [0.3, 1500], [0.75, 700]], 5, 1.4], [[[0, 3200], [0.75, 2400]], 7, 0.5]], 1.6); },
  frog(out, t) { [0, 0.3].forEach((d) => voice(out, t + d, 0.2, 'square', [[0, 110], [0.2, 85]], [[[[0, 700], [0.2, 450]], 3, 1.6], [[[0, 1600]], 5, 0.5]], 1.4)); },
  moo(out, t) { voice(out, t, 1.1, 'sawtooth', [[0, 150], [0.3, 170], [1.1, 115]], [[[[0, 300], [0.4, 600], [1.1, 350]], 2, 2.2]], 0.75); },
  woof(out, t) { [0, 0.28].forEach((d) => { voice(out, t + d, 0.16, 'sawtooth', [[0, 420], [0.16, 260]], [[[[0, 900], [0.16, 600]], 3, 1.8]], 1.3); noise(out, t + d, 0.06, 1200, 1, 0.25); }); },
  boing(out, t) {
    const c = ac(), o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.08);
    lfo.frequency.setValueAtTime(14, t); lfo.frequency.linearRampToValueAtTime(6, t + 0.7);
    lg.gain.setValueAtTime(90, t); lg.gain.exponentialRampToValueAtTime(5, t + 0.7);
    lfo.connect(lg).connect(o.frequency); env(g, t, 0.005, 0.8, 0.7);
    o.connect(g).connect(out); o.start(t); lfo.start(t); o.stop(t + 0.75); lfo.stop(t + 0.75);
  },
  laser(out, t) { [0, 0.18].forEach((d) => tone(out, 'sawtooth', 2200, 180, t + d, 0.003, 0.9, 0.16)); },
  sad(out, t) {
    [[392, 0], [370, 0.38], [349, 0.76]].forEach(([f, d]) => voice(out, t + d, 0.34, 'sawtooth', [[0, f], [0.34, f * 0.97]], [[[[0, 900], [0.17, 1300], [0.34, 800]], 2, 1.5]], 0.9));
    const c = ac(), o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(), bp = c.createBiquadFilter();
    const s = t + 1.14; o.type = 'sawtooth'; o.frequency.setValueAtTime(330, s); o.frequency.linearRampToValueAtTime(311, s + 1.1);
    lfo.frequency.value = 6; lg.gain.value = 9; lfo.connect(lg).connect(o.frequency);
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(1200, s); bp.frequency.exponentialRampToValueAtTime(600, s + 1.1); bp.Q.value = 2;
    env(g, s, 0.03, 1.4, 1.1); o.connect(bp).connect(g).connect(out); o.start(s); lfo.start(s); o.stop(s + 1.2); lfo.stop(s + 1.2);
  },
  robot(out, t) { [880, 660, 1175, 523, 988, 784].forEach((f, i) => tone(out, 'square', f, f, t + i * 0.075, 0.002, 0.7, 0.06)); },
  tada(out, t) { [523, 659, 784, 1047].forEach((f, i) => tone(out, 'triangle', f, f, t + i * 0.09, 0.008, 0.7, i === 3 ? 0.7 : 0.18)); }
};

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'wlx-play-sound' || !SOUNDS[msg.sound]) return;
  const c = ac(), out = c.createGain();
  out.gain.value = 0.7;
  out.connect(c.destination);
  c.resume().then(() => SOUNDS[msg.sound](out, c.currentTime + 0.03));
});
