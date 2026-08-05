#!/usr/bin/env python3
"""Check Shannon (1948), Section 7: "The redundancy of ordinary English, not
considering statistical structure over greater distances than about eight
letters, is roughly 50%."

Method, following Shannon's own framework:
  - Alphabet: 26 letters + space (27 symbols), so F0 = log2(27) = 4.755 bits.
  - F_N = H(N-gram) - H((N-1)-gram): the plug-in conditional entropy of the
    next letter given the previous N-1. Undersampling makes plug-in F_N an
    UNDERestimate for large N (it memorizes the corpus), so we also compute
  - held-out cross-entropy of a Witten-Bell interpolated N-gram model on a
    book the model never saw: a genuine UPPER bound on the source entropy.
  - An LZMA compression bound as an independent universal-coding check.
  Redundancy at order N = 1 - H_N / F0. Shannon's claim: ~50% by N ~ 8.

Corpus: public-domain books from Project Gutenberg (downloaded once, cached).
Pure stdlib; no dependencies.
"""

import lzma
import math
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

CACHE = Path(__file__).parent / "corpus"
BOOKS = {  # Gutenberg id -> title (held-out book listed last)
    1342: "Pride and Prejudice",
    2701: "Moby Dick",
    2600: "War and Peace",
    98: "A Tale of Two Cities",
    145: "Middlemarch",
    76: "Huckleberry Finn",
    4300: "Ulysses",
    1661: "Sherlock Holmes",  # held out for cross-entropy
}
HELD_OUT = 1661
N_MAX = 8
A = 27  # alphabet size: a-z + space
F0 = math.log2(A)


def fetch(book_id: int) -> str:
    CACHE.mkdir(exist_ok=True)
    f = CACHE / f"{book_id}.txt"
    if not f.exists():
        url = f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt"
        req = urllib.request.Request(url, headers={"User-Agent": "shannon-redundancy-check"})
        with urllib.request.urlopen(req, timeout=60) as r:
            f.write_bytes(r.read())
    return f.read_text(encoding="utf-8", errors="ignore")


def strip_gutenberg(text: str) -> str:
    s = re.search(r"\*\*\* ?START OF.*?\*\*\*", text, re.S)
    e = re.search(r"\*\*\* ?END OF", text)
    return text[s.end() if s else 0 : e.start() if e else len(text)]


def normalize(text: str) -> bytes:
    """Shannon's 27-symbol alphabet: a-z as 0..25, space as 26."""
    text = text.lower()
    text = re.sub(r"[^a-z]+", " ", text)
    text = re.sub(r" +", " ", text).strip()
    return bytes((26 if c == " " else ord(c) - 97) for c in text)


def ngram_counts(data: bytes, n: int) -> Counter:
    """Counter over base-27-packed n-grams (ints — far lighter than strings)."""
    c = Counter()
    key = 0
    mod = A**n
    for i, sym in enumerate(data):
        key = (key * A + sym) % mod
        if i >= n - 1:
            c[key] += 1
    return c


def entropy(counter: Counter) -> float:
    total = sum(counter.values())
    return -sum(v / total * math.log2(v / total) for v in counter.values())


