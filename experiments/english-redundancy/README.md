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

## The N→∞ limit

Shannon defines H = lim F_N, but finite data only identifies an **upper
bound**: our best is the held-out minimum, **H ≤ 1.840 bits/letter**
(redundancy ≥ 61.3%). The script also extrapolates the held-out curve to
N→∞ and prints the fits mostly to demonstrate that they are unidentifiable:
geometric-tail fits give H∞ anywhere from 0.36 to 1.84 depending on the
window (later windows are sparsity-contaminated; earlier ones wrongly assume
the decay stays geometric), and a Hilberg power-law fit (β = 0.5) gives
H∞ ≈ 0 — reproducing Hilberg's controversial 1990 re-analysis of Shannon's
own data. Estimators with longer reach converge downward: Shannon's 1951
human predictors gave 0.6–1.3 bits at 100-letter range, Cover & King (1978)
~1.3, modern neural models ~0.7–1.0. Every predictor yields only an upper
bound; "the entropy of English" is the infimum over all of them.

## Why plug-in F_N is memorization at large N

A context seen once in the corpus has a point-mass empirical next-letter
distribution — **0 bits by construction**, which is knowledge of the corpus,
not of English (the 7-letter context from "call me ishmael" is "certain"
only because Moby Dick is in the training set). Measured on our corpus:

```
N=3:  2.4% of contexts are singletons;  0.0% of positions empirically deterministic
N=5: 20.6% of contexts are singletons;  3.5% of positions empirically deterministic
N=8: 48.3% of contexts are singletons; 27.8% of positions empirically deterministic
```

By N=8 more than a quarter of all positions contribute zero entropy purely
by construction — most of the gap between plug-in (1.29) and held-out (1.88).
Plug-in is the training loss, held-out is the test loss, N is model capacity:
the table is a classic overfitting plot, and the plug-in column's descent
past N≈5 measures corpus size, not language. In the limit N = corpus length,
plug-in F_N = 0 exactly: "the text is perfectly predictable given the text."

## Run it

```sh
python3 redundancy.py     # downloads + caches the corpus on first run (~15 MB)
```
