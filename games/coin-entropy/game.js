'use strict';

/* ---------------- math ---------------- */

function entropyBits(p) {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

// Inverse of entropyBits on [0, 0.5], by bisection (H is monotonic there).
function biasForEntropy(h) {
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (entropyBits(mid) < h) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ---------------- rng (seedable so ?demo screenshots reproduce) ---------------- */

let rand = Math.random;
function seedRand(seed) {
  let s = seed >>> 0;
  rand = () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ---------------- state ---------------- */

const state = {
  coin: null,            // { p, H } — p is P(heads)
  options: [],           // three candidate entropies; one is the coin's
  heads: 0,
  tails: 0,
  tries: 0,              // wrong picks this round
  locked: false,
};

// The first two rounds are a curriculum: the poles of the curve, guaranteed.
// Round 1: the perfectly fair coin (exactly 1 bit). Round 2: a one-sided coin
// (0 bits). After that, coins are random with both anchors recurring.
const curriculum = ['fair', 'onesided'];

// Random coins sample the target *entropy* uniformly, then invert to a bias.
// Sampling the bias uniformly would make almost every coin look near-fair
// (H > 0.9 for p in .32–.68).
function newCoin() {
  const special = curriculum.shift();
  if (special === 'fair' || (!special && rand() < 0.1)) return { p: 0.5, H: 1 };
  if (special === 'onesided' || (!special && rand() < 0.06)) {
    return { p: rand() < 0.5 ? 0 : 1, H: 0 };
  }
  let p = biasForEntropy(rand());
  if (rand() < 0.5) p = 1 - p;
  p = Math.round(p * 1000) / 1000;
  return { p, H: entropyBits(p) };
}

// Three answers: the truth plus two distractors — one nearer, one far —
// all ≥ 0.1 bits apart so the choices never crowd each other.
function makeOptions(H) {
  const sep = 0.1;
  const r2 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
  const vals = [r2(H)];
  const bands = [[0.12, 0.2], [0.28, 0.45]];
  for (const [lo, hi] of bands) {
    const off = lo + rand() * (hi - lo);
    const sign = rand() < 0.5 ? -1 : 1;
    let v = null;
    for (const s of [sign, -sign]) {
      const c = r2(H + s * off);
      if (vals.every((x) => Math.abs(x - c) >= sep)) { v = c; break; }
    }
    for (let step = lo; v === null && step <= 1.2; step += 0.06) {
      for (const s of [1, -1]) {
        const c = r2(H + s * step);
        if (vals.every((x) => Math.abs(x - c) >= sep)) { v = c; break; }
      }
    }
    if (v !== null) vals.push(v);
  }
  for (let i = vals.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [vals[i], vals[j]] = [vals[j], vals[i]];
  }
  return vals;
}

/* ---------------- dom ---------------- */

const $ = (id) => document.getElementById(id);
const els = {
  coin: $('coin'), coinWob: $('coin-wob'), strip: $('strip'), tallySr: $('tally-sr'),
  tallyBar: $('tally-bar'), tallyPct: $('tally-pct'),
  segH: $('seg-h'), segT: $('seg-t'), pctH: $('pct-h'), pctT: $('pct-t'),
  answers: $('answers'),
  revealPanel: $('reveal-panel'),
  verdict: $('verdict'), verdictSub: $('verdict-sub'),
  chipCoin: $('chip-coin'), chipTrue: $('chip-true'), chipFlips: $('chip-flips'),
  chart: $('chart'), legendObs: $('legend-obs'),
  insight: $('insight'), mathline: $('mathline'), noise: $('noise'), moreMath: $('more-math'),
  next: $('next'), tryNote: $('try-note'),
};

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- sound (synthesized — no assets) ---------------- */

let actx = null;
let noiseBuf = null;

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!actx) {
    actx = new AC();
    noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.06), actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(freq, dur, { type = 'sine', gain = 0.15, at = 0, glide } = {}) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function thud(at = 0) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  s.connect(g).connect(ctx.destination);
  s.start(t);
}

function sfxFlick() { tone(2400, 0.05, { type: 'triangle', gain: 0.06 }); }

// heads and tails land on different notes — you can hear the bias
function sfxLand(isHeads) {
  const f = isHeads ? 1318.5 : 880;   // E6 vs A5
  tone(f, 0.35, { type: 'triangle', gain: 0.14 });
  tone(f * 1.5, 0.22, { type: 'sine', gain: 0.07 });
}

function sfxStamp() {
  thud();
  tone(150, 0.15, { gain: 0.2 });
}

function sfxCorrect() {
  // rising major sparkle
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    tone(f, 0.28, { type: 'triangle', gain: 0.1, at: 0.35 + i * 0.09 }));
}

