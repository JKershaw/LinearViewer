# Comprehension-Debt Review — baseline run of 2026-06-12

**Grounding:** reviewed at HEAD = `f746725` (assessment-scaffold routing spike, 2026-06-12). This is the **baseline** Comprehension-Debt Review (periodical LIN-370, run task LIN-439). At minting time `docs/reviews/` held only the two Drift & Coherence reports (`drift-coherence-review-2026-06-10.md`, `drift-coherence-review-2026-06-11.md`) and **no prior `comprehension-debt-review-*` report** — confirmed at HEAD. So there is nothing to build on; this report is the ledger the next run measures against.

**Altitude reminder (LIN-370):** this review asks whether a *cold reader* can reconstruct *why a module is shaped the way it is* from the code + nearby docs alone. It is distinct from the Documentation Review's per-comment hygiene — a single missing why-comment is that review's to own; here a *module whose load-bearing rationale is unrecoverable* is the finding. Rationale-inflation (manufactured explanation for self-evident code) is itself a finding, so a clean, legible module is recorded as a genuine pass, not padded.

---

## Headline

**The baseline is remarkably clean.** This codebase has an unusually disciplined rationale-comment culture: nearly every non-obvious module opens with a header that states its load-bearing constraints, names the *why* (not the *what*), and — critically for this review — **paraphrases the constraint in-code next to bare ticket tags** rather than leaving the explanation offsite. The central debt signal this review hunts (a lone `LIN-###` beside non-obvious code whose *why* lives only in a closed ticket/PR) is **largely absent**: a grep for trailing bare ticket tags across `lib/` returned a handful of hits, and every one already carries its rationale in adjacent prose (e.g. `harbour-spawn.js:204` "Kept for LIN-257 prototype callers / tests" explains *what* and *why* the inline fallback survives; `pipeline-loops.js` "See LIN-245 for the design plan" is **supplementary** — the truth table and match strategy are fully reproduced inline).

Modules walked and judged **clean** (cold reader can safely modify; no offsite-only rationale):
`lib/recommend-recurse.js`, `lib/recommendation-facts.js`, `lib/tree.js`, `lib/graph-features.js`,
`lib/kpi-stats.js` (privacy boundary — the LIN-400 `resolvedAt`-is-not-completion trap is spelled out inline),
`lib/ship-layout.js`, `lib/swim-lanes.js`, `lib/swim-graph.js`, `lib/pipeline-loops.js`,
`lib/periodicals.js`, `lib/providers/local/index.js`, `lib/trashed-signal.js`, and the proxy trash-handling
path in `routes/proxy.js` (LIN-401).

Only **two** genuine findings rose above the noise, **both low severity** and both of the same character: a *non-obvious primitive whose load-bearing invariant is not stated next to it*. Neither is offsite-rationale debt; both are "the code works, but a cold reader editing this exact line could silently break an unstated constraint." Per the under-create discipline, **one** follow-up is minted (F1); F2 is recorded but not promoted.

---

## Findings (severity-ranked)

### F1 — `proxy-dedupe-key-nul-separator` — **Low–Medium** — *new (baseline)*

**Where:** `lib/proxy-dedupe.js:31`, inside `dedupeKey(...parts)`:

```js
hash.update(`${str.length}:${str}\x00`);   // the trailing byte is a literal NUL (U+0000)
```

**Non-obvious behavior + missing rationale.** `dedupeKey` is the identity function for the short-window create-dedupe cache (LIN-399) — it decides whether a retried `POST` of a comment/issue/relation collapses onto the first result or mints a **duplicate write**. The doc comment explains the `${str.length}:` length-prefix as the collision guard ("Parts are length-prefixed before hashing so they cannot collide across boundaries"). It is **silent on the trailing literal `\x00`**, which is also embedded as a delimiter. Two concrete costs a cold reader hits:

1. **Can't tell load-bearing from vestigial.** With the length-prefix already present, `["ab","c"]` → `"2:ab\x003:c\x00"` and `["a","bc"]` → `"1:a\x002:bc\x00"` are *already* distinct without the NUL — so the NUL is redundant belt-and-suspenders, not the guarantee. But nothing says so. A newcomer "cleaning up" the odd byte, or conversely *relying* on it and dropping the length-prefix, is making a blind change to a key that gates duplicate writes.
2. **The NUL makes the whole source file classify as binary.** `git grep` / ripgrep / diff tooling treat `proxy-dedupe.js` as a binary blob (observed: a content grep over `lib/` reported `lib/proxy-dedupe.js: binary file matches` instead of the matching lines). That silently removes the file from text-based code review and search — a real comprehension/tooling cost on a security-relevant module.

