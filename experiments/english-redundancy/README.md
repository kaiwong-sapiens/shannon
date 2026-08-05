# Checking Shannon's 50% redundancy claim

Section 7 of *A Mathematical Theory of Communication* (1948):

> "The redundancy of ordinary English, not considering statistical structure
> over greater distances than about eight letters, is roughly 50%."

`redundancy.py` (pure stdlib) checks this on ~9.4M characters of Project
Gutenberg text (Austen, Melville, Tolstoy, Dickens, Eliot, Twain, Joyce),
normalized to Shannon's 27-symbol alphabet (a–z + space). It brackets the
true conditional entropy from both sides:

- **plug-in F_N** = H(N-gram) − H((N−1)-gram): optimistic at large N
  (undersampling → memorization);
- **held-out H_N**: cross-entropy of a Witten–Bell interpolated N-gram model
  on a book it never saw (Sherlock Holmes) — a genuine upper bound;
- **LZMA** compression as an independent universal-coding bound.

## Result (2026-08-05 run)

```
 N  plug-in F_N   red.    held-out H_N   red.   shannon's F_N
 0        4.755   0.0%           4.755   0.0%  (4.76)
 1        4.089  14.0%           4.072  14.4%  (4.03)
 2        3.338  29.8%           3.308  30.4%  (3.32)
 3        2.740  42.4%           2.702  43.2%  (3.1)
 4        2.226  53.2%           2.238  52.9%
 5        1.889  60.3%           1.968  58.6%
 6        1.671  64.9%           1.856  61.0%
 7        1.485  68.8%           1.840  61.3%
 8        1.294  72.8%           1.883  60.4%

LZMA bound: 2.140 bits/letter -> redundancy 55.0%
```

**Verdict: confirmed, and mildly conservative.** Shannon's own table values
replicate strikingly well where his data was adequate (F₁ 4.09 vs his 4.03;
F₂ 3.34 vs his 3.32). Redundancy crosses 50% at N ≈ 4 — where our two
estimators agree to 0.3% — and by the 8-letter horizon of his claim the
honest bracket is **≈ 55–61%** (held-out ≈ 1.84–1.88 bits/letter; LZMA 2.14).
His F₃ = 3.1 looks overestimated (we get 2.70–2.74 on far more data), which
is exactly the direction you'd expect from the small trigram tables he had.
His 1951 follow-up (*Prediction and Entropy of Printed English*) revised
entropy down to ~1.3 bits/letter at 100-letter range (redundancy ~75%) —
our 8-letter numbers sit neatly between the 1948 and 1951 estimates.

The held-out column bottoms out at N=7 and ticks up at N=8: order-8 contexts
are too sparse even in 9.4M characters for the model to keep gaining — the
same wall Shannon hit, at a larger corpus scale.

## Run it

```sh
python3 redundancy.py     # downloads + caches the corpus on first run (~15 MB)
```
