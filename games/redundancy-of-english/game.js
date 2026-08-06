'use strict';

/* Shannon (1951), "Prediction and Entropy of Printed English", as a game:
   guess a hidden sentence letter by letter (27 symbols: a-z + space). The
   guess-count sequence carries the same information as the text, so your own
   guessing bounds the entropy of English:
     upper: H <= -sum q_i log2 q_i          (entropy of the guess-count dist.)
     lower: H >= sum i (q_i - q_{i+1}) log2 i
   where q_i = fraction of letters you got on the i-th guess.
   Future letters render as a flat run of ghost tiles — no word boundaries are
   revealed ahead of the cursor, same as Shannon's subject. */

const A = 27;
const F0 = Math.log2(A);
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/* ---------------- dom ---------------- */

const $ = (id) => document.getElementById(id);
const els = {
  sentence: $('sentence'), keys: $('keys'), liveSr: $('live-sr'),
  mPos: $('m-pos'), mLen: $('m-len'), mAvg: $('m-avg'), mBits: $('m-bits'),
  revealPanel: $('reveal-panel'), verdictSub: $('verdict-sub'),
  chipFirst: $('chip-first'), chipAvg: $('chip-avg'), chipLetters: $('chip-letters'),
  hist: $('hist'), insight: $('insight'), mathline: $('mathline'),
  moreMath: $('more-math'), next: $('next'),
};

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- state ---------------- */

const state = {
  deck: [], di: 0,
  sentence: '', pos: 0,
  wrong: new Set(),
  done: false,
  sessionCounts: new Map(),   // guess count -> letters, pooled across sentences
  sessionLetters: 0,
  sessionGuesses: 0,
  sessionSentences: 0,
};

function shuffleDeck() {
  state.deck = SENTENCES.map((_, i) => i);
  for (let i = state.deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
  }
  state.di = 0;
}

/* ---------------- sound (synthesized — no assets) ---------------- */

let actx = null;

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!actx) actx = new AC();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(freq, dur, { type = 'sine', gain = 0.15, at = 0 } = {}) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function sfxWrongKey() { tone(175, 0.07, { type: 'triangle', gain: 0.05 }); }

// the reveal note's loudness IS the surprise: first-try letters barely tick,
// a ten-guess letter rings
function sfxReveal(cost) {
  const gain = Math.min(0.05 + 0.018 * (cost - 1), 0.16);
  tone(1046.5, 0.18 + 0.02 * Math.min(cost, 8), { type: 'triangle', gain });
  if (cost >= 5) tone(1568, 0.25, { type: 'sine', gain: 0.06, at: 0.02 });
}

function sfxDone() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    tone(f, 0.28, { type: 'triangle', gain: 0.1, at: 0.1 + i * 0.09 }));
}

/* ---------------- entropy from guess counts ---------------- */

function costClass(cost) {
  if (cost === 1) return 'c1';
  if (cost === 2) return 'c2';
  if (cost <= 4) return 'c3';
  if (cost <= 8) return 'c4';
  return 'c5';
}

function q(counts, total) {
  const out = new Array(A + 2).fill(0);
  for (const [c, n] of counts) out[Math.min(c, A)] += n / total;
  return out;
}

function upperBound(counts, total) {
  let h = 0;
  for (const [, n] of counts) {
    const p = n / total;
    h -= p * Math.log2(p);
  }
  return h;
}

function lowerBound(counts, total) {
  const qs = q(counts, total);
  let h = 0;
  for (let i = 1; i <= A; i++) h += i * (qs[i] - qs[i + 1]) * Math.log2(i);
  return h;
}

/* ---------------- rendering ---------------- */

function buildKeys() {
  els.keys.innerHTML = '';
  for (const row of ['abcdefghi', 'jklmnopqr', 'stuvwxyz']) {
    const r = document.createElement('div');
    r.className = 'krow' + (row.length === 8 ? ' krow-8' : '');
    if (row.length === 8) r.style.gridTemplateColumns = 'repeat(8, 1fr)';
    for (const ch of row) {
      const k = document.createElement('button');
      k.className = 'key';
      k.textContent = ch;
      k.dataset.ch = ch;
      k.addEventListener('click', () => guess(ch));
      r.appendChild(k);
    }
    els.keys.appendChild(r);
  }
  const sp = document.createElement('button');
  sp.className = 'key key-space';
  sp.textContent = 'space';
  sp.dataset.ch = ' ';
  sp.addEventListener('click', () => guess(' '));
  els.keys.appendChild(sp);
}

