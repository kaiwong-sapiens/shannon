/* Find the Flipped Bits — part of `shannon` (explorables for information theory).
   Shannon (1948) §12 by hand: 100 bits arrive through a noisy channel and the receiver can't
   see which ones flipped. An observer who saw what was sent answers yes/no questions — "any
   flips among these bits?" — one bit per answer. What it costs to repair the block is the
   equivocation: the information the noise destroyed. */

'use strict';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.has('dark')) document.documentElement.dataset.theme = 'dark';

const N = 100;
const COLS = 10;
const H2 = (p) => (p <= 0 || p >= 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p));

/* ---------------- rng (seedable so screenshots reproduce) ---------------- */

function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(params.has('seed') ? +params.get('seed') >>> 0
  : params.has('demo') ? 12 : (Math.random() * 4294967296) >>> 0);

/* ---------------- state ---------------- */

const state = {
  oneIn: 100,      // the noise flips 1 bit in this many
  arrived: [],     // what the receiver sees
  flip: [],        // the truth: which arrivals are wrong
  known: [],       // 0 unknown · 1 cleared (arrived intact) · 2 fixed (was flipped)
  groups: [],      // unexplained "yes" answers: unknown bits holding at least one flip
  asked: 0,
  fixed: 0,
  done: false,
  sel: null,       // [a, b]: the picked run of bits, in reading order
  last: null,      // the latest answer, for the status line
  auto: false,
};
const stats = {};  // per noise level: { blocks, asked }

function newBlock() {
  const p = 1 / state.oneIn;
  state.arrived = Array.from({ length: N }, () => (rand() < 0.5 ? 1 : 0));
  state.flip = Array.from({ length: N }, () => (rand() < p ? 1 : 0));
  state.known = new Array(N).fill(0);
  state.groups = [];
  state.asked = 0;
  state.fixed = 0;
  state.done = false;
  state.sel = null;
  state.last = null;
}

const unknownIn = (a, b) => {
  const out = [];
  for (let i = a; i <= b; i++) if (state.known[i] === 0) out.push(i);
  return out;
};
const unknownAll = () => unknownIn(0, N - 1);

// Ask the observer about the picked run (or, with nothing picked, every bit not yet cleared).
function ask() {
  if (state.done) return null;
  const [a, b] = state.sel || [0, N - 1];
  const group = unknownIn(a, b);
  if (!group.length) return null;
  state.asked++;
  const yes = group.some((i) => state.flip[i]);
  if (yes) state.groups.push(group);
  else for (const i of group) state.known[i] = 1;
  const found = resolve();
  state.sel = null;
  state.last = { yes, group, found };
  if (!unknownAll().length) finishBlock();
  return state.last;
}

// A "yes" group whittled down to one unknown bit must hold the flip: fix it. A group with a
// fixed bit is explained (the yes is accounted for) and says nothing more about the rest.
function resolve() {
  const found = [];
  for (let changed = true; changed;) {
    changed = false;
    state.groups = state.groups.filter((g) => !g.some((i) => state.known[i] === 2));
    for (const g of state.groups) {
      const u = g.filter((i) => state.known[i] === 0);
      if (u.length === 1) {
        state.known[u[0]] = 2;
        state.fixed++;
        found.push(u[0]);
        changed = true;
        break;
      }
    }
  }
  state.groups = state.groups.map((g) => g.filter((i) => state.known[i] === 0)).filter((g) => g.length);
  return found;
}

function finishBlock() {
  state.done = true;
  const s = stats[state.oneIn] || (stats[state.oneIn] = { blocks: 0, asked: 0 });
  s.blocks++;
  s.asked += state.asked;
}

// The observer's own good play: split the newest "yes" in half; otherwise ask about a fresh
// run sized so it comes back clean about half the time (that's what makes an answer worth a bit).
function autoRange() {
  const g = state.groups[state.groups.length - 1];
  if (g) {
    const half = g.slice(0, Math.floor(g.length / 2));
    return [half[0], half[half.length - 1]];
  }
  const u = unknownAll();
  const p = 1 / state.oneIn;
  const m = Math.max(1, Math.min(u.length, Math.round(Math.log(0.5) / Math.log(1 - p))));
  return [u[0], u[m - 1]];
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
function tone(freq, dur, { type = 'sine', gain = 0.08, at = 0 } = {}) {
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
const sfxYes = () => { tone(659.25, 0.12, { type: 'triangle' }); tone(987.77, 0.18, { type: 'triangle', at: 0.09 }); };
const sfxNo = () => tone(329.63, 0.16, { type: 'triangle', gain: 0.07 });
const sfxFix = () => { tone(1567.98, 0.4, { gain: 0.08 }); tone(2349.32, 0.28, { gain: 0.035, at: 0.05 }); };
const sfxDone = () => [783.99, 987.77, 1174.66].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.06, at: 0.25 + i * 0.08 }));

