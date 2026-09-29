# shannon

**Claude Shannon's ideas, made playable.**

**▶ Play it live: <https://kaiwong-sapiens.github.io/shannon/>**

Small interactive games that turn the foundations of information theory into things
you can feel. Shannon's 1948 paper *A Mathematical Theory of Communication* invented
the bit, entropy, and channel capacity — this repo tries to give you the *intuition*
for those ideas, one game at a time.

## Play

No build step, no dependencies — plain HTML/CSS/JS.

```sh
python3 -m http.server            # then open http://localhost:8000
```

or just open `index.html` straight from disk. Everything works offline.

## Explorables

### 1 · Guess the Coin's Entropy — [`games/coin-entropy/`](games/coin-entropy/)

![Guess the Coin's Entropy — reveal screen](docs/coin-entropy.png)

A coin is minted with a secret bias. Press it to spin, release to let it coast and
land — every flip is a real toss. Watch the tally drift, then pick **its entropy**
— the surprise per flip — from three candidate values: one is exact, the other two
are distractors (one close, one far), so you still have to genuinely discriminate.
Wrong picks get crossed off — flip a few more and try again until you find it.
No scores, no streaks; just the coin and your read of it. When you land the right
answer, everything else — where the coin sits on the binary entropy curve, what
your flips suggested, the worked formula, and the sampling-noise floor — waits
behind a "Show the details" fold for the curious.

Entropy is treated as a tangible property of the coin itself: heads and tails are
distinct faces engraved like a real coin (obverse: gold, Shannon's portrait;
reverse: violet, a star over 1948), the coin **fidgets in proportion to the
entropy your flips imply** (restlessness = unpredictability, computed from the
observed tally so it never leaks the answer), and at the reveal it turns over to
show its true worth stamped into the metal — bits per flip, like a denomination.

What it's designed to teach:

- A fair coin is worth exactly **1 bit** per flip; a certain outcome is worth **0**.
- The entropy curve is *flat near the top* — a 60/40 coin still carries 0.97 bits.
  Mild bias hides in plain sight.
- Sampling is noisy: with few flips, even a perfect reasoner can't pin entropy down.
  The reveal quantifies that noise floor, so you know when your miss was just luck.

The math, for the curious: entropy of a coin with heads-probability *p* is
`H(p) = −p·log₂p − (1−p)·log₂(1−p)` bits. The first two rounds are a fixed
curriculum — the poles of the curve: a perfectly fair coin (exactly 1 bit), then
a one-sided coin (0 bits). After that, hidden coins are sampled *uniformly in
entropy* (not in bias) so low-, mid-, and high-entropy coins all show up equally
often, with the fair and one-sided anchors recurring occasionally (10% / 6%).

### 2 · The Redundancy of English — [`games/redundancy-of-english/`](games/redundancy-of-english/)

Shannon's 1951 experiment (*Prediction and Entropy of Printed English*) as a
game: a hidden sentence from the Gutenberg corpus, guessed one letter at a time
on a 27-key board. Wrong keys get crossed off; revealed letters are colored by
how many guesses they cost (a sequential blue ramp — first-try letters visibly
recede, expensive ones pop), and no word boundaries are shown ahead of the
cursor, just as Shannon's subject saw nothing ahead. Your guess counts are the
measurement: the reveal computes Shannon's 1951 bounds from them
(Σi(qᵢ−qᵢ₊₁)log₂ i ≤ H ≤ −Σqᵢlog₂ qᵢ) and reports *your* entropy of English in
bits/letter, pooled across the session, with a guess-count histogram behind a
fold. The reveal-note loudness scales with guess cost — surprise you can hear.
Sentences are pre-extracted by `make_sentences.py` from the same corpus as the
redundancy experiment.

### 3 · The Communication System — [`games/communication-system/`](games/communication-system/)

Fig. 1 of the 1948 paper as a simulator: **information source → transmitter →
channel (+ noise source) → receiver → destination**, each box live. Pick a message
(Shannon's own opening line, Morse's first telegram, Bell's first call, Apollo 11,
Shannon's random letters — or type your own), set the transmitter, turn the noise
dial, and send. The signal crosses the channel at a fixed bit rate, so redundancy
costs real time; each noise hit crackles, the destination's teleprinter taps out
what arrives, and a clean copy rings the bell.

- **Transmitter:** *compress* swaps the plain 5-bit code (32 symbols) for a Huffman
  code built from corpus letter frequencies (4.25 bits/letter); *protect* adds
  none, triple repetition, or **Hamming's (7,4) code exactly as Shannon prints it
  in §17** (X1, X2, X4 make the checks α, β, γ even; the odd checks spell the
  position of the flipped bit).
- **Noise source:** a binary symmetric channel from "silent" to "1 in 2 — pure
  static", defaulting to Shannon's §12 example of 1 in 100. Each channel position
  keeps one uniform draw, so turning the dial up only ever *adds* hits.
- **Pause / step / rewind:** the whole transmission is a pure function of
  (message, code, noise, seed), computed up front — the timeline is just an index,
  so stepping backwards costs the same as forwards. Transport bar: back to start,
  step back, play/pause, step forward, end, a scrubber, and ¼×/1×/4× speed
  (keyboard: space, ← →, Home, End). Tap any letter or any square of the signal to
  jump to the moment it was sent. Paused, each box shows its operation for that
  step: the letter's codeword, the bits that arrived, the parity checks or
  majority votes, the fix, and the letters read out — including a Huffman reader
  losing its place after a single hit.
- **Details fold:** Shannon's limit, C = 1 − H(p) — the coin-entropy curve upside
  down — with your code's rate marked against it.

Checked against theory by simulation: at 1 in 20, Hamming blocks fail 4.35% of
the time (theory 4.44%), repetition leaves 0.68% bit errors (theory 0.73%); at
1 in 100, unprotected letters arrive wrong 4.7% of the time (theory 4.9%), and
compression doubles that to 10.1% by desynchronizing the reader. Codebooks are
generated by `make_codebook.py` from the redundancy experiment's corpus.

## Roadmap

- **Build-a-Code** — assign short codewords to common symbols and race the entropy
  limit (source coding / Huffman).
- **Shannon's promise, kept** — add a long modern code (LDPC or polar) to the
  simulator's transmitter, to watch errors vanish at a rate *under* capacity.

## Structure & design

- Each explorable is self-contained under `games/<name>/` (HTML + CSS + JS, no
  shared runtime), linked from the landing page `index.html`.
- Light and dark mode via `prefers-color-scheme` (append `?dark` to force dark).
- Sound is synthesized with the Web Audio API — no audio files. Heads and tails
  land on different notes (E6 / A5), the reveal stamps with a thunk, and a short
  jingle rises or falls with your accuracy. Mutable via the 🔊 chip; persisted.
- Chart and category colors were validated for colorblind safety (CVD ΔE) and
  surface contrast in both modes; identity is never carried by color alone.
- Test hooks: `games/coin-entropy/index.html?demo` renders a deterministic reveal
  state, `?demoplay` a deterministic mid-game state; the communication system takes
  `?demo`, `?code=none|rep3|hamming`, `?compress`, `?noise=<N for 1 in N>`,
  `?step=<n>|hit|end`, `?seed=`, `?msg=<preset>`, `?details` — handy for screenshots
  and visual regression checks.

## Reading

- Claude Shannon, [*A Mathematical Theory of Communication*](https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf) (1948)
- Claude Shannon, *Prediction and Entropy of Printed English* (1951)