function sfxWrong() {
  // a gentle womp-womp: falling tritone, second note bending down
  tone(311.13, 0.16, { type: 'triangle', gain: 0.12, at: 0.02 });
  tone(233.08, 0.4, { type: 'triangle', gain: 0.14, at: 0.2, glide: 196 });
}

/* ---------------- coin faces ---------------- */

const COIN_FACES = {
  '?': '<span class="coin-glyph">?</span>',
  H: '<svg class="coin-icon" viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="12" cy="8.6" r="4.4"/><path d="M4.2 20.5a7.8 6.6 0 0 1 15.6 0z"/></svg>'
    + '<span class="coin-cap">Shannon</span>',
  T: '<svg class="coin-icon" viewBox="0 0 24 24" aria-hidden="true">'
    + '<polygon points="12,2 14.47,8.6 21.51,8.91 15.99,13.3 17.88,20.09 12,16.2 6.12,20.09 8.01,13.3 2.49,8.91 9.53,8.6"/></svg>'
    + '<span class="coin-cap">1948</span>',
};

// 'V' is the assay face: the coin's true worth, stamped at reveal.
function setCoinFace(face, stampValue) {
  els.coin.innerHTML = face === 'V'
    ? `<span class="coin-value">${stampValue}</span><span class="coin-cap">bits per flip</span>`
    : COIN_FACES[face];
  els.coin.classList.toggle('face-t', face === 'T');
}

// The coin fidgets in proportion to the entropy its observed flips imply.
function setRestlessness() {
  const n = state.heads + state.tails;
  const wob = !state.locked && n ? entropyBits(state.heads / n) : 0;
  els.coinWob.style.setProperty('--wob', wob.toFixed(3));
}

/* ---------------- formatting ---------------- */

const fmtPct = (p) => (Math.round(p * 1000) / 10).toFixed(1).replace(/\.0$/, '') + '%';
const fmtBits = (h, dp = 2) => h.toFixed(dp);

/* ---------------- flipping: press to spin, release to coast and land ---------------- */

const SPIN_MAX = 1500;   // deg/s while held
let stampTimer = null;
const spin = {
  angle: 0, vel: 0, last: 0, raf: null,
  holding: false, base: '?', pending: null, showing: null,
  decel: 900, fricK: 5,   // randomized per toss so no two landings feel identical
};

function abortSpin() {
  if (spin.raf) cancelAnimationFrame(spin.raf);
  spin.raf = null;
  spin.vel = 0;
  spin.angle = 0;
  spin.last = 0;
  spin.holding = false;
  spin.pending = null;
  spin.showing = null;
  els.coin.style.transform = '';
}

function endSpin(face) {
  const landed = face || spin.base;
  abortSpin();
  spin.base = landed;
  setCoinFace(landed);
  if (face) sfxLand(face === 'H');
}