/* ---------------- elements ---------------- */

const els = {
  grid: $('grid'), status: $('status'), ask: $('ask'),
  asked: $('l-asked'), askedUnit: $('l-asked-unit'), fixed: $('l-fixed'), fixedUnit: $('l-fixed-unit'),
  seg: $('seg-noise'), stats: $('stats'), avg: $('avg'), avgSub: $('avg-sub'), auto: $('auto'),
};
const tiles = [];
for (let i = 0; i < N; i++) {
  const t = document.createElement('div');
  t.className = 'tile';
  t.dataset.i = i;
  els.grid.append(t);
  tiles.push(t);
}

/* ---------------- rendering ---------------- */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function render() {
  const suspects = new Set(state.groups.flat());
  const [a, b] = state.sel || [-1, -2];
  for (let i = 0; i < N; i++) {
    const k = state.known[i];
    tiles[i].textContent = String(state.arrived[i] ^ (k === 2 ? 1 : 0));
    let cls = 'tile';
    if (k === 1) cls += ' clean';
    else if (k === 2) cls += ' fixed';
    else {
      if (suspects.has(i)) cls += ' suspect';
      if (i >= a && i <= b) cls += ' sel';
    }
    const live = tiles[i].classList;   // keep an answer pulse that is still running
    const next = cls + (live.contains('ans-yes') ? ' ans-yes' : live.contains('ans-no') ? ' ans-no' : '');
    if (tiles[i].className !== next) tiles[i].className = next;
  }
  els.asked.textContent = state.asked;
  els.askedUnit.textContent = state.asked === 1 ? 'question' : 'questions';
  els.fixed.textContent = state.fixed;
  els.fixedUnit.textContent = state.fixed === 1 ? 'flip' : 'flips';
  els.status.innerHTML = statusText();

  const picked = state.sel ? unknownIn(state.sel[0], state.sel[1]).length : 0;
  const left = unknownAll().length;
  if (state.done) els.ask.textContent = 'Next block';
  else if (state.sel) els.ask.textContent = picked ? `Any flips in ${picked === 1 ? 'this bit' : `these ${picked} bits`}?` : 'Nothing new to ask about there';
  else els.ask.textContent = left === N ? 'Any flips at all?' : `Any flips in the ${plural(left, 'bit', 'bits')} left?`;
  els.ask.disabled = state.auto || (!state.done && !!state.sel && !picked);
  for (const btn of els.seg.querySelectorAll('button')) {
    btn.setAttribute('aria-checked', String(+btn.dataset.v === state.oneIn));
    btn.disabled = state.auto;
  }
  els.auto.disabled = state.auto;

  const s = stats[state.oneIn];
  els.stats.hidden = !s;
  if (s) {
    const p = 1 / state.oneIn;
    els.avg.innerHTML = `Over ${plural(s.blocks, 'block', 'blocks')}, finding the flips cost <b>${(s.asked / s.blocks).toFixed(1)}</b> bits per 100.`;
    els.avgSub.innerHTML = `Shannon's answer for 1 in ${state.oneIn}: <b>${(100 * H2(p)).toFixed(1)}</b> per 100. So of every 1,000 bits sent, about <b>${Math.round(1000 * (1 - H2(p)))}</b> get through as information — not ${1000 - 1000 / state.oneIn}.`;
  }
}

function statusText() {
  if (state.done) {
    const q = state.asked, f = state.fixed;
    const paid = `<b>${plural(q, 'bit', 'bits')}</b>`;
    const head = f ? `${plural(f, 'flip', 'flips')}, and finding ${f === 1 ? 'it' : 'them'} cost ${paid}.`
      : `No flips this time — but making sure cost ${paid}.`;
    const tail = q >= N ? ' These 100 bits told you nothing you didn’t pay for.'
      : ` These 100 bits brought you 100 − ${q} = <b>${N - q}</b> bits of information.`;
    return head + tail;
  }
  if (state.sel) return 'Ask the observer about the blue bits — the answer costs one bit.';
  const L = state.last;
  if (!L) return 'Some of these bits may have flipped on the way — which ones? Drag across bits to pick a group, or ask about all of them.';
  if (L.found.length) return `Found ${L.found.length === 1 ? 'one' : L.found.length}: the answers pin it down, so it flips back. Any more out there?`;
  if (L.yes) return '<b>Yes</b> — at least one flip hides in the orange bits. Narrow it down: ask about half of them.';
  return '<b>No</b> — those bits arrived intact (faded).';
}

