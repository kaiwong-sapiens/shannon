/* The Communication System — part of `shannon` (explorables for information theory).
   Fig. 1 of Shannon (1948), as a simulator you can pause, step and rewind:
     information source → transmitter → channel (+ noise source) → receiver → destination.
   The whole transmission is a pure function of (message, compress, protect, noise, seed),
   computed up front; the timeline is only an index into it — so stepping backwards is
   exactly as cheap as stepping forwards. */

'use strict';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.has('dark')) document.documentElement.dataset.theme = 'dark';

/* ---------------- alphabet & codebooks (tables in codebook.js) ---------------- */

const SYM = new Map([...ALPHABET].map((c, i) => [c, i]));
const PLAIN = [...ALPHABET].map((_, i) => i.toString(2).padStart(5, '0'));   // 32 symbols → 5 bits
const HUFF = [...ALPHABET].map((c) => HUFFMAN[c]);
const TRIE = buildTrie(HUFF);

function buildTrie(codes) {
  const root = {};
  codes.forEach((code, sym) => {
    let node = root;
    for (let i = 0; i < code.length - 1; i++) node = node[code[i]] || (node[code[i]] = {});
    node[code[code.length - 1]] = sym;
  });
  return root;
}

// must match normalize() in make_codebook.py
function normalize(s) {
  return s.toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/["“”]/g, '')
    .replace(/[;:]/g, ',')
    .replace(/[^a-z.,'?! ]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

const MESSAGES = [
  { text: 'The fundamental problem of communication is that of reproducing at one point either exactly or approximately a message selected at another point.',
    by: 'Claude Shannon, 1948' },
  { text: 'What hath God wrought?', by: "Samuel Morse's first telegram, 1844" },
  { text: 'Mr. Watson, come here, I want to see you.', by: "Alexander Graham Bell's first phone call, 1876" },
  { text: "That's one small step for man, one giant leap for mankind.", by: 'Neil Armstrong, by radio from the Moon, 1969' },
  { text: 'XFOML RXKHRJFFJUJ ZLPWCFWKCYJ FFJEYVKCQSGHYD QPAAMKBZAACIBZLHJQD.',
    by: "Random letters, from Shannon's §3 — nothing to read through the noise" },
];

// Noise stops, as "1 in N bits flipped" (0 = silent). Shannon's own example is 1 in 100.
const NOISE_N = [0, 1000, 500, 300, 200, 150, 100, 70, 50, 30, 20, 15, 10, 7, 5, 4, 3, 2];
const SPEEDS = [{ label: '1×', bps: 120 }, { label: '4×', bps: 480 }, { label: '¼×', bps: 30 }];
const RATE = { none: 1, rep3: 1 / 3, hamming: 4 / 7 };
const RATE_TEXT = { none: '1', rep3: '1/3', hamming: '4/7' };

// Hamming (7,4) exactly as Shannon prints it (§17): message in X3 X5 X6 X7; X4, X2, X1 make
// α = X4+X5+X6+X7, β = X2+X3+X6+X7, γ = X1+X3+X5+X7 even; the binary number αβγ names the bad bit.
const PARITY_POS = new Set([1, 2, 4]);
const DATA_SLOT = { 3: 0, 5: 1, 6: 2, 7: 3 };

/* ---------------- rng: one uniform per channel position, per seed ---------------- */

function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let fieldSeed = null;
let field = new Float64Array(0);
// Bit i is flipped iff u[i] < p. The same u's are reused as the noise dial moves, so turning
// the noise up only ever adds hits — the damage grows smoothly instead of reshuffling.
function noiseField(seed, n) {
  if (seed !== fieldSeed || field.length < n) {
    const r = mulberry32(seed);
    field = new Float64Array(Math.max(n, 4096));
    for (let i = 0; i < field.length; i++) field[i] = r();
    fieldSeed = seed;
  }
  return field;
}

const newSeed = () => (Math.random() * 4294967296) >>> 0;

/* ---------------- state ---------------- */

const state = {
  msgIdx: 0,
  raw: MESSAGES[0].text,
  by: MESSAGES[0].by,
  compress: false,
  code: 'none',
  noiseIdx: NOISE_N.indexOf(100),
  seed: newSeed(),
  k: 0,              // blocks transmitted so far (0 … K); block k−1 is the one on screen
  playing: false,
  speed: 0,
};

let sim = null;

/* ---------------- the system (pure) ---------------- */

function simulate() {
  const msg = normalize(state.raw);
  const syms = [...msg].map((c) => SYM.get(c));
  const N = syms.length;
  const code = state.code;
  const nN = NOISE_N[state.noiseIdx];
  const p = nN ? 1 / nN : 0;

  // transmitter, part 1 — letters → bits (plain 5-bit code, or Huffman when compressing)
  const book = state.compress ? HUFF : PLAIN;
  const src = [], lStart = [], lEnd = [];
  for (const s of syms) {
    lStart.push(src.length);
    for (const b of book[s]) src.push(b === '1' ? 1 : 0);
    lEnd.push(src.length);
  }
  const S = src.length;

  // transmitter, part 2 — bits → signal, in blocks (one letter per block unless Hamming)
  const ch = [], role = [], blocks = [];
  if (code === 'hamming') {
    for (let s0 = 0; s0 < S; s0 += 4) {
      const d = [0, 1, 2, 3].map((m) => (s0 + m < S ? src[s0 + m] : 0));
      const X = [0, 0, 0, d[0], 0, d[1], d[2], d[3]];
      X[4] = X[5] ^ X[6] ^ X[7];
      X[2] = X[3] ^ X[6] ^ X[7];
      X[1] = X[3] ^ X[5] ^ X[7];
      const c0 = ch.length;
      for (let pos = 1; pos <= 7; pos++) {
        ch.push(X[pos]);
        role.push(PARITY_POS.has(pos) ? 'p' : (s0 + DATA_SLOT[pos] < S ? 'd' : 'z'));
      }
      blocks.push({ s0, s1: Math.min(s0 + 4, S), c0, c1: ch.length, X });
    }
  } else {
    for (let i = 0; i < N; i++) {
      const c0 = ch.length;
      for (let k = lStart[i]; k < lEnd[i]; k++) {
        if (code === 'rep3') { ch.push(src[k], src[k], src[k]); role.push('d', 'p', 'p'); }
        else { ch.push(src[k]); role.push('d'); }
      }
      blocks.push({ s0: lStart[i], s1: lEnd[i], c0, c1: ch.length });
    }
  }
  const L = ch.length;

  // channel — the noise source flips each bit with chance p
  const u = noiseField(state.seed, L);
  const flip = new Uint8Array(L), rx = new Uint8Array(L);
  for (let i = 0; i < L; i++) { flip[i] = u[i] < p ? 1 : 0; rx[i] = ch[i] ^ flip[i]; }

  // receiver, part 1 — signal → bits, repairing what the code allows
  const dec = new Uint8Array(S), blockOf = new Int32Array(S), repaired = new Uint8Array(L);
  blocks.forEach((b, j) => {
    for (let k = b.s0; k < b.s1; k++) blockOf[k] = j;
    b.hits = 0;
    for (let i = b.c0; i < b.c1; i++) b.hits += flip[i];
    if (code === 'hamming') {
      const R = [0];
      for (let i = b.c0; i < b.c1; i++) R.push(rx[i]);
      const a = R[4] ^ R[5] ^ R[6] ^ R[7], be = R[2] ^ R[3] ^ R[6] ^ R[7], g = R[1] ^ R[3] ^ R[5] ^ R[7];
      const syn = 4 * a + 2 * be + g;
      const C = R.slice();
      if (syn) C[syn] ^= 1;
      const data = [C[3], C[5], C[6], C[7]];
      b.ok = true;
      for (let k = b.s0; k < b.s1; k++) { dec[k] = data[k - b.s0]; if (dec[k] !== src[k]) b.ok = false; }
      b.check = { a, b: be, g, syn, C };
      for (let i = b.c0; i < b.c1; i++) if (flip[i]) repaired[i] = b.ok ? 1 : 0;
    } else if (code === 'rep3') {
      b.ok = true;
      b.votes = [];
      for (let k = b.s0; k < b.s1; k++) {
        const i = b.c0 + 3 * (k - b.s0);
        const sum = rx[i] + rx[i + 1] + rx[i + 2];
        dec[k] = sum >= 2 ? 1 : 0;
        const good = dec[k] === src[k];
        if (!good) b.ok = false;
        for (let m = 0; m < 3; m++) if (flip[i + m]) repaired[i + m] = good ? 1 : 0;
        b.votes.push({ v: dec[k], split: sum === 1 || sum === 2, good });
      }
    } else {
      for (let k = b.s0; k < b.s1; k++) dec[k] = rx[b.c0 + k - b.s0];
      b.ok = b.hits === 0;
    }
    b.fixed = 0;
    for (let i = b.c0; i < b.c1; i++) b.fixed += repaired[i];
  });

  // receiver, part 2 — bits → letters (a Huffman reader can lose its place after a hit)
  const out = [];
  if (!state.compress) {
    for (let i = 0; i < N; i++) {
      let v = 0;
      for (let k = lStart[i]; k < lEnd[i]; k++) v = 2 * v + dec[k];
      out.push({ sym: v, b0: lStart[i], b1: lEnd[i] });
    }
  } else {
    let node = TRIE, start = 0;
    for (let k = 0; k < S; k++) {
      node = node[dec[k]];
      if (node === undefined) { node = TRIE; start = k + 1; continue; }   // unreachable: the code is complete
      if (typeof node === 'number') { out.push({ sym: node, b0: start, b1: k + 1 }); node = TRIE; start = k + 1; }
    }
    if (start < S) out.push({ sym: -1, b0: start, b1: S });   // a codeword cut off by the end
  }
  for (const o of out) o.block = blockOf[o.b1 - 1];

  // destination — which letters arrived wrong
  if (!state.compress) out.forEach((o, i) => { o.err = o.sym !== syms[i]; });
  else markByAlignment(out, syms);

  const lFirst = lStart.map((k) => blockOf[k]);
  const lLast = lEnd.map((k) => blockOf[k - 1]);
  const outsAt = blocks.map(() => []);
  out.forEach((o, m) => outsAt[o.block].push(m));
  const consumed = new Int32Array(blocks.length);   // bits the letter-reader has used after block j
  let used = 0;
  blocks.forEach((b, j) => { if (outsAt[j].length) used = out[outsAt[j][outsAt[j].length - 1]].b1; consumed[j] = used; });
  const hitsTo = [0], fixedTo = [0], garbledTo = [0];
  blocks.forEach((b, j) => {
    hitsTo.push(hitsTo[j] + b.hits);
    fixedTo.push(fixedTo[j] + b.fixed);
    garbledTo.push(garbledTo[j] + outsAt[j].filter((m) => out[m].err).length);
  });

  return {
    msg, syms, N, S, L, p, code, compress: state.compress, K: blocks.length,
    src, lStart, lEnd, lFirst, lLast, ch, role, blocks, flip, rx, dec, repaired,
    out, outsAt, consumed, hitsTo, fixedTo, garbledTo,
  };
}

// Compressed text can gain or lose letters after a hit, so errors are marked by the
// cheapest alignment (edit distance) of what arrived against what was sent.
function markByAlignment(out, syms) {
  const M = out.length, N = syms.length, W = N + 1;
  const D = new Uint16Array((M + 1) * W);
  for (let i = 0; i <= M; i++) D[i * W] = i;
  for (let j = 0; j <= N; j++) D[j] = j;
  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      const sub = D[(i - 1) * W + j - 1] + (out[i - 1].sym === syms[j - 1] ? 0 : 1);
      D[i * W + j] = Math.min(sub, D[(i - 1) * W + j] + 1, D[i * W + j - 1] + 1);
    }
  }
  for (const o of out) o.err = true;
  let i = M, j = N;
  while (i > 0 && j > 0) {
    const here = D[i * W + j];
    if (out[i - 1].sym === syms[j - 1] && here === D[(i - 1) * W + j - 1]) { out[i - 1].err = false; i--; j--; }
    else if (here === D[(i - 1) * W + j - 1] + 1) { i--; j--; }
    else if (here === D[(i - 1) * W + j] + 1) i--;
    else j--;
  }
}

function letterAt(s, k) {   // the letter whose bits contain source bit k
  let lo = 0, hi = s.N - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.lStart[mid] <= k) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function blockAtChannel(i) {
  let lo = 0, hi = sim.K - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sim.blocks[mid].c0 <= i) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/* ---------------- elements ---------------- */

const els = {
  srcText: $('src-text'), srcEdit: $('src-edit'), srcAttrib: $('src-attrib'),
  edit: $('edit'), another: $('another'),
  txCost: $('tx-cost'), txOp: $('tx-op'), segCompress: $('seg-compress'), segProtect: $('seg-protect'),
  chLen: $('ch-len'), chOp: $('ch-op'), grid: $('grid'), lgP: $('lg-p'), lgFix: $('lg-fix'),
  noise: $('noise'), noiseLabel: $('noise-label'),
  rxStat: $('rx-stat'), rxOp: $('rx-op'),
  destStat: $('dest-stat'), destText: $('dest-text'),
  tStart: $('t-start'), tBack: $('t-back'), tPlay: $('t-play'), tPlayIcon: $('t-play-icon'),
  tPlayText: $('t-play-text'), tFwd: $('t-fwd'), tEnd: $('t-end'),
  scrub: $('scrub'), tPos: $('t-pos'), tSpeed: $('t-speed'),
  live: $('live-sr'), more: $('more'), cap: $('cap'), capNow: $('cap-now'), huffAvg: $('huff-avg'),
};

/* ---------------- sound (synthesized — no assets) ---------------- */

let actx = null;
let noiseBuf = null;

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!actx) {
    actx = new AC();
    noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.3), actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(freq, dur, { type = 'sine', gain = 0.1, at = 0 } = {}) {
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

// a crackle of static per noise hit — you hear the noise source at work
function sfxCrackle(n) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 2200 + Math.random() * 1800;
  f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.min(0.3, 0.13 + 0.05 * (n - 1)), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + 0.012 * Math.min(n, 6));
  s.connect(f).connect(g).connect(ctx.destination);
  s.start(t, Math.random() * 0.2);
  s.stop(t + 0.14);
}

