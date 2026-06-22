# Divergent-bug routing gap — red baseline (HAR-697 field report)

Adds eval coverage for the "diverging-but-correct" failure the HAR-697 autopilot
run surfaced: on a *debugging* task the recommender keeps advancing to a fix even
though the root cause was **refuted across the comment trail** and the decisive
experiment never completed (fix-before-validate). The existing suite could not see
this — it grades the action **label**, never the **evidence standard** behind a
"done" investigation.

## The gap

`scripts/eval-research-routing.mjs` already has the *convergent* pole:

- `SYN-18` "bug already investigated → **advance to the fix**" (root cause + minimal
  fix settled in the trail; re-investigating would loop). Correct answer: `implement`.

It had **no opposite pole**: a bug whose investigation is *present but refuted*, where
advancing to the fix is **wrong**. The live prod engine reads "investigation-shaped
comments exist → complete enough to fix" and picks `implement` — exactly what the
field report named (mechanism D). The two poles turn on evidence *quality*, which the
label-only grader cannot distinguish.

## Cases added (both leaf bugs with a comment trail — faithful to the leaf snapshot)

- **`SYN-21` — bug root-cause REFUTED across the trail, fix not validated** (mechanism D).
  Comment 1 proposes a code-grounded cause + fix but states the live repro was not run;
  comment 2 (live capture) refutes that cause and relocates it, and the decisive
  install→render experiment still has not passed. Correct: re-investigate / run the
  decisive experiment (`bug`/`research`), **not** `implement`. `avoid: implement`.
- **`SYN-22` — acceptance witness proven unreliable mid-investigation** (mechanism E).
  The `loadedModules > 0` acceptance proxy was shown to be a false negative (0 under a
  fully styled render). Building a fix against an unconfirmed measurement chases a wrong
  goalpost; pin the witness first. `avoid: implement`.

Both are distilled from the real HAR-697 trail (Harbour). `SYN-18` stays in the suite as
the contrast pole so a future prompt fix cannot buy divergence-handling by regressing the
legitimate advance-to-fix case.

## Red baseline

`ARMS=A` (live prompt, snapshot in sync with `lib/prompts/meta-prompt-template.js`),
`GEN_MODEL=openai/gpt-5.4-mini` (prod default), K=10.

| case | scale | result | `implement` trap |
|---|---|---|---|
| `SYN-21` refuted cause (synthetic) | ~350 tok, 2 clean comments | 7–8/10 `bug` | **~20–30%** |
| `SYN-22` unreliable witness (synthetic) | ~190 tok | 9–10/10 (`research`/`bug`) | ~0–10% |
| **`[real] HAR-697` frozen red moment** | **~2,600 tok, real trail** | **0/10 — `implement×10`** | **100%** |
| `SYN-18` settled bug (contrast pole) | ~440 tok | 5/5 `implement` | n/a (correct) |

The settled-bug pole (`SYN-18`) is 5/5 correct; the engine is reliable when an investigation
is genuinely settled and unreliable when it has *diverged*, because the prompt offers no robust
signal to stay in investigation once a cause is contradicted (even though Step-2 already says to
re-investigate when "prior findings are … contradicted by the current code").

## Scale realism (the synthetic is more forgiving — measured)

The synthetic `SYN-21` and the real, full-scale `HAR-697` fixture encode the **same** divergence
(a code-grounded root cause, refuted later in the trail, decisive experiment never passed). They
disagree sharply:

- **Synthetic `SYN-21`: ~20–30% trap.** Real **`HAR-697`: 100% trap** (`implement×10`), which
  matches the live prod `/recommend` on the real ticket.
- Drivers of the gap (≈10× scale, plus structure):
  1. **Scale/authority** — a 5,709-char investigation reads as far more "done" than two clean
     sentences; the 1,865-char refutation is *buried after* it.
  2. **Distractors** — the real trail is dense with fix-oriented prose ("ready to hand to an
     implementation task", "the durability fix must cover …") wrapped around the refutation.
  3. The synthetic strips all of that, making the refutation easy to see.

**Lesson for this eval:** the small synthetic cases are a cheap *directional* guard but
**under-state severity ~4–5×**. The frozen real fixture
(`scripts/eval/fixtures/HAR-697-red.json`) is the honest red baseline — real scale, real
distractors, and reproducible (network-free) after the live ticket moves on. New divergence
coverage should be **anchored on the real fixture**, with the synthetic cases kept only as cheap
pre-checks. A fix is not proven on the synthetic alone — it must move `[real] HAR-697` off
`implement×10`.

## Acceptance for the fixes (this is the judge)

A prompt/selector change is proven when, **without regressing** `SYN-18` (stays `implement`)
or the other loop/over-fire cases:

- **`[real] HAR-697`** moves off `implement×10` → `bug`/`research` ≥ 8/10 at K=10. **This is the
  primary bar** — the synthetic alone is not sufficient (it is already near-passing while the
  real case is 0/10).
- `SYN-21` loop-REPEAT (`implement`) → 0; `SYN-22` routing accuracy → 10/10 (cheap pre-checks).

Run (real fixture + synthetic poles + contrast, all share the HAR-697 / `already` tags):

```
ONLY=HAR-697,already ARMS=AB K=10 GEN_MODEL=openai/gpt-5.4-mini node scripts/eval-research-routing.mjs
```

(Edit `scripts/eval/meta-prompt.candidate.txt` as Arm B; ship to the live template only
once Arm B beats Arm A here. Regenerate Arm A with `node scripts/eval/regen-baseline.mjs`
after any live-template edit.)

## The real fixture (committed) + how to refresh it

`scripts/eval/fixtures/HAR-697-red.json` **is committed** (Harbour is a public pet project, so
its task text is fine to include) — so the realistic red bar runs on any clone / in CI without a
token. The bulk auto-fetched fixtures (`fetch-proxy-tasks.mjs` epic subdirs) stay gitignored; this
one curated red fixture is the explicit exception (`.gitignore` negation).

Refresh it from the proxy with the committed recipe (`scripts/eval/build-har697-red.mjs`, no body
text in the script itself):

```
HARBOUR_PROXY_TOKEN=<harbour read token> node scripts/eval/build-har697-red.mjs
```

The harness loads any `scripts/eval/fixtures/*.json` (graded-leaf shape) automatically. The script
freezes the **red moment** by keeping the first `KEEP=3` comments (investigation + HAR-705
refutation + addendum) and dropping the later override note + review verdict that filed HAR-707 —
so the fixture stays a clean divergence test rather than a post-correction "implement HAR-707 is
now correct" state.