function pulse(group, yes) {
  for (const i of group) {
    if (state.known[i] === 2) continue;   // a just-fixed bit plays its flip-back instead
    const t = tiles[i];
    t.classList.remove('ans-yes', 'ans-no');
    void t.offsetWidth;   // restart the animation
    t.classList.add(yes ? 'ans-yes' : 'ans-no');
    setTimeout(() => t.classList.remove('ans-yes', 'ans-no'), 420);
  }
}

/* ---------------- playing ---------------- */

function doAsk(quiet = false) {
  const r = ask();
  if (!r) return;
  render();
  if (quiet) return;
  pulse(r.group, r.yes);
  if (r.found.length) sfxFix(); else if (r.yes) sfxYes(); else sfxNo();
  if (state.done) sfxDone();
}

els.ask.addEventListener('click', () => {
  audio();
  if (state.done) { newBlock(); render(); return; }
  doAsk();
});

let dragFrom = null, tapToggle = false, moved = false;
function tileAt(x, y) {
  const r = els.grid.getBoundingClientRect();
  const col = Math.min(COLS - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * COLS)));
  const row = Math.min(N / COLS - 1, Math.max(0, Math.floor(((y - r.top) / r.height) * (N / COLS))));
  return row * COLS + col;
}
els.grid.addEventListener('pointerdown', (e) => {
  if (state.done || state.auto) return;
  e.preventDefault();
  try { els.grid.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
  const i = tileAt(e.clientX, e.clientY);
  tapToggle = !!state.sel && state.sel[0] === i && state.sel[1] === i;
  moved = false;
  dragFrom = i;
  state.sel = [i, i];
  render();
});
els.grid.addEventListener('pointermove', (e) => {
  if (dragFrom == null) return;
  const i = tileAt(e.clientX, e.clientY);
  if (i !== dragFrom) moved = true;
  const sel = [Math.min(dragFrom, i), Math.max(dragFrom, i)];
  if (!state.sel || sel[0] !== state.sel[0] || sel[1] !== state.sel[1]) { state.sel = sel; render(); }
});
const endDrag = () => {
  if (dragFrom == null) return;
  if (tapToggle && !moved) { state.sel = null; render(); }   // tapping the lone picked bit again un-picks it
  dragFrom = null;
};
els.grid.addEventListener('pointerup', endDrag);
els.grid.addEventListener('pointercancel', endDrag);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.sel && !state.auto) { state.sel = null; render(); }
});

els.seg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b || state.auto || +b.dataset.v === state.oneIn) return;
  state.oneIn = +b.dataset.v;
  newBlock();
  render();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));

// The observer plays: the first block slowly (watch the halving), the rest fast.
async function autoPlay(blocks) {
  audio();
  state.auto = true;
  const perFrame = Math.max(1, Math.round((N * H2(1 / state.oneIn) * (blocks - 1)) / 360));
  for (let n = 0; n < blocks; n++) {
    if (state.done) { newBlock(); render(); await sleep(n === 1 ? 400 : 60); }
    const slow = n === 0;
    let k = 0;
    while (!state.done) {
      state.sel = autoRange();
      if (slow) { render(); await sleep(500); }
      doAsk(!slow);
      if (slow) await sleep(650);
      else if (++k % perFrame === 0) await frame();
    }
    render();
    if (slow) await sleep(1400);
  }
  state.auto = false;
  render();
}
els.auto.addEventListener('click', () => autoPlay(20));

window.addEventListener('touchend', () => audio(), { once: true, passive: true });   // iOS audio unlock

/* ---------------- init (+ test hooks: ?demo ?seed= ?noise= ?auto ?dark) ---------------- */

console.log('flipped-bits build v1');
if ([100, 10, 2].includes(+params.get('noise'))) state.oneIn = +params.get('noise');
newBlock();
if (params.has('demo')) {   // a block mid-hunt: one yes, then a picked half
  while (!state.flip.some(Boolean)) newBlock();
  doAsk(true);
  if (state.groups.length) state.sel = autoRange();
}
render();
if (params.has('auto')) autoPlay(+params.get('auto') || 20);