function spinStep(ts) {
  if (!spin.last) spin.last = ts;
  const dt = Math.min(0.05, (ts - spin.last) / 1000);
  spin.last = ts;

  if (spin.holding) {
    spin.vel += (SPIN_MAX - spin.vel) * Math.min(1, dt * 6);
    spin.angle += spin.vel * dt;
  } else if (spin.pending === null) {
    spin.vel = Math.max(0, spin.vel - (spin.decel + spin.vel * spin.fricK) * dt);
    spin.angle += spin.vel * dt;
    if (spin.vel === 0) { endSpin(null); return; }
  } else if (spin.vel > 450) {
    spin.vel = Math.max(0, spin.vel - (spin.decel + spin.vel * spin.fricK) * dt);
    spin.angle += spin.vel * dt;
  } else {
    // slow enough: glide to the next front-facing turn and land the outcome
    spin.base = spin.pending;
    const a = ((spin.angle % 360) + 360) % 360;
    const rem = (360 - a) % 360;
    if (rem < 3) { endSpin(spin.pending); return; }
    spin.angle += Math.max(220 * dt, rem * Math.min(1, dt * 12));
  }

  const a = ((spin.angle % 360) + 360) % 360;
  const back = a > 90 && a < 270;
  const alt = spin.base === 'T' ? 'H' : 'T';
  const show = back ? alt : spin.base;
  if (show !== spin.showing) {
    spin.showing = show;
    setCoinFace(show);
  }
  els.coin.style.transform = `rotateY(${a}deg)${back ? ' scaleX(-1)' : ''}`;
  spin.raf = requestAnimationFrame(spinStep);
}

function pressCoin() {
  if (els.coin.disabled) return;
  spin.holding = true;
  sfxFlick();
  if (spin.base === '?') spin.base = 'H';
  // The toss is user-triggered, essential feedback — it animates even under
  // prefers-reduced-motion (ambient effects stay disabled there).
  if (!spin.raf) {
    spin.last = 0;
    spin.raf = requestAnimationFrame(spinStep);
  }
}

// Flipping stays open even after the reveal — if your 21 flips were all heads
// on a 90/10 coin, keep going and watch the missing side finally show up.
function releaseCoin() {
  const wasHolding = spin.holding;
  spin.holding = false;
  if (!wasHolding) return;

  const isHeads = rand() < state.coin.p;
  if (isHeads) state.heads++; else state.tails++;
  addChip(isHeads);
  renderTally();

  spin.lastFlipTime = performance.now();
  // visual-only randomness (Math.random, not the game rng): vary the coast
  spin.decel = 700 + Math.random() * 500;
  spin.fricK = 4 + Math.random() * 2.5;
  spin.vel = Math.max(spin.vel, 900);   // even the quickest tap gets a lively toss
  spin.pending = isHeads ? 'H' : 'T';
  if (!spin.raf) { spin.last = 0; spin.raf = requestAnimationFrame(spinStep); }
}

function addChip(isHeads) {
  const chip = document.createElement('span');
  chip.className = 'chip ' + (isHeads ? 'chip-h' : 'chip-t');
  els.strip.appendChild(chip);
  while (els.strip.children.length > 22) els.strip.removeChild(els.strip.firstChild);
}

// Instant bulk flips — used by the ?demo/?demoplay test hooks only.
function flip(n) {
  if (state.locked) return;
  let last = false;
  for (let i = 0; i < n; i++) {
    const isHeads = rand() < state.coin.p;
    if (isHeads) state.heads++; else state.tails++;
    last = isHeads;
    addChip(isHeads);
  }
  spin.base = last ? 'H' : 'T';
  setCoinFace(spin.base);
  renderTally();
}

function renderTally() {
  const n = state.heads + state.tails;
  els.tallySr.textContent = n ? `${state.heads} heads, ${state.tails} tails, ${n} flips` : '';
  els.tallyBar.classList.toggle('ghost', n === 0);   // space reserved; filled on first flip
  els.tallyPct.classList.toggle('ghost', n === 0);
  els.segH.style.flexGrow = state.heads;
  els.segT.style.flexGrow = state.tails;
  els.pctH.textContent = n ? fmtPct(state.heads / n) + ' heads' : '0% heads';
  els.pctT.textContent = n ? fmtPct(state.tails / n) + ' tails' : '0% tails';
  setRestlessness();
}

/* ---------------- answers & scoring ---------------- */

function renderAnswers() {
  els.answers.innerHTML = '';
  for (const v of state.options) {
    const b = document.createElement('button');
    b.className = 'answer';
    b.textContent = v.toFixed(2);
    b.addEventListener('click', () => answer(v, b));
    els.answers.appendChild(b);
  }
}

function trueOption() {
  return state.options.reduce((a, b) =>
    (Math.abs(b - state.coin.H) < Math.abs(a - state.coin.H) ? b : a));
}