**Cold-hand-off test:** fails — the constraint ("length-prefix is the actual collision guard; the `\x00` is a redundant secondary delimiter") is unrecoverable from the code.

**Minimal fix (constraint-note, not net-new prose):** one line next to the `hash.update` call stating that the length-prefix is the collision guarantee and the `\x00` is a redundant separator — or drop the NUL (preferred: also un-binaries the file) and keep the note. **No behavior change intended.**

> Promoted to a follow-up this run (highest-severity finding; observable tooling cost + sits on a write-dedupe path).

### F2 — `composite-sort-key-magnitude-invariant` — **Low** — *new (baseline)*

**Where (recurring idiom, ≥2 sites):**
- `lib/swim-graph.js:113` — `const rk = id => (rank.get(id) || 0) * 100000 + (idx.has(id) ? idx.get(id) : 0);`
- `lib/swim-lanes.js:279` — `return rank * 1000000 + idx;` (inside `orderByDependency`'s `sortKey`)

**Non-obvious behavior + missing rationale.** Both pack two ordering keys into one sortable number — *primary* (graph rank / status-segment rank) major, *secondary* (in-set index) minor — via `primary * BIG + secondary`. The load-bearing, **unstated** invariant is that `BIG` must strictly exceed the maximum possible secondary value (node count / global index) in the set; if a set ever has ≥ `BIG` members, the secondary term overflows into the next primary band and rankings **silently interleave** (wrong layout order, no crash, no warning). The two sites even use **different** magnitudes (`1e5` vs `1e6`) with no note on why, which reads as arbitrary. The surrounding function comments explain the *intent* ("rank first, then index") but never the magnitude constraint that makes the packing correct.

**Cold-hand-off test:** fails narrowly — a cold reader changing `BIG`, the index source, or the set-size assumptions can't see the "must exceed max in-set index" constraint. Risk is genuinely low: these are swim/flow **layout** paths (not a correctness or money/auth path), the failure is mis-ordering (not corruption), and it only triggers at implausible set sizes (10⁵–10⁶ siblings in one lane/rank).

**Minimal fix:** a one-line note at each site — e.g. `// rank-major composite key: 1e5 must exceed the max in-set index, or ranks interleave` — and optionally reconcile the two magnitudes or factor a single named helper. **No behavior change.**

> **Not promoted.** Real and recurring, but the risk (layout-only, implausible N) does not clear the bar over F1, and the under-create discipline says a low-risk finding can wait a cycle. Recorded here so the next run can promote it if the swim modules churn.

---

## Notes for the next run

- **No regressions possible to report** (baseline). The two findings above are the opening ledger.
- The two most recent commits at HEAD were re-grounded as fresh territory and came back **clean**: `recommendation-facts.js` (LIN-434, the new fact-assembly seam) and the assessment-scaffold spike (`f746725`) carry full in-code rationale.
- If you promoted F2 or it recurs, watch for the same `primary * BIG + secondary` packing leaking into other ranking code (e.g. `lib/render-swipe.js` sort, `roadmap.js`) — it is a codebase idiom worth one shared, documented helper rather than N undocumented constants.
- Reaffirm the clean-module list above by spot-check rather than re-deriving; the point of the ledger is to let the next run skip what's already judged legible.

---

### Trend ledger

| Finding | Severity | Sites | Delta | Promoted |
|---|---|---|---|---|
| `proxy-dedupe-key-nul-separator` | Low–Medium | `lib/proxy-dedupe.js:31` | new (baseline) | yes — F1 follow-up |
| `composite-sort-key-magnitude-invariant` | Low | `lib/swim-graph.js:113`, `lib/swim-lanes.js:279` | new (baseline) | no |

*Baseline run for the Comprehension-Debt Review (LIN-370 / run LIN-439). Grounded against source at HEAD `f746725`, not prior prose.*
