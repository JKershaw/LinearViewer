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
`GEN_MODEL=openai/gpt-5.4-mini` (prod default).

| case | K | result | trap (`implement`) |
|---|---|---|---|
| `SYN-21` refuted cause | 10 | 7/10 `bug`, 3/10 `implement` | **30%** |
| `SYN-22` unreliable witness | 10 | 9/10 (`research`/`bug`), 1/10 `plan` | 10% (1 off to `plan`) |
| `SYN-18` settled bug (contrast) | 5 | 5/5 `implement` | n/a (correct) |

Diverge-only summary (K=10): routing accuracy **80%**, loop-REPEAT **15%** (3/20 advanced
to a fix against a refuted/unreliable cause).

The clean signal is `SYN-21`: a **30% fix-before-validate rate** on a bug whose cause was
explicitly refuted in the trail — while the settled-bug pole (`SYN-18`) is 5/5 correct. The
engine is reliable when the investigation is settled and unreliable when it has diverged,
because the prompt offers no robust signal to stay in investigation once a cause is
contradicted (even though Step-2 already says to re-investigate when "prior findings are …
contradicted by the current code").

## Acceptance for the fixes (this is the judge)

A prompt/selector change is proven when, **without regressing** `SYN-18` (stays `implement`)
or the other loop/over-fire cases:

- `SYN-21` loop-REPEAT (`implement`) → **0** at K≥10 (routing accuracy → 10/10 on `bug`/`research`).
- `SYN-22` routing accuracy → 10/10.

Run:

```
ONLY=diverge,already ARMS=AB K=10 GEN_MODEL=openai/gpt-5.4-mini node scripts/eval-research-routing.mjs
```

(Edit `scripts/eval/meta-prompt.candidate.txt` as Arm B; ship to the live template only
once Arm B beats Arm A here. Regenerate Arm A with `node scripts/eval/regen-baseline.mjs`
after any live-template edit.)
