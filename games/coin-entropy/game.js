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

const STORE_KEY = 'shannon-coin-entropy-v1';

const state = {
  coin: null,            // { p, H } — p is P(heads)
  heads: 0,
  tails: 0,
  locked: false,
  life: { rounds: 0, sumErr: 0, score: 0 },
};

// Sample the target *entropy* uniformly, then invert to a bias. Sampling the bias
// uniformly would make almost every coin look near-fair (H > 0.9 for p in .32–.68).
function newCoin() {
  if (rand() < 0.1) return { p: 0.5, H: 1 };   // the classic 1-bit anchor
  let p = biasForEntropy(rand());
  if (rand() < 0.5) p = 1 - p;
  p = Math.round(p * 1000) / 1000;
  return { p, H: entropyBits(p) };
}

/* ---------------- dom ---------------- */

const $ = (id) => document.getElementById(id);
const els = {
  coin: $('coin'), strip: $('strip'),
  countH: $('count-h'), countT: $('count-t'), countN: $('count-n'),
  segH: $('seg-h'), segT: $('seg-t'), pctH: $('pct-h'), pctT: $('pct-t'),
  flip1: $('flip-1'), flip10: $('flip-10'), flip100: $('flip-100'),
  guess: $('guess'), guessOut: $('guess-out'), lock: $('lock'),
  guessPanel: $('guess-panel'), revealPanel: $('reveal-panel'),
  verdict: $('verdict'), flavor: $('flavor'),
  tileCoinV: $('tile-coin-v'), tileCoinS: $('tile-coin-s'),
  tileHV: $('tile-h-v'), tileGuessV: $('tile-guess-v'), tileGuessS: $('tile-guess-s'),
  tileRoundV: $('tile-round-v'), tileRoundS: $('tile-round-s'),
  chart: $('chart'), legendObs: $('legend-obs'),
  insight: $('insight'), mathline: $('mathline'), noise: $('noise'),
  next: $('next'), statRound: $('stat-round'), statScore: $('stat-score'), statAvg: $('stat-avg'),
  reset: $('reset'),
};

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- formatting ---------------- */

const fmtPct = (p) => (Math.round(p * 1000) / 10).toFixed(1).replace(/\.0$/, '') + '%';
const fmtBits = (h, dp = 2) => h.toFixed(dp);

/* ---------------- flipping ---------------- */

let spinTimer = null;

function flip(n) {
  if (state.locked) return;
  let last = false;
  for (let i = 0; i < n; i++) {
    const isHeads = rand() < state.coin.p;
    if (isHeads) state.heads++; else state.tails++;
    last = isHeads;
    const chip = document.createElement('i');
    chip.className = 'chip ' + (isHeads ? 'chip-h' : 'chip-t');
    els.strip.appendChild(chip);
  }
  while (els.strip.children.length > 120) els.strip.removeChild(els.strip.firstChild);

  const face = last ? 'H' : 'T';
  clearTimeout(spinTimer);
  els.coin.classList.remove('spin', 'bulk');
  if (reducedMotion) {
    els.coin.textContent = face;
  } else if (n === 1) {
    void els.coin.offsetWidth;              // restart the animation
    els.coin.classList.add('spin');
    spinTimer = setTimeout(() => { els.coin.textContent = face; }, 250);
  } else {
    els.coin.textContent = face;
    void els.coin.offsetWidth;
    els.coin.classList.add('bulk');
  }
  renderTally();
}

function renderTally() {
  const n = state.heads + state.tails;
  els.countH.textContent = state.heads;
  els.countT.textContent = state.tails;
  els.countN.textContent = n;
  els.segH.style.flexGrow = state.heads;
  els.segT.style.flexGrow = state.tails;
  els.pctH.textContent = n ? fmtPct(state.heads / n) + ' heads' : '';
  els.pctT.textContent = n ? fmtPct(state.tails / n) + ' tails' : '';
}

/* ---------------- guessing & scoring ---------------- */

function syncGuess() {
  els.guessOut.textContent = Number(els.guess.value).toFixed(2);
}