let lastTap = 0;
function sfxTap(err) {   // the destination's teleprinter, one soft tap per letter printed
  const now = performance.now();
  if (now - lastTap < 45) return;
  lastTap = now;
  tone(err ? 700 : 1500, 0.025, { type: 'square', gain: 0.014 });
}
function sfxKey() { tone(1900, 0.03, { type: 'triangle', gain: 0.05 }); }
function sfxBell() {   // a clean copy rings the teleprinter's bell
  tone(2093, 1.1, { gain: 0.07 });
  tone(3136, 0.6, { gain: 0.025 });
}
function sfxDone() { tone(392, 0.22, { type: 'triangle', gain: 0.06 }); }

function stepSound(j) {
  const b = sim.blocks[j];
  if (b.hits) sfxCrackle(b.hits);
  const outs = sim.outsAt[j];
  if (outs.length) sfxTap(outs.some((m) => sim.out[m].err));
}

function endSound() {
  if (sim.garbledTo[sim.K] === 0) sfxBell(); else sfxDone();
}

/* ---------------- small html helpers ---------------- */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const showChar = (sym) => (sym < 0 ? '…' : sym === 0 ? '␣' : ALPHABET[sym]);
const glyph = (sym, err) => `<span class="glyph${err ? ' err' : ''}">${showChar(sym)}</span>`;
const bit = (v, cls, pos) => `<span class="bit ${cls}"${pos ? ` data-pos="${pos}"` : ''}>${v}</span>`;
const row = (label, content, cls = '') => `<div class="op-row ${cls}"><span class="lbl">${label}</span>${content}</div>`;
const note = (text) => `<div class="op-row"><span class="cap">${text}</span></div>`;
const arrow = '<span class="arrow">→</span>';