function answer(guess, btn) {
  if (state.locked) return;
  audio();                                 // prime inside the click gesture
  if (guess === trueOption()) {
    btn.classList.add('chosen', 'is-true');
    els.tryNote.hidden = true;
    lock();
  } else {
    state.tries += 1;
    btn.disabled = true;
    btn.classList.add('wrong');
    els.tryNote.hidden = false;
    sfxWrong();
  }
}

function insightFor(p, H) {
  const maj = p >= 0.5 ? 'heads' : 'tails';
  const a = Math.round(Math.max(p, 1 - p) * 100);
  const b = 100 - a;
  if (H === 0) return `Always ${maj} — no surprise, no information.`;
  if (H >= 0.985) return 'Essentially fair — every flip is worth a full bit.';
  if (H >= 0.9) return `A ${a}/${b} coin still carries ${fmtBits(H)} bits — the curve is flat near the top.`;
  if (H >= 0.45) return `A ${a}/${b} coin: predictable enough to bet on, surprising enough to matter.`;
  if (H >= 0.12) return `Heavily loaded toward ${maj} — most flips just confirm expectations.`;
  return `Nearly one-sided — near-certainty carries almost no information.`;
}

function lock() {
  if (state.locked) return;
  state.locked = true;
  abortSpin();

  const { p, H } = state.coin;

  els.verdict.textContent = 'Correct!';
  els.verdictSub.textContent = state.tries === 0 ? 'First try!' : '';
  els.verdictSub.hidden = state.tries !== 0;

  const n = state.heads + state.tails;
  els.chipCoin.textContent = fmtPct(p) + ' heads';
  els.chipTrue.textContent = fmtBits(H) + ' bits';
  els.chipFlips.textContent = n === 1 ? '1 flip used' : `${n} flips used`;

  els.insight.textContent = insightFor(p, H);

  if (p > 0 && p < 1) {
    const q = 1 - p;
    els.mathline.textContent =
      `H = −${p} log₂ ${p} − ${+q.toFixed(3)} log₂ ${+q.toFixed(3)} = ${fmtBits(H)} bits`;
  } else {
    els.mathline.textContent = 'H = 0 exactly — certainty needs no bits.';
  }

  const ph = n ? state.heads / n : null;
  if (n >= 5 && ph > 0 && ph < 1) {
    const slope = Math.abs(Math.log2((1 - ph) / ph));
    let delta = Math.max(slope * Math.sqrt(ph * (1 - ph) / n), 0.72 / n);
    delta = Math.min(Math.max(delta, 0.005), 0.5);
    els.noise.textContent = `Sampling luck: with ${n} flips, an estimate of H typically wobbles by about ±${fmtBits(delta)} bits.`;
    els.noise.hidden = false;
  } else {
    els.noise.hidden = true;
  }

  drawChart(p, H, ph);
  els.legendObs.hidden = ph === null;

  // the coin turns over and shows its true worth, stamped into the metal
  void els.coin.offsetWidth;
  els.coin.classList.add('spin');
  stampTimer = setTimeout(() => {
    if (!spin.raf) setCoinFace('V', fmtBits(H));   // unless it's already spinning again
    sfxStamp();
  }, 250);
  sfxCorrect();
  setRestlessness();

  setPlayEnabled(false);
  els.revealPanel.hidden = false;
  els.revealPanel.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
}

function nextRound() {
  abortSpin();
  clearTimeout(stampTimer);
  els.coin.classList.remove('spin');
  state.coin = newCoin();
  state.options = makeOptions(state.coin.H);
  state.heads = 0;
  state.tails = 0;
  state.tries = 0;
  state.locked = false;
  els.tryNote.hidden = true;
  els.strip.innerHTML = '';
  spin.base = '?';
  setCoinFace('?');
  renderAnswers();
  renderTally();
  els.revealPanel.hidden = true;
  els.moreMath.open = false;
  setPlayEnabled(true);
  document.getElementById('play-panel').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
}

function setPlayEnabled(on) {
  // only the answers lock after a round; the coin itself never stops flipping
  for (const b of els.answers.children) b.disabled = !on;
}