function verdictFor(err) {
  if (err <= 0.02) return { name: 'Dead on', flavor: "You've got Shannon's eyes." };
  if (err <= 0.05) return { name: 'Sharp', flavor: 'Your gut is well calibrated.' };
  if (err <= 0.10) return { name: 'Good', flavor: 'A solid read of a slippery number.' };
  if (err <= 0.20) return { name: 'Warm', flavor: 'Right neighborhood, wrong house.' };
  return { name: 'Cold', flavor: 'Entropy is sneakier than it looks.' };
}

function insightFor(p, H) {
  const maj = p >= 0.5 ? 'heads' : 'tails';
  const a = Math.round(Math.max(p, 1 - p) * 100);
  const b = 100 - a;
  if (H === 0) return `This coin always lands ${maj}. Zero surprise, zero information — a flip tells you nothing you didn't already know.`;
  if (H >= 0.985) return 'An (almost) perfectly fair coin. Every flip is worth a full bit — no two-sided coin is harder to predict.';
  if (H >= 0.9) return `A ${a}/${b} coin still carries ${fmtBits(H)} bits. The curve is remarkably flat near the top — mild bias barely dents the surprise.`;
  if (H >= 0.45) return `A ${a}/${b} coin. Betting ${maj} usually wins, yet each flip still carries real uncertainty — this is the middle ground between order and noise.`;
  if (H >= 0.12) return `Heavily loaded toward ${maj}. Most flips just confirm what you already expected, so the average surprise is small.`;
  return `Almost a one-sided coin — ${maj} nearly every time. Near-certainty means each flip carries almost no information.`;
}

function lock() {
  if (state.locked) return;
  state.locked = true;

  const guess = Number(els.guess.value);
  const { p, H } = state.coin;
  const err = Math.abs(guess - H);
  const pts = Math.max(0, Math.round(100 - 500 * err));
  const v = verdictFor(err);

  state.life.rounds += 1;
  state.life.sumErr += err;
  state.life.score += pts;
  saveLife();

  els.verdict.textContent = `${v.name} — ${fmtBits(err)} bits off`;
  els.flavor.textContent = v.flavor;

  const n = state.heads + state.tails;
  els.tileCoinV.textContent = fmtPct(p) + ' heads';
  els.tileCoinS.textContent = fmtPct(1 - p) + ' tails';
  els.tileHV.textContent = fmtBits(H, 3);
  els.tileGuessV.textContent = fmtBits(guess) + ' bits';
  els.tileGuessS.textContent = n === 1 ? '1 flip used' : `${n} flips used`;
  els.tileRoundV.textContent = '+' + pts;
  els.tileRoundS.textContent = v.name;

  els.insight.textContent = insightFor(p, H);

  if (p > 0 && p < 1) {
    const q = 1 - p;
    els.mathline.textContent =
      `H = −${p} log₂ ${p} − ${+q.toFixed(3)} log₂ ${+q.toFixed(3)} = ${fmtBits(H, 3)} bits`;
  } else {
    els.mathline.textContent = 'H = 0 exactly — certainty needs no bits.';
  }

  const ph = n ? state.heads / n : null;
  if (n >= 5 && ph > 0 && ph < 1) {
    const slope = Math.abs(Math.log2((1 - ph) / ph));
    let delta = Math.max(slope * Math.sqrt(ph * (1 - ph) / n), 0.72 / n);
    delta = Math.min(Math.max(delta, 0.005), 0.5);
    let txt = `Sampling luck: with ${n} flips, an estimate of H typically wobbles by about ±${fmtBits(delta)} bits.`;
    if (err <= delta) txt += ' Your miss is inside that band — you read the data about as well as it could be read.';
    els.noise.textContent = txt;
    els.noise.hidden = false;
  } else {
    els.noise.hidden = true;
  }

  drawChart(p, H, ph, guess);
  els.legendObs.hidden = ph === null;

  setPlayEnabled(false);
  els.guessPanel.hidden = true;
  els.revealPanel.hidden = false;
  els.revealPanel.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
  renderScorebar();
}

function nextRound() {
  state.coin = newCoin();
  state.heads = 0;
  state.tails = 0;
  state.locked = false;
  els.strip.innerHTML = '';
  els.coin.textContent = '?';
  els.guess.value = '0.5';
  syncGuess();
  renderTally();
  els.revealPanel.hidden = true;
  els.guessPanel.hidden = false;
  setPlayEnabled(true);
  renderScorebar();
  document.getElementById('play-panel').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
}

