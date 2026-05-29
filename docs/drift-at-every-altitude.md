# Drift at Every Altitude: A Synthesis

## Status

Capstone synthesis. Sits above the two earlier notes
([`recommender-structural-drift.md`](./recommender-structural-drift.md),
[`recommender-failure-patterns.md`](./recommender-failure-patterns.md)) and ties them to work
already shipped, designed, or in progress in the Linear workspace. Its job is to name the single
phenomenon those notes circle, reconcile my analysis with what already exists (correcting it
where it was wrong), isolate the one genuinely-open thread, and identify the missing instrument.

## The one phenomenon

`docs/direction-layer-proposal.md` states the mechanism plainly: AI-augmented development
decoupled the rate of *work production* from the rate of *intent formation* — *"the bottleneck
moves but doesn't disappear; it goes upstream."* Everything in the failure-pattern analysis is
the **same drift** observed at different altitudes:

| Altitude | The drift | Countermeasure in this repo | Status |
|---|---|---|---|
| **Micro** — a commit | a locally-correct fix breaks a shared, stateful system | **LIN-240** — read-history / blast-radius / system-model prompts | Shipped |
| **Meso** — a plan | the cheaper strategy routes around a tracked root-contract gap | **LIN-279** — strategy-framing: score *cost-of-not-doing* before session-fit | Shipped |
| **Macro** — the backlog | the body of work diverges from what's worth doing | **LIN-273** — north star: score work against intent | In progress |

These are not three problems. They are one problem at three zoom levels, and they have already
attracted three instances of **one fix**.

## The recurring fix shape

At each altitude the countermeasure has the identical structure, and it is *not* "give the agent
more information." LIN-279's key finding is that planning agents **already** discover adjacent
tickets via MCP — the failure was a **rubric** failure: the prompt installed "minimise *this*
ticket's blast radius" as the only scoring axis, so even a correct enumeration of strategies
scored the gap-closing one as "strictly larger surface for no gain."

So the fix shape is:

> The local optimizer has the information but the **wrong objective**. Install a **normative
> reference one altitude up** that it is forced to score against.

- Meso: *cost-of-not-doing* (the tracked contract gap the cheap path routes around) — LIN-279.
- Macro: the *north star* (normative, prose, singular, not derived from track record) — LIN-273.

This is the formal escape from a local optimum: a greedy optimizer escapes only by adopting a
non-greedy objective, and a normative reference *is* that objective. The direction-layer doc's
sharpest move — *track record is a sensor, not a navigator; empirical ≠ normative* — is the same
principle stated for the macro altitude: don't let the system define "good" as "what it already
did."

## Reconciliation: what my earlier notes got right and wrong

Honest accounting against the workspace:

| Pattern (my framing) | Reality | Verdict |
|---|---|---|
| Local-optimum drift | **Shipped** (LIN-279 + LIN-240). My note's diagnosis ("feed it the cross-issue graph") was **partly wrong** — it's a rubric failure, and the context/cousins piece was the *smaller* lever, also already shipped (LIN-279 Layer 2, LIN-284). | Corrected in the drift note. |
| Grounding-rule over-strictness causing hallucinated detail | **Shipped** (LIN-277 added the grounding rule precisely for this). | Already solved. |
| Perpetual preparation / premature skip | **Shipped** (LIN-62). | Already solved. |
| Thrashing / consistency | **Shipped** (LIN-58); decision-memory + loop-detection **designed** (LIN-219 chain history). | Mostly covered. |
| No terminal `close` state | **Designed** — the follow-on transition table makes `none` a first-class terminal (LIN-216/219). | In the plan. |
| Escalation / human gate | **Considered and canceled** (LIN-121, low priority) — but re-emerges in the LIN-285 "supervisor session" vision. | Deliberate non-choice, revisited at a higher altitude. |
| Proxy gaming / Goodhart | Bounded by grounding rule; addressed at macro by LIN-273 alignment scoring. | Covered across altitudes. |