function keyEl(ch) {
  return els.keys.querySelector(`[data-ch="${ch === ' ' ? ' ' : ch}"]`);
}

function resetKeys(enabled) {
  for (const k of els.keys.querySelectorAll('.key')) {
    k.classList.remove('wrong');
    k.disabled = !enabled;
  }
}

function renderSentence() {
  const frag = document.createDocumentFragment();
  let word = null;
  for (let i = 0; i < state.pos; i++) {
    const ch = state.sentence[i];
    const t = document.createElement('span');
    t.className = 'tile ' + costClass(state.costs[i]);
    if (ch === ' ') {
      t.style.width = '9px';
      if (word) frag.appendChild(word);
      frag.appendChild(t);
      word = null;
    } else {
      t.textContent = ch;
      (word ??= document.createElement('span')).className = 'word';
      word.appendChild(t);
    }
  }
  if (word) frag.appendChild(word);
  if (state.pos < state.sentence.length) {
    const cur = document.createElement('span');
    cur.className = 'tile cur';
    frag.appendChild(cur);
    // future letters: a flat anonymous run — no word boundaries leak ahead
    for (let i = state.pos + 1; i < state.sentence.length; i++) {
      const g = document.createElement('span');
      g.className = 'tile ghost';
      frag.appendChild(g);
    }
  }
  els.sentence.replaceChildren(frag);
}

function updateMeter() {
  els.mPos.textContent = Math.min(state.pos + 1, state.sentence.length);
  els.mLen.textContent = state.sentence.length;
  const n = state.sessionLetters;
  els.mAvg.textContent = n ? (state.sessionGuesses / n).toFixed(1) : '–';
  els.mBits.textContent = n >= 5 ? upperBound(state.sessionCounts, n).toFixed(2) : '–';
}

/* ---------------- play ---------------- */

function guess(ch) {
  if (state.done || state.wrong.has(ch)) return;
  audio();
  const expected = state.sentence[state.pos];
  if (ch === expected) {
    const cost = state.wrong.size + 1;
    state.costs.push(cost);
    state.sessionCounts.set(cost, (state.sessionCounts.get(cost) || 0) + 1);
    state.sessionLetters += 1;
    state.sessionGuesses += cost;
    state.wrong.clear();
    state.pos += 1;
    sfxReveal(cost);
    els.liveSr.textContent = `${expected === ' ' ? 'space' : expected}, ${cost} ${cost === 1 ? 'guess' : 'guesses'}`;
    resetKeys(true);
    renderSentence();
    updateMeter();
    if (state.pos === state.sentence.length) finishSentence();
  } else {
    state.wrong.add(ch);
    const k = keyEl(ch);
    if (k) {
      k.classList.add('wrong');
      k.disabled = true;
    }
    sfxWrongKey();
  }
}

function insightFor(red) {
  if (red >= 0.75) return 'You squeezed English harder than Shannon’s own subject did.';
  if (red >= 0.6) return 'Right in the modern range — most of English is structure, not choice.';
  if (red >= 0.45) return 'Close to Shannon’s 1948 estimate: about half of English is redundant.';
  return 'More surprise than average — rare words punish every predictor.';
}

function finishSentence() {
  state.done = true;
  state.sessionSentences += 1;
  resetKeys(false);
  sfxDone();

  const n = state.sessionLetters;
  const hu = upperBound(state.sessionCounts, n);
  const hl = lowerBound(state.sessionCounts, n);
  const red = 1 - hu / F0;
  const scope = state.sessionSentences > 1 ? ` · across ${state.sessionSentences} sentences` : '';
  els.verdictSub.textContent = `your entropy of English ≈ ${hu.toFixed(2)} bits/letter · redundancy ≈ ${Math.round(red * 100)}%${scope}`;

  const first = state.sessionCounts.get(1) || 0;
  els.chipFirst.textContent = `${Math.round((first / n) * 100)}%`;
  els.chipAvg.textContent = (state.sessionGuesses / n).toFixed(2);
  els.chipLetters.textContent = n;

  els.insight.textContent = insightFor(red);
  els.mathline.textContent =
    `Shannon’s bounds from your guesses: ${hl.toFixed(2)} ≤ H ≤ ${hu.toFixed(2)} bits/letter (alphabet: ${F0.toFixed(2)})`;

  drawHist();
  els.revealPanel.hidden = false;
  els.revealPanel.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
}

