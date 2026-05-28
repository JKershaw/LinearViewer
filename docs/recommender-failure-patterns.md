# Recommender Failure Patterns: Survivors, Root Properties, and a Fix Map

## Status

Design note / problem map. Companion to
[`recommender-structural-drift.md`](./recommender-structural-drift.md), which covers one
pattern (local-optimum drift) in depth. This note widens the lens: it enumerates the candidate
unwanted patterns the AI task-loop can produce, filters them against what consuming agents can
already self-correct, grounds the survivors in the actual code, and maps fixes by where they
live. No code changes proposed as committed work yet.

## Why this exists

LinearViewer's recommendation loop is a greedy per-issue optimizer driving (optionally
autonomous) AI agents. Greedy autonomous loops have characteristic emergent failure modes. The
goal here is to catalogue them *once*, decide which are real, and — critically — avoid
"fixing" structural problems with cheap local patches, which is itself the failure mode this
analysis is about.

## The self-correction filter

Not every hypothesized pattern is a real risk, because the consuming agent self-corrects. The
useful question is not "can this go wrong?" but "can this go wrong in a way the agent can't
catch?" That has a crisp answer.

A capable coding agent reliably fixes its own **intra-task, intra-context** mistakes: it
re-reads, re-runs tests, notices a wrong path mid-task. So "agent does a dumb thing inside one
task" is largely a non-issue.

An agent **structurally cannot** self-correct four things:

- **(a) What it can't see** — errors that live across issues/sessions it isn't shown.
- **(b) What it is the biased reporter of** — you can't grade your own blind spot; an
  over-optimistic agent's self-review is authored by the same optimism.
- **(c) What crosses a stateless boundary** — a decision made in a prior pass it has no memory
  of.
- **(d) What needs authority it doesn't have** — irreversible / high-blast-radius actions.

The residual risk set is exactly the patterns that are **cross-context, self-referential, or
authority-requiring.** Everything else, assume the agent handles.

## Per-pattern verdicts (grounded in code)

Context for the verdicts, from the code as it stands:

- The recommender is fed a single issue + ≤5 siblings + ≤20 "cousins" (only when the parent is
  epic-shaped) + parent + children + comments + project (`lib/openrouter.js`,
  `formatIssueContext`; assembled in `routes/workspace-api.js`). It receives **no relations /
  blocked-by graph and no recently-closed tickets.**
- Completion is judged on **Linear state the agent itself wrote** (labels, comments, status).
  Nothing in the flow consults CI / GitHub Actions, PR state, or a git diff against main.
- Each recommendation is generated **statelessly**; foreman status/sessions/tasks are
  **write-only logs**, not inputs to the next recommendation.
- Dispatch claims are atomic per item (`findOneAndDelete` in `lib/dispatch-store.js`), but
  there is **no workspace-level coordination** across consumers.
- There is **no human-gate** language anywhere; the loop is fully autonomous once a token
  exists.
- The decision tree always emits one of 14 action templates. There is **no `done` / `close` /
  `stop` terminal action.**
- Self-verification (Surface Assessment, cross-cutting check, gap analysis) is **instructed in
  templates, not enforced.**

| Pattern | Self-correct? | Verdict |
|---|---|---|
| **Local-optimum drift** (correct steps compound into wrong trajectory) | ✗ (a) — cluster invisible to any one agent | **Survives — marquee** |
| **Parallel collision** (two agents change related issues) | ✗ (a/d), but only bites multi-agent | **Survives, contingent on multi-consumer use** |
| **Duplicate work** | ~ agent *can* search Linear | Mostly handled |
| **Marking own homework** (completion self-attested, no external truth) | ✗ (b) — the core unfixable-by-agent one | **Survives — highest leverage** |
| **Proxy gaming / Goodhart** (satisfy the issue, not the goal) | ~ partial (grounding + criteria help) | Partial |
| **Completion-signal gaming** (declare done, skip the tail) | ~ partial (self-review unenforced) | Partial |
| **Decomposition sprawl** | ✓ mostly (`breakdown` gated on multi-session plan) | Mostly handled |
| **Perpetual preparation** | ✓ mostly ("clear enough → skip") | Mostly handled |
| **Thrashing / no memory** (contradictory passes) | ✗ (c) for *decision* memory; damped by label state machine | **Survives, partially damped** |
| **Automation complacency** | ✗ (d), but only in foreman mode | **Survives, contingent on autonomy mode** |
| **Anchoring / deskilling** | — soft | Accept |
| **Substrate erosion** (labels/comments illegible to humans) | — long-horizon | Low |

**Survivors worth designing for, by leverage:** external-truth gap (self-report) → cross-issue
blindness → decision memory → missing terminal `close` action → human gates → parallel
coordination (if/when multi-agent).

## Four root properties

The survivors are not independent bugs. They are symptoms of four properties of the flow.
Fixing a property retires a family; patching a symptom does not.

