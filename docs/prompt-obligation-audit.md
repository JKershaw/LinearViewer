# Harbour Prompt-System Audit — Obligations & Working Memory

> The **correctness-axis** counterpart to `docs/prompt-system-audit.md` (which measured
> the *efficiency* axis — where session spend goes). This report audits the **obligations**
> the prompt system asks each agent to hold in working memory *while it works*, and asks the
> same question determinism asks of orientation: **which of these can we lift out of the
> agent's remit?**
>
> **Scope:** meta-prompt (recommendation/routing) · autopilot orchestrator (kickoff + handbook) · the ~15 worker templates + shared post-pass
> **Method:** three parallel extraction passes over the prompt sources, each classifying every obligation against one liftability verdict; consolidated + cross-referenced here.
> **Feeds:** LIN-1153 (what in our prompts could be deterministic) · LIN-1236 (program tracker). Complements LIN-1235 (the efficiency study) and LIN-816 (context-length — the *why* behind the load).

---

## 0. What counts as an "obligation"

An **obligation** is a rule, invariant, prohibition, exception, or decision-branch the agent
must hold in working memory **throughout** the task and reconcile against everything it does —
such that if it "forgets," it can **violate the rule later in the session**. This is
deliberately narrower than "an instruction": a one-shot step ("summarise the project, then
begin") is executed once and dropped; an obligation ("a review never merges") constrains every
subsequent action and so occupies working memory until the session ends.

This narrowing matters because Part II of the efficiency audit already reframed the problem:
what taxes correctness is **not** token count but the number of **interacting** obligations the
model must keep mutually consistent. A 500-token block with eight conditional rules is heavier
than a 3,000-token slab of static context. This report counts the rules, not the tokens.

### The liftability verdict (one per obligation)

| Verdict | Meaning | The lever |
|---|---|---|
| **CODE-ENFORCE** | A code/platform/runtime mechanism can make violating it *impossible* (a sandbox, a write-layer invariant, a dispatch verb that owns the state) | Off the remit entirely — the agent never holds it |
| **PRECOMPUTE** | It can be converted to an injected **fact/given** — a computed value the agent reconciles *against* rather than a rule it derives | A given, not an obligation |
| **REDUNDANT** | Already computed elsewhere, or the same rule restated N× — state/enforce once | Near-free deletion + removes drift risk |
| **MUST-HOLD** | Genuine semantic judgment over free-form evidence with no deterministic marker | Leave with the LLM — this is why it's in the loop |

---

## 1. Two headline findings

### 1.1 The two axes converge on a single change

The obligation carried in the **most heads at once** is **re-grounding / staleness**: the shared
post-pass — *"treat the ticket as a hypothesis, re-verify referenced files/symbols against HEAD
before trusting the description"* — is appended to **all ~15 worker templates**. It is also the
exact thing the efficiency study (LIN-1235, Part III) found consumes **68% of orientation
spend**.

So **wiring the task-snapshot diff into prompt generation (Part I rec #1) pays both axes with one
change**: it evicts the re-grounding *spend* (efficiency) **and** lifts the staleness *obligation*
off every worker (correctness). Pre-computing the fact removes the obligation the model was
tracking **and** the re-derivation it cost at runtime. The determinism lever and the
cognitive-load lever are the same lever — this is the single most important result in this report.

### 1.2 Obligations duplicate across heads — the H4 analogue

The efficiency study's H4 found the same *files* re-read from scratch across a task's sessions.
This audit finds the structural twin: the same *rules* re-held across surfaces. The
merge-boundary invariant ("a review never merges; merge is close-out's job after an Approve")
appears **~10 times** — 4× in the meta-prompt, again in the kickoff and the handbook, 4× in the
review template, and in close-out and implementation. One invariant, carried in every agent's
working memory, restated so often precisely *because* prose is the only thing holding it.

The pattern generalises: the highest-cost obligations are **shared invariants restated
per-surface**. The lift is always the same shape — **enforce or state it once, not once per
head.**

---

## 2. The lift docket — ranked, with a decision column

The actionable core. Ranked by (working-memory cost × number of heads carrying it × lift
confidence). Everything here is a candidate to take **off** the agent's plate; §5 is what stays.

| # | Obligation (consolidated) | Verdict | Carried in | Lift mechanism | Part I | Decision |
|--:|---|---|---|---|---|---|
| 1 | **Merge-boundary** — review/implementation never merge or set Done; merge is close-out's after an Approve | CODE-ENFORCE | meta 4× · kickoff · handbook · review 4× · close-out · impl (**~10**) | Review/impl sessions get a **read-only + comment-only token scope** with no merge/Done capability — the prohibition can't be violated regardless of recall | B18 | ☐ |
| 2 | **Staleness / re-ground against HEAD** — re-verify files & symbols before trusting the ticket | PRECOMPUTE | **all ~15 workers** (shared post-pass) | Inject the `git log --since=<createdAt> -- <referenced paths>` diff (or "none changed") as a **given fact**; agent reconciles a computed diff instead of re-deriving. *Same change that kills 68% orientation.* | rec #1 | ☐ |
| 3 | **Orchestrator stateful mechanics** — the beat flag-combo (`followUpTo:ROOT`+`force`+`subscription:everything`+`waitForFollowUps`+`target`+`sessionId`), root-anchor, beat `N/M` labels, child-kickoff flags | CODE-ENFORCE | kickoff 4× + handbook | A **`dispatchBeat()` / `dispatchChild()`** verb owns the fixed flag-set and label — the agent calls one verb instead of re-asserting 4–6 flags per send | B19 | ☐ |
| 4 | **The ~30-min silence / wedged-worker clock** — hold a last-activity ceiling per outstanding worker/child; nudge, then re-dispatch on expiry | CODE-ENFORCE | kickoff 5× · per-child *N clocks* in coordinator mode | A **runtime last-activity timer** per dispatch raises the "wedged?" wake itself — retires the single highest stateful load (the agent holds N simultaneous clocks) | B16 | ☐ |
| 5 | **Session-id on every dispatch** — stamp your own `sessionId` on every dispatch/nudge/child so the run groups as one tree | CODE-ENFORCE | kickoff + handbook (**5+×**) | The **proxy injects the caller's session id server-side** from the auth token; the agent never attaches it | — | ☐ |
| 6 | **Write-layer invariants** — retain the `bug` label after fix; never commit straight to main (`feat/<id>-…`); a blocker is a *relationship*, not a label | CODE-ENFORCE | bug + triage + note (3–4×) · impl · blocked + `formatIfBlocked` (4×) | Enforce on write: **reject bug-label removal**, **branch-protect main + branch-name check**, **offer only the `blocks`/`blocked-by` affordance** | B4/B5 | ☐ |
| 7 | **Routing facts** — `ciGreenOnSha`, `reviewVerdictOnRecord`, `priorInvestigationOnRecord` | PRECOMPUTE | review 3× · close-out 2× · meta (bug/close-out) | Inject each as a computed fact. Lifts the *recall* burden on close-out / review / bug routing (the "was there a real review?", "is CI green on this SHA?", "was this already investigated?" reads). The conditional *judgment* on top stays (§5) | §5 C→A | ☐ |
| 8 | **Single-action + defer-emits-no-body** — recommend exactly one verbatim-vocabulary action; a `defer` emits routing only, empty prompt body | CODE-ENFORCE | meta 3× each | **Schema-validate** the action token against `actionVocabulary`; **code strips/ignores** any body on a `defer` (downstream already parses `DeferTo` structurally) | — | ☐ |
| 9 | **Read-only mode** — in a readonly run never use `recommend-and-dispatch` (it emits write-shaped prompts) | CODE-ENFORCE | kickoff 2× | A **token/route scope that rejects write verbs** in readonly mode; today the design note admits this is unenforced convention | — | ☐ |
| 10 | **Plan-arrows → `blocked-by`** — a subtask's `blocked-by` set equals the plan's dependency arrows | PRECOMPUTE | breakdown 2× | If the plan's arrows are captured as structured data, **generate the relations deterministically** instead of transcribing from prose | — | ☐ |
| 11 | **Redundant prose** — "close nothing on completion" (6×), "defer to codebase" (= grounding, 3×), "reference don't restate context" (3×) | REDUNDANT | orchestrator + meta | **State once.** Near-free; the value is removing the two-code-paths-one-fact drift risk, not the tokens | §3 | ☐ |
| 12 | **Batch gate / role hold** — single-task→step vs set→coordinate; `waitForFollowUps` follows from the role launched | PRECOMPUTE | kickoff 2× · handbook 2× | Inject **`taskCount` / "this run holds N tasks"** as a fact so the gate is decided before the agent infers it; a role-based dispatch verb sets the hold | — | ☐ |

**If the top ~6 land**, a typical worker's held-obligation set drops by ~40% (see §4).

---

## 3. The full inventory by verdict

The complete extraction, for reference. Consolidated across the three surfaces (a rule in
multiple surfaces is listed once with its total head-count).

### 3.1 CODE-ENFORCE — make violation impossible (12)
Merge-boundary (~10 heads) · bug-label retention (4) · no-commit-to-main (1) · blocker-is-a-relationship (4) · stepper beat flag-combo (4) · root-anchor-never-previous-beat (3) · session-id-on-every-dispatch (5+) · 30-min silence clock (5, ×N children) · child-kickoff flag-combo (2) · beat `N/M` labeling (3) · single-action + verbatim-vocab (3) · defer-emits-no-body (3) · readonly-mode (2).

### 3.2 PRECOMPUTE — convert to an injected fact (8)
Staleness → since-creation diff (**all 15 workers**) · close-out-needs-review-evidence → `reviewVerdictOnRecord` (2) · bug-not-owed-investigation → `priorInvestigationOnRecord` (2) · frontier-facts (already precomputed; residual = don't override) (2) · approve-requires-CI-green → `ciGreenOnSha` (3) · plan-arrows → `blocked-by` (2) · stepper-batch-gate → `taskCount` (2) · `waitForFollowUps`-by-role (2).

### 3.3 REDUNDANT — state once (4)
Close-nothing-on-completion-axis (6×) · grounding-defer-to-codebase (3×, = the grounding rule's escape hatch) · context-reference-not-restate (3×) · [blocker-is-a-relationship overlaps CODE-ENFORCE].

### 3.4 MUST-HOLD — the irreducible core (§5)
The remaining ~35, left with the LLM.

---

## 4. "How many things must it hold?" — the quantified answer

A worker holds **~a dozen** interacting obligations concurrently, on top of a static
instruction load (from Part I: a ~15k-token meta-prompt of routing rules, a ~13–15k
kickoff+handbook of disposition, a 650–3,000-token template). The efficiency study's runtime
measurements put numbers on the *working set* that carries them:

- **~4–6 code surfaces** touched per edit-bearing worker (implementation median 6), each with its own invariants to keep straight;
- **~15 orientation results** buffered before the first productive edit — obligations accrued before acting;
- inside a context where **~68% of ingested material is re-grounding noise**, diluting the dense rule-core (the context-rot mechanism, LIN-816).

**Worked example — a `review` worker** currently holds ~10 obligations: never-merge ·
ledger-gate · green-CI-never-discharges · staleness · isolated-or-a-class · search-the-concept ·
plan-drift · approve-requires-CI · attachment-perceive-every · blocker-is-a-relationship. The
lift docket removes **4–5 of them** — merge→sandbox (#1), staleness→fact (#2), CI→fact (#7),
blocker→affordance (#6) — i.e. **~40% of its held rules become givens or impossibilities**,
returning that working memory to the deliverable judgment that remains.

---

## 5. The irreducible core — MUST-HOLD (leave alone)

These are genuine semantic reads over free-form evidence with no deterministic marker. They are
the reason an LLM is in the loop; determinism should **not** touch them.

**Routing intelligence (meta-prompt).** Priority-ordering of competing conditions · the
no-scope-never-implement / completed-prep-never-replan bias pair · the **bug-divergence veto**
(is the root cause still standing at the end of the comment trail?) · the already-landed guard ·
the design hatch (≥2 viable shapes?) · multi-phase→breakdown · research-necessity · scale-to-task
· grounding-only-to-task-context.

**Deliverable judgment (workers).** Isolated-or-one-of-a-class · search-the-concept-not-the-symbol
· second-representation→refactor-required · surface-assessment (consumer + who-pays) ·
refactor-as-separate-blocking-subtask · plan-drift-stop-and-replan · research-reasoning-wins ·
the ledger *discharge* decision · green-CI-never-discharges-a-ledger-item · confirm-cause-before-fix
· acceptance-witness-validation · cite-a-source-per-claim · strategy-before-scope ·
attachment-*perception* · triage-is-organization-not-research.

**The disposition (orchestrator).** Continue/complete/pause · done-is-a-pointer-not-proof · the
four human-owned lines · stand-by-don't-poll · halt-on-a-broken-own-instrument ·
live-child-set + blocked-by hold-back · variant-by-what-the-child-holds ·
stepper-decompose-within-one-kind · verb-override-not-hand-write.

Note the recurring shape: for several of these the platform can precompute the *inputs*
(CI status, review-on-record, the child dependency graph) — moving the **recall** to a fact —
while the **decision** stays judgment. That is the C→A seam from Part I §5, itemised: lift the
lookup, keep the call.

---

## 6. Caveats & method honesty

- **Not measured against outcomes.** This audit enumerates obligations and their liftability from the prompt sources; it does **not** yet show that lifting any given one reduces failures. That is H1 of the efficiency study, which stayed **untested** (no failed-session transcripts in-window). The link "fewer held obligations → fewer errors" is the reframe's premise (LIN-816 is the mechanism), well-motivated but not yet demonstrated here.
- **Head-counts are restatement counts**, read from the prompt text — a proxy for load, not a measurement of the model's actual working memory.
- **CODE-ENFORCE items are real platform work**, not prompt edits — a token-scope sandbox, a runtime timer, dispatch verbs. Effort is genuine; the payoff is that the obligation leaves the agent's remit permanently.
- **Prefer MUST-HOLD when unsure.** The extraction was instructed to default to MUST-HOLD unless a concrete lift mechanism exists, so the docket is conservative — the lift list is a floor, not a ceiling.

---

## 7. Recommended sequence (for review)

1. **#2 Staleness→fact + #1 merge-sandbox** — the two-axis convergence and the most-restated invariant. Highest combined payoff; #2 also discharges the top efficiency lever.
2. **#3 + #4 + #5 orchestrator lifts** (`dispatchBeat`/`dispatchChild` verb · runtime silence timer · server-injected session id) — retires the entire *stateful* orchestrator load in one workstream.
3. **#6 write-layer invariants + #8 schema guards** — small, cheap, high-restatement CODE-ENFORCE wins.
4. **#7 + #10 + #12 fact injection** — the C→A recall-lifts; sequence behind whatever detector each needs.
5. **#11 redundant-prose deletions** — free; do for drift-hygiene.

*Extraction method: three parallel obligation passes over `lib/prompts/meta-prompt-template.js`
+ `lib/prompt-formatters.js`, `lib/prompts/autopilot-kickoff.js` + `autopilot-manual.js`, and
`lib/prompt-template-defs.js` + `lib/prompt-templates.js`, each classifying against the §0
verdict schema; consolidated here. Head-counts and rationales are traceable to those sources.*