/* ---------------- chart ---------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function drawChart(p, H, ph) {
  const svg = els.chart;
  svg.innerHTML = '';

  const M = { t: 34, r: 24, b: 48, l: 46 };
  const W = 640 - M.l - M.r;
  const PH = 360 - M.t - M.b;
  const x = (pp) => M.l + pp * W;
  const y = (h) => M.t + PH * (1 - h);

  // grid + axes (recessive)
  for (const g of [0.25, 0.5, 0.75, 1]) {
    svg.appendChild(svgEl('line', { class: 'gridline', x1: M.l, y1: y(g), x2: M.l + W, y2: y(g) }));
    const t = svgEl('text', { class: 'tick', x: M.l - 8, y: y(g) + 4, 'text-anchor': 'end' });
    t.textContent = String(g);
    svg.appendChild(t);
  }
  svg.appendChild(svgEl('line', { class: 'axisline', x1: M.l, y1: y(0), x2: M.l + W, y2: y(0) }));
  for (const g of [0, 0.25, 0.5, 0.75, 1]) {
    const t = svgEl('text', { class: 'tick', x: x(g), y: y(0) + 18, 'text-anchor': 'middle' });
    t.textContent = Math.round(g * 100) + '%';
    svg.appendChild(t);
  }
  const capY = svgEl('text', { class: 'caption', x: M.l, y: M.t - 14 });
  capY.textContent = 'bits of surprise per flip';
  svg.appendChild(capY);
  const capX = svgEl('text', { class: 'caption', x: M.l + W / 2, y: 356, 'text-anchor': 'middle' });
  capX.textContent = 'chance of heads';
  svg.appendChild(capX);

  // the binary entropy curve
  let d = `M ${x(0)} ${y(0)}`;
  for (let pp = 0.002; pp < 1; pp += 0.002) d += ` L ${x(pp).toFixed(2)} ${y(entropyBits(pp)).toFixed(2)}`;
  d += ` L ${x(1)} ${y(0)}`;
  svg.appendChild(svgEl('path', { class: 'curve', d }));

  // the law of the curve, written in its own belly
  const formula = svgEl('text', { class: 'formula', x: x(0.5), y: y(0.3), 'text-anchor': 'middle' });
  formula.textContent = 'H(p) = −p log₂ p − (1−p) log₂ (1−p)';
  svg.appendChild(formula);

  // what the flips showed (plug-in estimate), drawn under the true dot
  if (ph !== null) {
    svg.appendChild(svgEl('circle', { class: 'obsdot', cx: x(ph), cy: y(entropyBits(ph)), r: 5 }));
  }

  // the true coin
  svg.appendChild(svgEl('circle', { class: 'truedot', cx: x(p), cy: y(H), r: 6.5 }));
  const onRight = x(p) <= M.l + W - 120;
  const below = y(H) < M.t + 20;
  const tLabel = svgEl('text', {
    class: 'truelabel',
    x: x(p) + (onRight ? 12 : -12),
    y: y(H) + (below ? 20 : -10),
    'text-anchor': onRight ? 'start' : 'end',
  });
  tLabel.textContent = `${fmtBits(H)} bits`;
  svg.appendChild(tLabel);

  // hover/keyboard layer: slide along the curve to read off any coin
  const hoverDot = svgEl('circle', { class: 'hoverdot', r: 4.5, visibility: 'hidden' });
  const hoverText = svgEl('text', {
    class: 'hovertext', x: M.l + W, y: M.t - 14, 'text-anchor': 'end', visibility: 'hidden',
  });
  const hit = svgEl('rect', {
    class: 'hitarea', x: M.l, y: M.t - 6, width: W, height: PH + 12,
    tabindex: '0',
    'aria-label': 'Explore the curve: press the left and right arrow keys to read off other coins',
  });
  svg.appendChild(hoverDot);
  svg.appendChild(hoverText);
  svg.appendChild(hit);

  const showAt = (pp) => {
    const hh = entropyBits(pp);
    hoverDot.setAttribute('cx', x(pp));
    hoverDot.setAttribute('cy', y(hh));
    const a = Math.round(pp * 100);
    hoverText.textContent = `a ${a}/${100 - a} coin → ${fmtBits(hh)} bits`;
    hoverDot.setAttribute('visibility', 'visible');
    hoverText.setAttribute('visibility', 'visible');
  };
  const hideReadout = () => {
    hoverDot.setAttribute('visibility', 'hidden');
    hoverText.setAttribute('visibility', 'hidden');
  };

  hit.addEventListener('pointermove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) * (640 / box.width) - M.l) / W;
    showAt(Math.min(0.998, Math.max(0.002, px)));
  });
  hit.addEventListener('pointerleave', hideReadout);

  let kbP = 0.5;
  hit.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    const step = ev.shiftKey ? 0.05 : 0.01;
    kbP = Math.min(0.99, Math.max(0.01, kbP + (ev.key === 'ArrowRight' ? step : -step)));
    showAt(kbP);
  });
  hit.addEventListener('focus', () => showAt(kbP));
  hit.addEventListener('blur', hideReadout);
}

/* ---------------- wiring ---------------- */