function setPlayEnabled(on) {
  [els.coin, els.flip1, els.flip10, els.flip100, els.guess, els.lock].forEach((el) => { el.disabled = !on; });
}

function renderScorebar() {
  els.statRound.textContent = state.life.rounds + (state.locked ? 0 : 1);
  els.statScore.textContent = state.life.score;
  els.statAvg.textContent = state.life.rounds
    ? fmtBits(state.life.sumErr / state.life.rounds) + ' bits'
    : '–';
}

/* ---------------- persistence ---------------- */

function saveLife() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.life)); } catch (e) { /* private mode etc. */ }
}
function loadLife() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    if (typeof v.rounds === 'number' && typeof v.sumErr === 'number' && typeof v.score === 'number') {
      state.life = v;
    }
  } catch (e) { /* ignore corrupt storage */ }
}

/* ---------------- chart ---------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function drawChart(p, H, ph, guess) {
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

  // your guess — a dashed reference line
  svg.appendChild(svgEl('line', { class: 'guessline', x1: M.l, y1: y(guess), x2: M.l + W, y2: y(guess) }));
  const gLabel = svgEl('text', {
    class: 'guesslabel', x: M.l + 6,
    y: y(guess) + (y(guess) < M.t + 18 ? 15 : -7),
  });
  gLabel.textContent = `your guess · ${fmtBits(guess)}`;
  svg.appendChild(gLabel);

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

  // hover layer: slide along the curve to read off any coin
  const hoverDot = svgEl('circle', { class: 'hoverdot', r: 4.5, visibility: 'hidden' });
  const hoverText = svgEl('text', {
    class: 'hovertext', x: M.l + W, y: M.t - 14, 'text-anchor': 'end', visibility: 'hidden',
  });
  const hit = svgEl('rect', { class: 'hitarea', x: M.l, y: M.t - 6, width: W, height: PH + 12 });
  svg.appendChild(hoverDot);
  svg.appendChild(hoverText);
  svg.appendChild(hit);

  hit.addEventListener('pointermove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) * (640 / box.width) - M.l) / W;
    const pp = Math.min(0.998, Math.max(0.002, px));
    const hh = entropyBits(pp);
    hoverDot.setAttribute('cx', x(pp));
    hoverDot.setAttribute('cy', y(hh));
    const a = Math.round(pp * 100);
    hoverText.textContent = `a ${a}/${100 - a} coin → ${fmtBits(hh)} bits`;
    hoverDot.setAttribute('visibility', 'visible');
    hoverText.setAttribute('visibility', 'visible');
  });
  hit.addEventListener('pointerleave', () => {
    hoverDot.setAttribute('visibility', 'hidden');
    hoverText.setAttribute('visibility', 'hidden');
  });
}

/* ---------------- wiring ---------------- */

els.coin.addEventListener('click', () => flip(1));
els.flip1.addEventListener('click', () => flip(1));
els.flip10.addEventListener('click', () => flip(10));
els.flip100.addEventListener('click', () => flip(100));
els.guess.addEventListener('input', syncGuess);
els.lock.addEventListener('click', lock);
els.next.addEventListener('click', nextRound);
els.reset.addEventListener('click', (ev) => {
  ev.preventDefault();
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  location.reload();
});

/* ---------------- init ---------------- */

loadLife();
state.coin = newCoin();
syncGuess();
renderTally();
renderScorebar();

// Test/screenshot hooks: ?demo → deterministic flips + locked guess (reveal state),
// ?demoplay → deterministic flips only. ?dark forces dark mode.
const qs = new URLSearchParams(location.search);
if (qs.has('dark')) document.documentElement.dataset.theme = 'dark';
if (qs.has('demo') || qs.has('demoplay')) {
  seedRand(42);
  state.coin = { p: 0.72, H: entropyBits(0.72) };
  flip(60);
  if (qs.has('demo')) {
    els.guess.value = '0.79';
    syncGuess();
    lock();
  }
}