function nextSentence() {
  if (state.di >= state.deck.length) shuffleDeck();
  state.sentence = SENTENCES[state.deck[state.di++]];
  state.pos = 0;
  state.costs = [];
  state.wrong.clear();
  state.done = false;
  els.revealPanel.hidden = true;
  els.moreMath.open = false;
  resetKeys(true);
  renderSentence();
  updateMeter();
  document.getElementById('play-panel').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
}

/* ---------------- histogram ---------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function drawHist() {
  const svg = els.hist;
  svg.innerHTML = '';
  const M = { t: 26, r: 20, b: 36, l: 20 };
  const W = 640 - M.l - M.r;
  const H = 240 - M.t - M.b;
  const MAXB = 10;                      // bars 1..9 and "10+"
  const bins = new Array(MAXB + 1).fill(0);
  for (const [c, k] of state.sessionCounts) bins[Math.min(c, MAXB)] += k;
  const total = state.sessionLetters;
  const peak = Math.max(...bins, 1) / total;
  const bw = W / MAXB;

  svg.appendChild(svgEl('line', { class: 'axisline', x1: M.l, y1: M.t + H, x2: M.l + W, y2: M.t + H }));
  for (let i = 1; i <= MAXB; i++) {
    const p = bins[i] / total;
    const h = (p / peak) * (H - 10);
    const x = M.l + (i - 1) * bw + 6;
    if (p > 0) {
      svg.appendChild(svgEl('rect', {
        class: 'bar', x, y: M.t + H - h, width: bw - 12, height: Math.max(h, 2), rx: 4,
      }));
      const lb = svgEl('text', { class: 'blabel', x: x + (bw - 12) / 2, y: M.t + H - h - 6, 'text-anchor': 'middle' });
      lb.textContent = `${Math.round(p * 100)}%`;
      svg.appendChild(lb);
    }
    const tk = svgEl('text', { class: 'tick', x: x + (bw - 12) / 2, y: M.t + H + 16, 'text-anchor': 'middle' });
    tk.textContent = i === MAXB ? '10+' : String(i);
    svg.appendChild(tk);
  }
  const cap = svgEl('text', { class: 'caption', x: M.l + W / 2, y: 234, 'text-anchor': 'middle' });
  cap.textContent = 'guesses needed';
  svg.appendChild(cap);
}

/* ---------------- wiring ---------------- */

window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const ch = ev.key === ' ' ? ' ' : ev.key.toLowerCase();
  if (ch === ' ' || LETTERS.includes(ch)) {
    if (state.done) return;
    if (ch === ' ') ev.preventDefault();      // keep the page from scrolling mid-game
    guess(ch);
  }
});
els.next.addEventListener('click', nextSentence);

/* ---------------- init ---------------- */

console.log('redundancy-of-english build v1');
buildKeys();
shuffleDeck();
nextSentence();

// Test/screenshot hooks: ?demo → a full auto-played sentence (reveal state),
// ?demoplay → 60% played. ?dark forces dark. The auto-player guesses in
// English frequency order, so costs look like a human's.
const qs = new URLSearchParams(location.search);
if (qs.has('dark')) document.documentElement.dataset.theme = 'dark';
if (qs.has('demo') || qs.has('demoplay')) {
  state.sentence = SENTENCES[0];
  state.pos = 0;
  state.costs = [];
  state.wrong.clear();
  state.done = false;
  renderSentence();
  updateMeter();
  const FREQ = ' etaoinshrdlcumwfgypbvkjxqz';
  const stopAt = qs.has('demo') ? state.sentence.length : Math.floor(state.sentence.length * 0.6);
  while (state.pos < stopAt && !state.done) {
    const expected = state.sentence[state.pos];
    for (const ch of FREQ) {
      guess(ch);
      if (ch === expected) break;
    }
  }
  if (qs.has('demo')) els.moreMath.open = true;
}