// the cells of block b, grouped the way its code is built (triples, or X1…X7)
function blockCells(b, valueOf, classOf) {
  const cell = (i) => bit(valueOf(i), `${sim.role[i]} ${classOf(i)}`, sim.code === 'hamming' ? `X${i - b.c0 + 1}` : '');
  let html = '';
  if (sim.code === 'rep3') {
    for (let i = b.c0; i < b.c1; i += 3) html += `<span class="grp">${cell(i)}${cell(i + 1)}${cell(i + 2)}</span>`;
  } else {
    for (let i = b.c0; i < b.c1; i++) html += cell(i);
  }
  return `<span class="cells">${html}</span>`;
}

function lettersIn(s0, s1) {
  const list = [];
  for (let i = letterAt(sim, s0); i < sim.N && sim.lStart[i] < s1; i++) list.push(i);
  return list;
}

/* ---------------- rendering: one step of the timeline ---------------- */

function render() {
  const c = state.k - 1;
  renderSource(c);
  renderTx(c);
  renderChannel(c);
  renderRx(c);
  renderDest(c);
  renderTransport();
  for (const el of [els.txOp, els.chOp, els.rxOp]) holdHeight(el);
}

// Zoom panels only ever grow within one configuration, so the page never jitters mid-play.
function holdHeight(el) {
  el.style.minHeight = '';
  const h = el.offsetHeight;
  if (h > (el._maxH || 0)) el._maxH = h;
  el.style.minHeight = `${el._maxH}px`;
}
function releaseHeights() {
  for (const el of [els.txOp, els.chOp, els.rxOp]) { el._maxH = 0; el.style.minHeight = ''; }
}