class WittenBell:
    """Interpolated Witten-Bell n-gram model over the packed alphabet."""

    def __init__(self, data: bytes, n_max: int):
        self.n_max = n_max
        self.grams = [ngram_counts(data, n) for n in range(1, n_max + 1)]  # grams[k] = (k+1)-grams
        self.uniq = []  # distinct continuations per context, per order
        for n in range(2, n_max + 1):
            u = Counter()
            for packed in self.grams[n - 1]:
                u[packed // A] += 1
            self.uniq.append(u)

    def prob(self, ctx: int, ctx_len: int, sym: int) -> float:
        """P(sym | last ctx_len symbols packed in ctx), interpolating down."""
        if ctx_len == 0:
            uni = self.grams[0]
            total = sum(uni.values())
            return (uni.get(sym, 0) + 1) / (total + A)  # Laplace floor at order 1
        lower = self.prob(ctx % (A ** (ctx_len - 1)), ctx_len - 1, sym)
        ctx_count = self.grams[ctx_len - 1].get(ctx, 0)
        if ctx_count == 0:
            return lower
        # uniq[L-1] holds distinct-continuation counts for contexts of length L
        t = self.uniq[ctx_len - 1].get(ctx, 0)
        if t == 0:
            return lower
        c = self.grams[ctx_len].get(ctx * A + sym, 0)
        return (c + t * lower) / (ctx_count + t)

    def cross_entropy(self, data: bytes, ctx_len: int) -> float:
        total_bits = 0.0
        ctx = 0
        mod = A**ctx_len if ctx_len else 1
        for i, sym in enumerate(data):
            use = min(ctx_len, i)
            p = self.prob(ctx % (A**use) if use else 0, use, sym)
            total_bits += -math.log2(p)
            ctx = (ctx * A + sym) % mod if ctx_len else 0
        return total_bits / len(data)


def main() -> None:
    train_parts, held = [], b""
    for book_id in BOOKS:
        data = normalize(strip_gutenberg(fetch(book_id)))
        print(f"  {BOOKS[book_id]:<22} {len(data):>9,} chars", file=sys.stderr)
        if book_id == HELD_OUT:
            held = data
        else:
            train_parts.append(data)
    train = bytes(26 for _ in range(1)).join(train_parts)  # a space between books
    print(f"train {len(train):,} chars · held-out {len(held):,} chars\n", file=sys.stderr)

    print(f"F0 = log2(27) = {F0:.3f} bits/letter (the incompressible ceiling)\n")
    print(f"{'N':>2} {'plug-in F_N':>12} {'red.':>6}   {'held-out H_N':>13} {'red.':>6}   shannon's F_N")
    shannon_ref = {0: 4.76, 1: 4.03, 2: 3.32, 3: 3.1}

    model = WittenBell(train, N_MAX)
    h_grams = [entropy(model.grams[n]) for n in range(N_MAX)]  # H of (n+1)-grams
    held_sample = held[:200_000]  # cross-entropy is O(len * N); this is plenty

    held_curve = []
    for n in range(0, N_MAX + 1):
        if n == 0:
            fn, hn = F0, F0
        else:
            fn = h_grams[n - 1] - (h_grams[n - 2] if n >= 2 else 0)
            hn = model.cross_entropy(held_sample, n - 1)
        held_curve.append(hn)
        ref = f"  ({shannon_ref[n]})" if n in shannon_ref else ""
        print(f"{n:>2} {fn:>12.3f} {1 - fn / F0:>6.1%}   {hn:>13.3f} {1 - hn / F0:>6.1%}{ref}")

    # --- the N->inf limit: only an upper bound is identifiable ------------------
    # The held-out minimum bounds H from above; extrapolating the curve's tail is
    # radically assumption-dependent (see README), which is the honest finding.
    print(f"\nHeld-out minimum: H <= {min(held_curve):.3f} bits/letter "
          f"(redundancy >= {1 - min(held_curve) / F0:.1%})")
    print("Asymptote extrapolations (unstable by construction):")
    hs = held_curve
    for i in range(1, N_MAX - 1):
        d1, d2 = hs[i] - hs[i + 1], hs[i + 1] - hs[i + 2]
        if d1 > 0 and 0 < d2 < d1:
            r = d2 / d1
            print(f"  geometric tail, fit on N={i}..{i + 2}: H_inf = {hs[i + 2] - d2 * r / (1 - r):.3f}")
    for a, b in [(2, 5), (3, 6)]:
        c = (hs[a] - hs[b]) / (a**-0.5 - b**-0.5)
        print(f"  Hilberg power law (beta=0.5), fit on N={a},{b}: H_inf = {hs[a] - c * a**-0.5:.3f}")

    # --- why plug-in F_N is memorization at large N -----------------------------
    # A context seen once has a point-mass empirical next-letter distribution:
    # 0 bits by construction — knowledge of the corpus, not of English.
    print("\nMemorization diagnostics for the plug-in column:")
    for n in (3, 5, 8):
        ctxs, pairs = model.grams[n - 2], model.grams[n - 1]
        singles = sum(1 for v in ctxs.values() if v == 1)
        det = sum(cnt for pk, cnt in pairs.items() if ctxs[pk // A] == cnt)
        tot = sum(ctxs.values())
        print(f"  N={n}: {singles / len(ctxs):.1%} of ({n - 1})-letter contexts are singletons; "
              f"{det / tot:.1%} of positions are empirically deterministic (contribute 0 bits)")

    packed = bytes(train)
    comp = lzma.compress(packed, preset=9 | lzma.PRESET_EXTREME)
    bpc = 8 * len(comp) / len(packed)
    print(f"\nLZMA bound: {bpc:.3f} bits/letter -> redundancy {1 - bpc / F0:.1%}")
    print("\nShannon's claim: entropy ~2.3-2.4 bits/letter within 8 letters -> redundancy ~50%.")
    print("Truth lies between the plug-in (optimistic) and held-out (pessimistic) columns.")


if __name__ == "__main__":
    main()