| Root property | Survivors it spawns | Direction of fix |
|---|---|---|
| **The actor reports its own progress and is judged on that report** (closed loop, no independent verifier) | marking own homework, proxy/completion gaming | Weight *evidence* over *attestation* — feed CI/Actions, PR state, diff into the recommendation. |
| **Recommendations are per-issue, stateless, fresh** | drift, duplicate work, thrashing | Give the loop a cross-issue view *and* decision memory. |
| **The loop must always emit an action** (no `done`/`stop`/`escalate`) | sprawl, perpetual prep, no clean termination | Make "complete / close", "do nothing", and "escalate to human" first-class outputs. |
| **Humans are optional reviewers, not gates at high-stakes points** | automation complacency, irreversible-action risk | Require confirmation for irreversible / high-blast actions; opt-in, scoped. |

Leverage ranking: **property 1 > 2 > 3 > 4.** Property 1 is worst because a false record
poisons every later recommendation and is invisible exactly when it matters — and it is the one
an agent provably cannot self-correct (filter (b)). It is also cleanly fixable, because an
external truth source (CI / PR state) already exists in the proxy layer; the loop simply
doesn't privilege it over self-report.

## Improvements, grouped by where the fix lives

Five categories. The backbone is "prompt changes / new templates / architecture"; two more are
added because **the highest-leverage fixes live in neither prompts nor templates**, and would
otherwise be mis-filed and deprioritized.

### 1. Prompt changes (edit meta-prompt / existing templates)
Cheap, but only moves behaviors the model can act on with information it *already has*.
- Instruct: "if evidence contradicts Linear status, distrust the status."
- Promote self-review from a suggestion to a *required reported output*.
- ⚠️ On their own, these are symptom patches for the epistemic and blindness survivors — you
  cannot prompt your way to a truth source or a graph the model was never given.

### 2. Additional prompt templates (new action types)
- A `verify` / `close` **terminal template** — there is currently no "done" action; the loop
  can only ever recommend more work. Real gap.
- A `step-back` / architectural-review template (the escalation branch from the drift note),
  triggered by the cluster signal.

### 3. Context / data plumbing *(added category — most leverage)*
"What the recommender is fed," not "how it's prompted."
- Feed the **relations / blocked-by graph + recently-closed siblings** → retires blindness and
  enables cluster detection.
- Feed **external truth** (GitHub Actions/CI status, PR state, git diff) → the only real fix
  for marking-own-homework.

### 4. Architecture / control flow
- Make foreman status/feedback a **read input** to the next recommendation, not a write-only
  log → fixes decision memory / thrashing.
- Compute a server-side **cluster-detection signal** ("Nth fix on the same constraint") rather
  than hoping the LLM infers it.
- Workspace-level **claim / awareness** for multi-agent coordination.

### 5. Policy / guardrails *(added category)*
- A **human-gate policy** for irreversible / high-blast actions (close, destructive change,
  large diff). Opt-in — it trades against the autonomy that makes foreman valuable.

### Survivor → category map

The point of this table: for almost every survivor, the prompt change is the *smallest* lever.

| Survivor | Prompt | New template | **Plumbing** | **Architecture** | Policy |
|---|---|---|---|---|---|
| Self-report gap | weak | `verify`/`close` | **CI/PR/diff feed ← real fix** | gate close on evidence | — |
| Cross-issue blindness | weak | `step-back` | **relations + recent-closed ← real fix** | cluster signal | — |
| Decision memory | — | — | feedback feed | **status as input ← real fix** | — |
| Missing terminal state | — | **`close` template ← real fix** | — | — | — |
| Human gates | flag-only | — | — | — | **policy layer ← real fix** |

## Strategy guidance

Two rules keep this from re-enacting the very pattern it studies:

1. **Keep the root-property → survivor map as the spine; treat fix-category as a secondary
   axis** (a cost / where-it-lives tag), not the organizing principle. Grouping by
   fix-mechanism invites sequencing by *cheapness* — "knock out the prompt-change bucket
   first" — which ships prompt tweaks for problems that are actually data-flow and architecture
   problems, leaving every root intact while feeling productive. That is the local-optimum trap
   recursively. **Sequence by leverage, not by cheapness:** external-truth feed → cross-issue
   feed → decision memory → terminal `close` template → gates. Prompt changes ride along with
   each, not first and alone.

2. **Bar each fix against three tests before building it:** is the risk *real*, is it
   *unreachable by agent self-correction*, and is it *worth the autonomy cost*? Several
   survivors (gates, coordination) only bite in full-autonomy foreman mode and would erode the
   autonomy that makes that mode valuable. Those belong behind opt-in configuration scoped to
   irreversible actions — not as default friction on the copy-paste flow, where the human is
   already in the loop.

## Scope guard

This is about recommendation *routing* and the loop's ability to detect failures its agents
cannot. It does not propose weakening the grounding rule for prompt *bodies*, and it does not
claim the greedy local optimizer is wrong for the common case — it is right, and most issues
should keep routing exactly as they do today. The aim is a small number of new capabilities:
privilege external evidence over self-report, see across issues, remember prior decisions,
terminate cleanly, and gate the irreversible.