function renderSource(c) {
  const spans = els.srcText.children;
  for (let i = 0; i < spans.length; i++) {
    const f = sim.lFirst[i], l = sim.lLast[i];
    spans[i].className = c < 0 ? '' : f <= c && c <= l ? 'cur' : l < c ? 'sent' : '';
  }
}

function renderTx(c) {
  if (c < 0) { els.txOp.innerHTML = '<p class="idle">Turns each letter into a signal of bits.</p>'; return; }
  const b = sim.blocks[c];
  const letters = lettersIn(b.s0, b.s1).map((i) => {
    let cells = '';
    for (let k = sim.lStart[i]; k < sim.lEnd[i]; k++) cells += bit(sim.src[k], k < b.s0 || k >= b.s1 ? 'd dim' : 'd');
    return `${glyph(sim.syms[i])}<span class="cells">${cells}</span>`;
  }).join('<span class="arrow">+</span>');
  let html = row('code', letters);
  if (sim.code === 'none') {
    html += note(sim.compress ? 'Huffman code: common letters get short codewords. No protection.' : 'Sent as is — no protection.');
  } else if (sim.code === 'rep3') {
    html += row('sends', blockCells(b, (i) => sim.ch[i], () => ''));
    html += note('Every bit, three times over.');
  } else {
    html += row('sends', blockCells(b, (i) => sim.ch[i], () => ''), 'pos');
    html += note('X1, X2, X4 are parity bits: each makes one check (γ, β, α) even.');
  }
  els.txOp.innerHTML = html;
}

function renderChannel(c) {
  drawGrid(c);
  if (c < 0) { els.chOp.innerHTML = '<p class="idle">Carries the signal — and noise gets in.</p>'; return; }
  const b = sim.blocks[c];
  let hitNote = 'Arrived clean.';
  if (b.hits) {
    if (sim.code === 'hamming') {
      const where = [];
      for (let i = b.c0; i < b.c1; i++) if (sim.flip[i]) where.push(`X${i - b.c0 + 1}`);
      hitNote = `Noise flipped <b>${where.join(' and ')}</b>.`;
    } else {
      hitNote = `Noise flipped <b>${plural(b.hits, 'bit')}</b>.`;
    }
  }
  els.chOp.innerHTML = row('arrives', blockCells(b, (i) => sim.rx[i], (i) => (sim.flip[i] ? 'hit' : '')),
    sim.code === 'hamming' ? 'pos' : '') + note(hitNote);
}

function renderRx(c) {
  if (c < 0) {
    els.rxStat.textContent = '';
    els.rxOp.innerHTML = '<p class="idle">Rebuilds the message from what arrives.</p>';
    return;
  }
  const hits = sim.hitsTo[c + 1], fixed = sim.fixedTo[c + 1];
  els.rxStat.textContent = !hits ? 'no hits yet'
    : sim.code === 'none' ? `${plural(hits, 'hit')} got through` : `repaired ${fixed} of ${plural(hits, 'hit')}`;
  const b = sim.blocks[c];
  let html = '';
  if (sim.code === 'hamming') {
    const { a, b: be, g, syn, C } = b.check;
    const chk = (name, v) => `<span class="chk${v ? ' odd' : ''}">${name} <i>${v ? 'odd' : 'even'}</i></span>`;
    html += row('checks', chk('α', a) + chk('β', be) + chk('γ', g) + arrow
      + `<span class="cap"><b>${a}${be}${g}</b>${syn ? ` = ${syn}` : ''}</span>`);
    html += row('fixes', blockCells(b, (i) => C[i - b.c0 + 1], (i) => {
      const pos = i - b.c0 + 1;
      if (C[pos] !== b.X[pos]) return 'hit';
      return syn === pos ? 'fix' : '';
    }), 'pos');
    let why;
    if (!b.hits) why = 'All checks even: nothing to fix.';
    else if (b.ok) why = `Binary ${a}${be}${g} = ${syn}: flip X${syn} back. Repaired.`;
    else if (syn) why = `${b.hits} hits fool the checks — they point at X${syn}, the wrong bit.`;
    else why = `${b.hits} hits cancel out in the checks — nothing looks wrong.`;
    html += note(why);
  } else if (sim.code === 'rep3') {
    const votes = b.votes.map((v) => bit(v.v, `d${v.split ? (v.good ? ' fix' : ' hit') : ''}`)).join('');
    html += row('votes', `<span class="cells">${votes}</span>`);
    const outvoted = b.votes.filter((v) => !v.good).length;
    const fixed = b.votes.filter((v) => v.split && v.good).length;
    html += note(outvoted ? `Two hits in one triple outvote the truth.`
      : fixed ? `Majority vote repaired ${plural(fixed, 'bit')}.` : 'Every triple agrees.');
  }
  html += row('reads', readsHtml(c));
  if (sim.code === 'none') html += note(sim.compress ? 'No way to check — and one wrong bit can derail the reading.' : 'No way to check — bits taken as they come.');
  els.rxOp.innerHTML = html;
}

