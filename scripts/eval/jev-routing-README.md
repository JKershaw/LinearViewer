# LIN-3107 — Jev routing-only evaluation harness

Research-only. Standalone under `scripts/eval/`; nothing here is wired into production
routing, dispatch, or the meta prompt. The frozen fixture directories
(`scripts/eval/fixtures/`) are **read-only** to all of this.

## Question

Can TypeSafe's Jev do **step one** of the meta prompt — choose the routing task type —
given (a) a distilled, current state instead of the raw thread and (b) a direct, literal
`choice` question over the live 17-action vocabulary? The task-creation (writer) half stays
on the incumbent. A tie counts as a pass: at Jev's speed and cost, a tie is the whole case
for splitting.

## Artifacts

| file | role |
|---|---|
| `jev-routing-criteria.mjs` | builds the Jev `choice` question + per-action criteria from the live `aiHint`s and the same vocabulary `getAIRecommendationActionNames()` injects |
| `jev-routing-state.mjs` | builds the distilled state; reuses `assembleNodeFacts` / `selectFocusSubtask` / `isTerminalState` / `extractSessionFit` from `lib/recommendation-facts.js` (no re-implementation) |
| `build-widened-routing-fixtures.mjs` | regenerates the class-D fixtures under `fixtures-widened/` from committed captures; hand-builds the two synthetic cases |
| `jev-routing-eval.mjs` | the 3-arm harness, deterministic grading, gold overrides, statistics, `results.json` + `report.md` |
| `jev-routing-state.test.mjs` | state-builder + grading/override/loader tests |
| `jev-routing-corpus.json` | the verb-override corpus disposition table (query, date, cap, all 50 rows) |
| `fixtures-widened/` | class-D fixtures + their `_source/` captures |
| `jev-routing-out/` | generated `results.json` + `report.md` (+ `stability.md` — the run-to-run go/no-go evidence; the K=5 run is canonical) |

## Fixture population — 90

| class | source | count |
|---|---|---|
| A | `scripts/eval/fixtures/*.json` (7 real frozen) | 7 |
| B | `scripts/eval/fixtures/recommend/*.json` (54 targets over 10 files) | 54 |
| C | `scripts/eval-research-routing.mjs` inline `CASES[]` (read-only extraction) | 24 |
| D | `scripts/eval/fixtures-widened/*.json` (`LIN-830@implement`, `LIN-830@review`, `LIN-1084`, `breakdown-fork-neg`, `all-terminal-node`) | 5 |

Node-shaped targets in class B (`HAR-149`, `HAR-545`, `LIN-385`, `LIN-389`) get their
step-one gold derived **in code** — `defer` + the `selectFocusSubtask` child — not from their
committed `expect` (which grades the multi-hop descent). All other targets use their
committed `expect`. `all-terminal-node` has children but no real non-terminal child, so its
gold is `review` / `close-out`.

## The three arms

| arm | model | state | what it isolates |
|---|---|---|---|
| 1 | Jev `typesafe/jev-1.13` | distilled | the candidate |
| 2 | incumbent `openai/gpt-5.4-mini` | distilled | model-vs-representation (same state as arm 1) |
| 3 | incumbent `openai/gpt-5.4-mini` | raw, via the live `getRecommendation()` | the production incumbent (state-fidelity control) |

Arm 3's cost, latency and captured prompt come from the graded call's **own** recorder hooks
(`setLlmCallRecorder` / `setPromptTraceRecorder`), keyed by a unique per-call
`callMeta.evalCallId = <fixtureId>#<k>`; the harness asserts **exactly one** `recordLlmCall`
and **one** `recordPromptTrace` per graded arm-3 call, and unregisters both hooks in a
`finally`. There is no duplicate rebuild call, and the harness never imports `server.js`.

**Cost/latency labelling.** Arm 3 runs the full `getRecommendation()` call, so its figures are
the **full choose-and-write call** (it generates the whole `## Prompt`). Arm 2 — the incumbent
choosing only, over the same distilled state — is the **like-for-like step-one comparator**.
Jev's arm-1 cost is therefore **not** presented as a straight replacement for arm 3's figure.

## The `defer` rule (evaluation-only) and its asymmetry

This is an **eval choice, not the live contract** — `lib/openrouter.js` injects the full
vocabulary (including `defer`) into every prompt, leaves included. The rule, applied
identically to grade every arm:

- `defer` is eligible **only** for a node with a real, non-terminal child, per
  `selectFocusSubtask` / `isTerminalState`;
- a **leaf `defer` is a miss in every arm**;
- node `defer` is scored on the **action** only; arm 3's `deferTo` agreement with
  `selectFocusSubtask` is reported **separately** as a diagnostic.