The net: the failure-pattern catalogue was a reasonable independent derivation, but most of it had
already been found and fixed. Its lasting value is the **altitude framing** and the isolation of
the one thread below.

## The one genuinely-open thread: epistemic drift

Every countermeasure above governs *what action to take*. None governs *whether to believe the
record of what was done*. Completion is still judged on Linear state the agent itself wrote
(labels, comments, status); nothing in the recommendation or follow-on path consults external
truth. Even the follow-on engine (LIN-219) triggers on **self-reported** `status: complete`.

This is the same anti-drift move, applied to the **epistemic axis** — and the direction-layer doc
already named the macro version of it as *the largest risk*: **drift-as-rationalization**
("don't update the north star to match the behaviour"). One altitude down, the execution analogue
is: *don't let the completion judge rationalize from the agent's own success report.*

The fix shape repeats: install a normative reference the local reporter can't author. Here the
reference is **external evidence** — CI / GitHub Actions status, PR merge state, a diff, or a real
session log. The pieces are already visioned, just not built or unified:

- **LIN-236** — upload Claude Code session logs as dispatch feedback (the evidence channel).
- **LIN-285** — a playbook instructing the agent to *"be sceptical of output"*, GitHub MCP for
  *"ci/cd monitoring and merging"*, and a *"supervisor session… summarise/flag to a human"*.

What's missing is the principle that binds them: **the completion judge should weight external
evidence over self-report.** That is the cleanest net-new contribution this whole thread produces.

## The missing instrument

There are countermeasures at every altitude, but **no instrument that says whether any of them
work.** LIN-279, the completion signals, the cousins context — all are believed-good on anecdote.
That instrument is already specced and unbuilt: **LIN-45** (fuzzy test) and **LIN-263**
(benchmark, with a full `/benchmarking` architecture in its research comment).

It is the keystone: it converts "we shipped a normative-reference fix" into "the fix measurably
changes behaviour, at these model tiers, for this cost," and it establishes a baseline before more
is built on top (follow-on, MCP Control, direction layer). Two sharpening lenses to add to the
existing LIN-263 plan:

1. **Ladder-as-attribution.** LIN-263 asks "which model is best." The sharper question is *which
   failures persist or worsen as the model improves* — those are the harness's fault and worth
   fixing; the ones that vanish were capability, not design. Same runs, one extra scorecard axis.
2. **Ablation of shipped fixes.** Frame the suite as a regression guard: toggle LIN-279
   strategy-framing on/off across the Haiku→Opus ladder and measure whether it actually fires and
   helps. Neither LIN-45 nor LIN-263 currently frames the suite this way.

Scope, per LIN-263's own framing: the benchmark tests the **recommender layer** (prompt
*generation*), not the **execution layer** (an agent doing work and misreporting). The epistemic
thread above lives in the execution layer and needs a heavier seeded-repo rig — a separate, later
investigation.

## Where each initiative sits

- **State layer** (tree / swipe / swim / pipeline) — legibility of *where work is*. Done.
- **Execution / loop layer** — recommender, prompts, dispatch, follow-on (LIN-213…221), foreman
  (LIN-209/237), MCP Control (LIN-285). The anti-drift rubric fixes (LIN-240/279) and the open
  epistemic thread live here.
- **Direction layer** — north star + alignment analyzer (LIN-273), Ship view as its eventual
  visualization. The macro anti-drift reference.
- **Measurement spine** — the benchmark (LIN-45/263) runs *across* layers and tells you whether
  any reference at any altitude is earning its keep. **Currently missing; highest leverage.**

## Recommendation

Build the measurement spine first (LIN-263), aim its opening runs at validating the
normative-reference fixes already shipped (ablate LIN-279), and reserve the external-evidence
principle as the one net-new execution-layer investigation once the rig exists.

## Scope guard

This note reframes and connects; it proposes no change to the grounding rule or to the greedy
local optimizer for the common case. The thesis is narrow: one drift, countered by normative
references at each altitude, with one axis (epistemic) still open and no instrument yet to prove
the references work.
