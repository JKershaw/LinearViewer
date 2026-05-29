# Drift Defense (build spec)

## Status

Build spec for the drift-defense subsystem. The analysis lives in
[`drift-at-every-altitude.md`](./drift-at-every-altitude.md); this is the actionable counterpart —
the single normative reference the implementation tickets point back to, so the work can't drift
from a shared definition. Tracked as epic **LIN-289** with children **LIN-290/291/292/293**.

## The gap, precisely

A patch graph on a single-writer substrate spiralled because each fix was locally correct and the
loop had no way to see the *sequence*: no trace of drift in the state it reads, no altitude above
the greedy per-task step, and no instrument to prove a guard works. We shipped the per-task prompt
fixes (LIN-240 micro, LIN-279 meso). This subsystem adds the three things those fixes can't be:
a cross-task **sensor**, a **supervisor altitude**, **external evidence** in completion — plus the
**fixtures** that prove all of it fires.

## The non-autonomy invariant

Everything here **detects and surfaces; it never auto-resolves.** Drift-as-rationalization (the
direction-layer thesis's largest named risk) means the system must not silently reconcile a
tension — no auto-refactor, no redefining "done," no editing the north star to match behaviour. A
human adjudicates. We heal the blindness, not the architecture.

## Components

### 1. Drift sensor — LIN-290

The trace the loop never left. Generalizes LIN-240's per-file churn into a cross-issue signal,
computed from sources that already exist (git log, recent issue history, existing relations, and
the `recap.deviations` field that `/api/proxy/recap` already returns but nothing reads back).

```
driftSignal(candidateIssue) → {
  clusterSize,                 // count of recent issues/commits on a shared key
  members: ["LIN-…"],          // the cluster
  sharedKey,                   // file | label | component | related-issue
  recentDeviations: [...]      // surfaced recap.deviations
}
```

Exposed in the `/api/proxy/stack` payload and the recommendation context. It emits **data, not a
verdict** — consumers decide.

### 2. Supervisor reading — LIN-291 (carved from LIN-285)

The altitude no per-PR review can occupy. A pass (manual trigger first, scheduled later) over
recent loop state — the sensor, foreman status history, recent recaps — that produces a
human-facing flag: *"LIN-a/b/c/d all patch `<sharedKey>`; the routed-around contract gap looks
like `<X>`; step back before the next patch."* It flags; it does not act. This is the execution-
layer sibling of LIN-273's direction reading (which does the same against the north star at the
backlog altitude).

### 3. External-evidence weighting — LIN-292

Completion is judged on self-authored state today; the follow-on engine (LIN-219) triggers on
self-reported `complete`. The judge should weight CI / PR / merge / session-logs (LIN-236) over
self-report: a `complete` claim with no corroborating evidence is downgraded to
"claimed, unverified" and surfaced. v1 slice: consult GitHub MCP CI/PR state in the follow-on
`complete` transition; flag disagreement.

### 4. Adversarial fixtures — LIN-293 (extends LIN-263)

The instrument that proves the rest. Adds to the `/benchmarking` suite a **patch-graph
(HAR-shaped)** fixture (assert the recommender names the routed-around gap, not patch #4), a
**completed-parent** fixture (assert routing to terminal/close), an **ablation** of LIN-279
on/off across the model ladder, and a **ladder-as-attribution** scorecard axis (failures that
persist as the model improves are harness faults).

## Sequencing

1. **LIN-293** fixtures + **LIN-290** sensor — cheap, and they make everything else measurable.
2. **LIN-291** supervisor — consumes the sensor (LIN-290 blocks LIN-291).
3. **LIN-292** evidence-weighting — heaviest; lands in the follow-on path once LIN-219/220 exist.

## How this maps back to the spiral

| Spiral gap | Component | Ticket |
|---|---|---|
| No trace of drift in loop state | cross-issue sensor | LIN-290 |
| No altitude above the greedy step | supervisor reading | LIN-291 |
| "Done" ungrounded from external truth | evidence weighting | LIN-292 |
| No proof a guard fires | adversarial fixtures | LIN-293 |

The done bar for the whole epic: a HAR-527-shaped sequence produces a visible interrupt before the
fourth patch ships, and the fixture proves it with no human in the loop.