// the letters the receiver prints at block c, from the bits it has decoded so far
function readsHtml(c) {
  const b = sim.blocks[c];
  const parts = [];
  for (const m of sim.outsAt[c]) {
    const o = sim.out[m];
    let cells = '';
    for (let k = o.b0; k < o.b1; k++) cells += bit(sim.dec[k], k < b.s0 ? 'd dim' : 'd');
    parts.push(`<span class="cells">${cells}</span>${arrow}${glyph(o.sym, o.err)}`);
  }
  const w0 = sim.consumed[c];
  if (w0 < b.s1) {
    let cells = '';
    for (let k = w0; k < b.s1; k++) cells += bit(sim.dec[k], k < b.s0 ? 'd dim' : 'd');
    parts.push(`<span class="cells">${cells}</span><span class="cap">… waiting for more bits</span>`);
  }
  return parts.join('<span class="arrow">·</span>');
}

function renderDest(c) {
  const spans = els.destText.children;
  let printed = 0;
  for (let m = 0; m < spans.length; m++) {
    const o = sim.out[m];
    if (o.block > c) { spans[m].className = 'hid'; continue; }
    printed++;
    spans[m].className = (o.block === c ? 'new' : '') + (o.err ? ' err' : '');
  }
  const garbled = c < 0 ? 0 : sim.garbledTo[c + 1];
  els.destStat.textContent = !printed ? 'waiting…'
    : garbled ? `${plural(garbled, 'letter')} garbled`
      : c === sim.K - 1 ? '✓ perfect copy' : '✓ perfect so far';
}

const ICON = {
  play: 'M7 4.8v14.4L19 12z',
  pause: 'M6.5 5h4v14h-4zM13.5 5h4v14h-4z',
  again: 'M12 5V1.5L7 6l5 4.5V7a5 5 0 1 1-5 5H4.6A7.4 7.4 0 1 0 12 5z',
};

function renderTransport() {
  const { K } = sim, k = state.k;
  els.scrub.max = String(Math.max(K, 1));
  els.scrub.value = String(k);
  els.scrub.style.setProperty('--fill', `${K ? (k / K) * 100 : 0}%`);
  els.tPos.textContent = `${sim.code === 'hamming' ? 'block' : 'letter'} ${k} / ${K}`;
  els.tStart.disabled = els.tBack.disabled = k === 0;
  els.tFwd.disabled = els.tEnd.disabled = k >= K;
  els.tPlay.disabled = K === 0;
  let icon = 'play', text = 'Play';
  if (state.playing) { icon = 'pause'; text = 'Pause'; }
  else if (k === 0) text = 'Send';
  else if (k >= K) { icon = 'again'; text = 'Send again'; }
  els.tPlayIcon.firstElementChild.setAttribute('d', ICON[icon]);
  els.tPlayText.textContent = text;
}

/* ---------------- the channel's whole signal, one square per bit ---------------- */

let colors = {};
let gridGeom = null;

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const name of ['data', 'prot', 'noise', 'slot', 'ink']) colors[name] = cs.getPropertyValue(`--${name}`).trim();
}

function drawGrid(c) {
  const cv = els.grid;
  const W = cv.clientWidth;
  if (!W) return;
  const cell = W >= 480 ? 5 : 3, gap = 1, pitch = cell + gap;   // a texture on phones, countable on desktop
  const cols = Math.max(1, Math.floor((W + gap) / pitch));
  const rows = Math.max(1, Math.ceil(sim.L / cols));
  const H = rows * pitch - gap;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.height = `${H}px`;
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const b = c >= 0 ? sim.blocks[c] : null;
  const sentEnd = b ? b.c1 : 0;
  const at = (i) => [(i % cols) * pitch, Math.floor(i / cols) * pitch];
  if (b) {   // the block on screen gets an ink rim
    g.fillStyle = colors.ink;
    for (let i = b.c0; i < b.c1; i++) { const [x, y] = at(i); g.fillRect(x - 1, y - 1, cell + 2, cell + 2); }
  }
  for (let i = 0; i < sim.L; i++) {
    const [x, y] = at(i);
    if (i >= sentEnd) { g.fillStyle = colors.slot; g.fillRect(x, y, cell, cell); continue; }
    if (sim.flip[i] && sim.repaired[i]) {   // a hit the receiver repaired: a faded scar
      g.globalAlpha = 0.4;
      g.fillStyle = colors.noise;
      g.fillRect(x, y, cell, cell);
      g.globalAlpha = 1;
      continue;
    }
    g.fillStyle = sim.flip[i] ? colors.noise : sim.role[i] === 'd' ? colors.data : colors.prot;
    g.fillRect(x, y, cell, cell);
  }
  gridGeom = { cols, pitch };
  const hits = c >= 0 ? sim.hitsTo[c + 1] : 0;
  cv.setAttribute('aria-label', `The signal: ${sim.L} bits, ${sentEnd} sent, ${plural(hits, 'hit')} by noise so far.`);
}

/* ---------------- Shannon's limit (details) ---------------- */