**Asymmetry, stated plainly:** arms 1 and 2 filter `defer` at **prompt time** (it is withheld
from the offered criteria on leaves), while arm 3's prompt-level vocabulary is never filtered,
so its defer-eligibility is evaluated at **grading time**. The rule makes the two ends agree
on the outcome; the mechanism differs by arm and is not smoothed over.

## Gold overrides (harness-side; frozen files untouched)

`GOLD_OVERRIDES` in `jev-routing-eval.mjs`, applied at grading time only:

- `LIN-571`, `SYN-12`, `LIN-385@breakdown` → `plan-review` (LIN-1603 criterion-(a) contract
  drift; `LIN-571` retains `avoid: plan` / `loop: true`).
- `FIX-830-pos` → accepts **both** `breakdown` and `plan-review` (implicit/explicit
  multi-phase ambiguity); its per-arm distribution is reported separately.

## Widening / corpus

The fresh tracker-history class is bounded by one recorded query:
`GET /api/proxy/search?q=verb%20override`, run `2026-09-26T21:16:42Z`, grounded at
`b5c528c4`, **50 hits — the endpoint's own cap**. Every one of the 50 hits is dispositioned in
`jev-routing-corpus.json` (query, cap, rule, reason), including the corrections recorded at
implementation. Real, clean misses excluded by the cap (notably `LIN-812`'s own two
2026-06-29 overrides) are named in their rows and the cap is disclosed.

## Independent census and sensitivity disclosure

The committed corpus is bounded by the 50-hit search cap, and that slice is **not** a random
sample of the real class. An independent census (recorded on the ticket, 2026-09-26T22:43Z) swept
**all 3,057 issues** (paged `GET /issues?limit=250`, each fetched with its comments) against an
override-record regex and found **414 candidate comments across 295 issues**, of which **~105 are
clean, contract-consistent real misses** under the same exclusion logic used here. The 50-hit
corpus is therefore a capped, non-random slice of a larger class; 72 of the 105 clean misses are
one pattern (the engine re-picked `implement`/`close-out` on work that had landed and was pinned to
`review`).

The census also flagged four ambiguous golds under contract rules added after their golds were
written, which the canonical run does **not** regrade: **SYN-14** and **SYN-20** (approach settled
but no files/surfaces pinned → Step 3 "no committed scope ⇒ never `implement`"); **SYN-10**
(blocked stated by label, not relation → Step 2 detects blocked from the relationship); and
**FIX-830-neg** (a one-session plan that writes proxy token values into the DOM/clipboard → gate
(d) credential surfaces). A sensitivity regrade applying them — SYN-14 and SYN-20 → `[plan]`;
LIN-830@implement accepting `implement` **or** `plan`; SYN-10 and FIX-830-neg dropped — yields
**arm 1 63.4% vs arm 3 75.3%** (McNemar b=2, c=12, **p=0.016**). This is a **sensitivity check
separate from the canonical 66-fixture result**; it **does not change the NO-GO conclusion**.

## Run

```sh
OPENROUTER_API_KEY=... node scripts/eval/jev-routing-eval.mjs

# no-network pipeline check (stub answers; exercises loading, overrides, grading, report).
# OUT_DIR points somewhere non-canonical; with OUT_DIR unset a DRY run uses a temp dir,
# so the committed jev-routing-out/ evidence can never be overwritten:
DRY=1 K=1 ONLY=LIN-571 OUT_DIR=/tmp/jev-dry node scripts/eval/jev-routing-eval.mjs

# recorder-correlation check, no spend:
SELFTEST=1 node scripts/eval/jev-routing-eval.mjs

# state-builder + grading tests:
node --test scripts/eval/jev-routing-state.test.mjs

# regenerate class-D fixtures from committed captures:
node scripts/eval/build-widened-routing-fixtures.mjs
```

Env knobs: `K` (default 3), `ONLY` (comma-separated id substrings), `ARMS` (`123`), `MODEL`
(incumbent), `JEV_MODEL`, `DRY`, `SELFTEST`, `OUT_DIR`.

## Limitations

- The verb-override corpus query is capped at 50 results, so it is a non-random slice, not the
  full population; an independent census measured ~105 clean misses across 295 issues from a
  3,057-issue sweep (see the disclosure above).
- `divergenceMarker` is an extractive lexical proxy for a semantic "a later finding refutes an
  earlier one" read, not a model summary.
- The `defer` rule is an eval construct (above), not the live prompt-time contract.
- All statistics are computed over the widened set; with ~66 paired fixtures McNemar has low
  power, so the paired-difference (Newcombe) interval is reported next to it.