// A browser that decides the touch was a scroll/long-press fires pointercancel:
// stop the hold WITHOUT counting a flip (only a real release flips).
function cancelHold() {
  spin.holding = false;
}

els.coin.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  try { els.coin.setPointerCapture(ev.pointerId); } catch (e) { /* not supported */ }
  pressCoin();
});
els.coin.addEventListener('pointerup', releaseCoin);
window.addEventListener('pointerup', releaseCoin);
window.addEventListener('pointercancel', cancelHold);
els.coin.addEventListener('contextmenu', (ev) => ev.preventDefault());
// iOS unlocks WebAudio only inside a genuine user gesture — prime it once.
window.addEventListener('touchend', () => audio(), { once: true, passive: true });

// Fallback: if a browser swallows the pointer hold (some mobile stacks do),
// a plain click still performs a full toss.
els.coin.addEventListener('click', () => {
  if (els.coin.disabled) return;
  if (performance.now() - (spin.lastFlipTime || 0) < 400) return;   // pointer path already flipped
  pressCoin();
  setTimeout(releaseCoin, 140);
});
els.coin.addEventListener('keydown', (ev) => {
  if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) {
    ev.preventDefault();
    pressCoin();
  }
});
els.coin.addEventListener('keyup', (ev) => {
  if (ev.key === ' ' || ev.key === 'Enter') releaseCoin();
});

els.next.addEventListener('click', nextRound);

/* ---------------- init ---------------- */

console.log('coin-entropy build v13');
state.coin = newCoin();
state.options = makeOptions(state.coin.H);
renderAnswers();
renderTally();

// Test/screenshot hooks: ?demo → deterministic flips + answered round (reveal state),
// ?demoplay → deterministic flips only. ?dark forces dark. ?face=H|T forces a face.
// ?p=0.7 forces the coin's bias (testing).
const qs = new URLSearchParams(location.search);
if (qs.has('dark')) document.documentElement.dataset.theme = 'dark';
if (qs.get('p') !== null && !qs.has('demo') && !qs.has('demoplay')) {
  const fp = Math.min(1, Math.max(0, Number(qs.get('p')) || 0));
  state.coin = { p: fp, H: entropyBits(fp) };
  state.options = makeOptions(state.coin.H);
  renderAnswers();
}
if (qs.has('demo') || qs.has('demoplay')) {
  seedRand(42);
  state.coin = { p: 0.72, H: entropyBits(0.72) };
  state.options = makeOptions(state.coin.H);
  renderAnswers();
  flip(60);
  if (qs.has('demo')) {
    // one wrong pick, then the right one — shows the try-again state and the reveal
    const tv = trueOption();
    const near = state.options.reduce((a, b) => (Math.abs(b - 0.79) < Math.abs(a - 0.79) ? b : a));
    const byValue = (v) => [...els.answers.children].find((el) => Number(el.textContent) === v);
    if (near !== tv) answer(near, byValue(near));
    answer(tv, byValue(tv));
    // settle the coin instantly and unfold details so screenshots show everything
    clearTimeout(stampTimer);
    els.coin.classList.remove('spin');
    setCoinFace('V', fmtBits(state.coin.H));
    els.moreMath.open = true;
  }
  if (COIN_FACES[qs.get('face')]) setCoinFace(qs.get('face'));
}