const H2 = (p) => (p <= 0 || p >= 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p));
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs, text) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

const CAP = { W: 640, H: 320, l: 50, r: 118, t: 18, b: 48 };
const capX = (p) => CAP.l + (p / 0.5) * (CAP.W - CAP.l - CAP.r);
const capY = (v) => CAP.t + (1 - v) * (CAP.H - CAP.t - CAP.b);

function drawCapacity() {
  const svg = els.cap;
  svg.replaceChildren();
  const x0 = capX(0), x1 = capX(0.5), y0 = capY(0), y1 = capY(1);
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(svgEl('line', { class: v === 0 ? 'axisline' : 'gridline', x1: x0, x2: x1, y1: capY(v), y2: capY(v) }));
    svg.append(svgEl('text', { class: 'tick', x: x0 - 8, y: capY(v) + 4, 'text-anchor': 'end' }, v === 0 || v === 1 ? String(v) : v.toFixed(2)));
  }
  for (const p of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) {
    svg.append(svgEl('text', { class: 'tick', x: capX(p), y: y0 + 18, 'text-anchor': 'middle' }, p ? `${p * 100}%` : '0'));
  }
  svg.append(svgEl('text', { class: 'axis-title', x: (x0 + x1) / 2, y: CAP.H - 6, 'text-anchor': 'middle' }, 'noise: share of bits flipped'));
  svg.append(svgEl('text', { class: 'axis-title', x: 14, y: (y0 + y1) / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${(y0 + y1) / 2})` }, 'message bits per bit sent'));

  let d = '';
  for (let s = 0; s <= 200; s++) { const p = (s / 200) * 0.5; d += `${s ? 'L' : 'M'}${capX(p).toFixed(1)},${capY(1 - H2(p)).toFixed(1)}`; }
  svg.append(svgEl('path', { class: 'area', d: `${d}L${x1},${y0}L${x0},${y0}Z` }));
  svg.append(svgEl('path', { class: 'curve', d }));
  svg.append(svgEl('text', { class: 'zone', x: capX(0.012), y: capY(0.1) }, 'possible, with a good enough code'));
  svg.append(svgEl('text', { class: 'zone faint', x: capX(0.3), y: capY(0.84), 'text-anchor': 'middle' }, 'impossible'));

  for (const code of ['none', 'hamming', 'rep3']) {
    const now = code === sim.code;
    const y = capY(RATE[code]);
    svg.append(svgEl('line', { class: `rate${now ? ' now' : ''}`, x1: x0, x2: x1, y1: y, y2: y }));
    const name = { none: 'no protection', hamming: 'Hamming', rep3: 'repeat ×3' }[code];
    svg.append(svgEl('text', { class: `rate-label${now ? ' now' : ''}`, x: x1 + 8, y: y + 4 }, `${name} · ${RATE_TEXT[code]}`));
  }

  const px = capX(sim.p), py = capY(RATE[sim.code]);
  svg.append(svgEl('circle', { class: 'you', cx: px, cy: py, r: 6 }));
  svg.append(svgEl('text', { class: 'you-label', x: px + 10, y: py - 9 }, 'you'));

  // hover: read the limit anywhere on the curve
  const hover = svgEl('g', { visibility: 'hidden' });
  const hl = svgEl('line', { class: 'hover-line', y1: y1, y2: y0 });
  const hd = svgEl('circle', { class: 'hover-dot', r: 4.5 });
  const ht = svgEl('text', { class: 'hover-text' });
  hover.append(hl, hd, ht);
  svg.append(hover);
  const hit = svgEl('rect', { x: x0, y: y1, width: x1 - x0, height: y0 - y1, fill: 'transparent' });
  svg.append(hit);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * CAP.W;
    const p = Math.min(0.5, Math.max(0, ((sx - x0) / (x1 - x0)) * 0.5));
    const C = 1 - H2(p), hx = capX(p), hy = capY(C);
    hl.setAttribute('x1', hx); hl.setAttribute('x2', hx);
    hd.setAttribute('cx', hx); hd.setAttribute('cy', hy);
    const right = hx < x1 - 170;
    ht.setAttribute('x', right ? hx + 10 : hx - 10);
    ht.setAttribute('y', Math.max(y1 + 14, hy - 12));
    ht.setAttribute('text-anchor', right ? 'start' : 'end');
    ht.textContent = `${(p * 100).toFixed(1)}% flipped → at most ${C.toFixed(2)}`;
    hover.setAttribute('visibility', 'visible');
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => hover.setAttribute('visibility', 'hidden'));

  const C = 1 - H2(sim.p), R = RATE[sim.code];
  const nN = NOISE_N[state.noiseIdx];
  let verdict;
  if (!sim.p) verdict = 'With no noise, every bit can carry a whole bit of message.';
  else {
    verdict = `At 1 in ${nN} bits flipped, each bit can carry at most <b>${C.toFixed(2)}</b> bits of message. `;
    if (sim.code === 'none') verdict += 'Sending every bit as message (rate 1) overshoots, so errors are certain.';
    else if (R > C) verdict += `Your rate, ${RATE_TEXT[sim.code]}, overshoots: no code at this rate gets through reliably.`;
    else verdict += `Your rate, ${RATE_TEXT[sim.code]}, is under it — so some code at this rate makes errors as rare as you like. `
      + (sim.code === 'hamming' ? 'Shannon proved it exists; 7-bit blocks are too short to be it.' : 'Repetition just wastes most of the room.');
  }
  els.capNow.innerHTML = verdict;
}

/* ---------------- rebuilding after a change ---------------- */

function rebuild(keep) {
  const old = sim, oldK = state.k;
  sim = simulate();
  if (keep === 'start' || !old) state.k = 0;
  else if (keep === 'k') state.k = Math.min(oldK, sim.K);
  else if (oldK === 0) state.k = 0;
  else if (oldK >= old.K) state.k = sim.K;
  else state.k = Math.min(sim.K, sim.lFirst[letterAt(old, old.blocks[oldK - 1].s0)] + 1);   // same letter, new code
  if (keep !== 'k') releaseHeights();
  buildTexts();
  renderStatic();
  render();
  drawCapacity();
}

function buildTexts() {
  els.srcText.innerHTML = sim.syms.map((s, i) => `<span data-i="${i}">${ALPHABET[s]}</span>`).join('');
  els.destText.innerHTML = sim.out.map((o, m) => `<span data-m="${m}">${o.sym < 0 ? '…' : ALPHABET[o.sym]}</span>`).join('');
  els.srcAttrib.textContent = `— ${state.by}`;
}

function renderStatic() {
  paintSeg(els.segCompress, state.compress ? 'on' : 'off');
  paintSeg(els.segProtect, state.code);
  els.txCost.textContent = sim.N ? `${fmtBits(sim.L / sim.N)} bits per letter` : '';
  els.chLen.textContent = `${sim.L.toLocaleString('en-US')} bits`;
  els.lgP.hidden = els.lgFix.hidden = sim.code === 'none';
  const nN = NOISE_N[state.noiseIdx];
  els.noise.value = String(state.noiseIdx);
  els.noise.style.setProperty('--fill', `${(state.noiseIdx / (NOISE_N.length - 1)) * 100}%`);
  els.noiseLabel.textContent = !nN ? 'silent' : nN === 2 ? '1 in 2 — pure static' : `1 in ${nN} bits flipped`;
}

function fmtBits(x) {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function paintSeg(el, v) {
  for (const b of el.querySelectorAll('button')) {
    const on = b.dataset.v === v;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
}

/* ---------------- transport ---------------- */

let raf = 0, lastT = 0, acc = 0;

function play() {
  if (!sim.K) return;
  if (state.k >= sim.K) {   // "Send again": a fresh roll of the noise
    state.seed = newSeed();
    rebuild('start');
  }
  state.playing = true;
  lastT = performance.now();
  acc = 0;
  sfxKey();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  renderTransport();
}

function pause() {
  if (!state.playing) return;
  state.playing = false;
  cancelAnimationFrame(raf);
  renderTransport();
}

function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  acc += dt * SPEEDS[state.speed].bps;   // the channel runs at a fixed bit rate: redundancy costs time
  let moved = false;
  while (state.k < sim.K) {
    const b = sim.blocks[state.k];
    if (acc < b.c1 - b.c0) break;
    acc -= b.c1 - b.c0;
    state.k++;
    moved = true;
    stepSound(state.k - 1);
  }
  if (state.k >= sim.K) {
    state.playing = false;
    render();
    endSound();
    announce();
    return;
  }
  if (moved) render();
  raf = requestAnimationFrame(frame);
}

function stepTo(k, withSound = false) {
  k = Math.max(0, Math.min(sim.K, k));
  if (k === state.k) return;
  const forward = k === state.k + 1;
  state.k = k;
  if (withSound && forward) stepSound(k - 1);
  render();
  if (withSound && forward && k === sim.K) { endSound(); announce(); }
}

function announce() {
  const g = sim.garbledTo[sim.K];
  els.live.textContent = `Received: ${sim.out.map((o) => (o.sym < 0 ? '' : ALPHABET[o.sym])).join('')}. `
    + (g ? `${plural(g, 'letter')} garbled.` : 'A perfect copy.');
}

els.tPlay.addEventListener('click', () => { audio(); if (state.playing) pause(); else play(); });
els.tStart.addEventListener('click', () => { pause(); stepTo(0); });
els.tBack.addEventListener('click', () => { pause(); stepTo(state.k - 1); });
els.tFwd.addEventListener('click', () => { audio(); pause(); stepTo(state.k + 1, true); });
els.tEnd.addEventListener('click', () => { pause(); stepTo(sim.K); });
els.scrub.addEventListener('input', () => { pause(); stepTo(+els.scrub.value); });
els.tSpeed.addEventListener('click', () => {
  state.speed = (state.speed + 1) % SPEEDS.length;
  els.tSpeed.textContent = SPEEDS[state.speed].label;
  els.tSpeed.setAttribute('aria-label', `Playback speed ${SPEEDS[state.speed].label}`);
});

document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const t = ev.target;
  if (t.closest('textarea')) return;
  const seg = t.closest('.seg');
  if (seg && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {   // radio-group arrows
    ev.preventDefault();
    const btns = [...seg.querySelectorAll('button')];
    const i = btns.indexOf(t.closest('button'));
    const next = btns[(i + (ev.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
    next.focus();
    next.click();
    return;
  }
  if (t.matches('input[type="range"]')) return;
  if (ev.key === ' ' && !t.closest('button, a, summary')) { ev.preventDefault(); els.tPlay.click(); }
  else if (ev.key === 'ArrowRight') { ev.preventDefault(); audio(); pause(); stepTo(state.k + 1, true); }
  else if (ev.key === 'ArrowLeft') { ev.preventDefault(); pause(); stepTo(state.k - 1); }
  else if (ev.key === 'Home') { ev.preventDefault(); pause(); stepTo(0); }
  else if (ev.key === 'End') { ev.preventDefault(); pause(); stepTo(sim.K); }
});

// tap a letter or a square of the signal to jump to the moment it was sent
els.srcText.addEventListener('click', (ev) => {
  const i = ev.target.dataset?.i;
  if (i == null || !sim.K) return;
  pause();
  stepTo(sim.lFirst[+i] + 1);
});
els.destText.addEventListener('click', (ev) => {
  const m = ev.target.dataset?.m;
  if (m == null) return;
  pause();
  stepTo(sim.out[+m].block + 1);
});
els.grid.addEventListener('click', (ev) => {
  if (!gridGeom || !sim.K) return;
  const r = els.grid.getBoundingClientRect();
  const col = Math.floor((ev.clientX - r.left) / gridGeom.pitch);
  const i = Math.floor((ev.clientY - r.top) / gridGeom.pitch) * gridGeom.cols + col;
  if (col < 0 || col >= gridGeom.cols || i < 0 || i >= sim.L) return;
  pause();
  stepTo(blockAtChannel(i) + 1);
});

/* ---------------- controls ---------------- */

function wireSeg(el, onPick) {
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-v]');
    if (b && b.getAttribute('aria-checked') !== 'true') onPick(b.dataset.v);
  });
}
wireSeg(els.segCompress, (v) => { state.compress = v === 'on'; rebuild('letter'); });
wireSeg(els.segProtect, (v) => { state.code = v; rebuild('letter'); });

els.noise.addEventListener('input', () => {
  state.noiseIdx = +els.noise.value;
  const before = sim.hitsTo[state.k];
  rebuild('k');
  const after = sim.hitsTo[state.k];
  if (after > before) sfxCrackle(Math.min(after - before, 6));
});

els.another.addEventListener('click', () => {
  if (!els.srcEdit.hidden) finishEdit(false);
  pause();
  state.msgIdx = (state.msgIdx + 1) % MESSAGES.length;
  state.raw = MESSAGES[state.msgIdx].text;
  state.by = MESSAGES[state.msgIdx].by;
  rebuild('start');
});

els.edit.addEventListener('click', () => { if (els.srcEdit.hidden) startEdit(); else finishEdit(true); });

function startEdit() {
  pause();
  els.srcEdit.value = state.raw;
  els.srcText.hidden = true;
  els.srcEdit.hidden = false;
  els.edit.textContent = '✓';
  els.edit.setAttribute('aria-pressed', 'true');
  els.edit.setAttribute('aria-label', 'Done');
  autosize();
  els.srcEdit.focus();
  els.srcEdit.select();
}

function finishEdit(commit) {
  if (els.srcEdit.hidden) return;
  const v = els.srcEdit.value;
  els.srcEdit.hidden = true;
  els.srcText.hidden = false;
  els.edit.textContent = '✎';
  els.edit.setAttribute('aria-pressed', 'false');
  els.edit.setAttribute('aria-label', 'Type your own message');
  if (commit && normalize(v) && v !== state.raw) {
    state.raw = v;
    state.by = 'your message';
    state.msgIdx = -1;
    rebuild('start');
  }
}

function autosize() {
  els.srcEdit.style.height = 'auto';
  els.srcEdit.style.height = `${els.srcEdit.scrollHeight}px`;
}
els.srcEdit.addEventListener('input', autosize);
els.srcEdit.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') { ev.preventDefault(); finishEdit(true); }
  else if (ev.key === 'Escape') { ev.preventDefault(); finishEdit(false); }
});
els.srcEdit.addEventListener('blur', () => setTimeout(() => finishEdit(true), 150));

// iOS unlocks WebAudio only inside a genuine user gesture — prime it once.
window.addEventListener('touchend', () => audio(), { once: true, passive: true });

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); drawGrid(state.k - 1); });
let lastWidth = 0;
new ResizeObserver(([entry]) => {   // re-lay out on width changes only (panel growth changes height)
  const w = Math.round(entry.contentRect.width);
  if (w === lastWidth) return;
  lastWidth = w;
  releaseHeights();
  if (sim) render();
}).observe(els.grid.parentElement);

/* ---------------- init (+ test hooks: ?demo ?code= ?compress ?noise= ?step= ?seed= ?msg= ?details ?dark) ---------------- */

console.log('communication-system build v1');
els.huffAvg.textContent = HUFFMAN_AVG.toFixed(2);
if (params.has('demo')) { state.seed = 1948; state.code = 'hamming'; state.noiseIdx = NOISE_N.indexOf(20); }
if (params.has('seed')) state.seed = +params.get('seed') >>> 0;
if (['none', 'rep3', 'hamming'].includes(params.get('code'))) state.code = params.get('code');
if (params.has('compress')) state.compress = true;
if (params.has('noise') && NOISE_N.includes(+params.get('noise'))) state.noiseIdx = NOISE_N.indexOf(+params.get('noise'));
if (params.has('msg') && MESSAGES[+params.get('msg')]) {
  state.msgIdx = +params.get('msg');
  state.raw = MESSAGES[state.msgIdx].text;
  state.by = MESSAGES[state.msgIdx].by;
}
readColors();
rebuild('start');
const stepParam = params.get('step') ?? (params.has('demo') ? 'hit' : null);
if (stepParam === 'end') stepTo(sim.K);
else if (stepParam === 'hit') {   // first block where the receiver repaired a hit (else any hit)
  const j = sim.blocks.findIndex((b) => b.fixed > 0);
  stepTo((j >= 0 ? j : Math.max(0, sim.blocks.findIndex((b) => b.hits > 0))) + 1);
} else if (stepParam != null) stepTo(+stepParam);
if (params.has('details')) els.more.open = true;
