# Autopilot — A Thinking Document

## Status

A thinking document — the *what / why / goals / invariants* for the autonomous
development loop, written before any build decisions. It is the first artifact in the
project's normal pipeline (thinking doc → reconciliation → build spec → tickets), the same
path `docs/direction-layer-proposal.md` → `docs/drift-defense.md` → LIN-289 took.

It deliberately **does not** decide what to build, refactor, or tidy. That is the next
step. This document's only job is to fix the intent and the rules the implementation must
not drift from — so that when the build decisions come, there is something to score them
against.

Much of what follows already exists in some form (the foreman is shipped, drift-defense is
specced, periodicals is a stub). This is **not a greenfield design.** The single largest
risk it guards against is building something parallel to what is already there; §6 names
the overlap honestly so the reconciliation step can do its job.

---

## 1. What it is

Autopilot is the loop that runs the workbench itself. Today a human loads LinearViewer,
reads a couple of briefs, decides which task is next, and dispatches the AI-recommended
prompt to an agent. Autopilot is a **thin orchestrator** that does that walk
continuously — read state, pick the next task, dispatch the recommended prompt to a worker,
watch the feedback, and move on — while a human stays at the one place judgment is
irreducible: deciding whether the work is still pointed somewhere worth going.

It has two halves that have been discussed separately but are one machine:

- a **producer** that keeps generating the work the backlog structurally forgets
  (periodicals — code quality, test coverage, security, docs, architecture), and
- a **consumer** that works the resulting stack (the orchestrator + its dispatched
  workers).

## 2. Why now

LinearViewer's north star: *keep human intent in command of AI-accelerated execution.* The
direction-layer thesis is that AI made *producing* work cheap, so the bottleneck moved
upstream — from execution to direction. "The bottleneck moves but doesn't disappear; it
goes upstream." The lower layers (prompts, dispatch, recommender, single-session foreman)
are built. Autopilot is the step where the human stops being the loop's *clock* — the thing
that has to be present for each tick — and becomes its *navigator*. The goal is to switch it
on, watch tasks be tackled one at a time, and have the system flag — not silently
resolve — the moments that genuinely need a human.

## 3. Goals and non-goals

**Goals**

- Close the *execution* loop: state → next task → dispatch → watch → repeat, unattended.
- Generate substrate-maintenance work proactively (periodicals), not only reactively.
- Concentrate the human's attention onto a small, named surface instead of every task.
- Make the trust model *mechanical* — enforced by the contract, not by an agent's good
  intentions.
- **Be watchable.** After it orients itself, the autopilot emits short, high-level recaps a
  human can follow at a glance — the default experience is sitting back and watching a live
  Claude Code session narrate its progress, not reading task detail.

**Non-goals** (these matter most — they are the lines the build must not cross)

- **Not full autonomy.** The loop detects and surfaces; it never silently reconciles a
  tension, redefines "done," or edits intent. A human adjudicates.
- **Not trusting self-report on completion.** A `complete` claim with no corroborating
  external evidence is "claimed, unverified" — surfaced, not accepted.
- **Not editing the normative layer.** Autopilot may maintain descriptive documentation; it
  may never rewrite the north star to match what it observed.
- **Not a heavy, all-knowing driver.** The orchestrator stays light; understanding the code
  is the worker's job, not the orchestrator's.

## 4. The four invariants

For this system the invariants *are* the design; everything else is implementation. Every
later build/refactor decision should be scored against these:

1. **Human at the normative edge.** Non-autonomy. The loop flags; it does not act on
   anything that changes what "worth doing" or "done" means.
2. **External evidence over self-report.** Completion is judged on signals the worker
   cannot author — CI, PR/merge state, a diff that exists, a fresh-context review, uploaded
   session logs — not on the Linear state the worker itself wrote.
3. **Descriptive vs. normative firewall.** Periodicals and doc upkeep maintain the
   *descriptive* layer (architecture, API, what-the-code-does). The *normative* layer (the
   north star, the definition of intent) is human-authored, always.
4. **Light orchestrator.** The driver reads distilled context (recap/brief/stack) and
   dispatches; it never becomes the worker. The worker carries the heavy context and the
   full toolset.

## 5. Key components

One line each; the build spec will expand them.

- **Producer — periodicals.** Recurring template tasks (code quality, test coverage,
  security, docs, architecture stability, refactoring) that, when dispatched, *generate the
  real tasks* as their first step and feed findings back into the descriptive
  documentation. Feature-flagged; start with a few templates. The drift-supervisor review is
  itself a periodical — the producer is its natural scheduler.
- **Consumer — the thin orchestrator.** Walks the stack: pick → recap/brief → recommend →
  **dispatch the whole prompt to a separate worker** → watch feedback → decide
  (continue / complete / help). Distinct from the shipped single-session foreman, which
  alternates orchestrator and worker roles inside one session.
- **Worker — the runner (already built).** Dispatch plus a separate consumer system that
  runs Claude Code against a dispatched prompt — as a CLI on a local machine, or via the web
  remote-control feature. This is the main runner, and the worker is a **full Claude Code
  session with full tools**: it can run the tests and CI/CD checks itself, in-loop, rather
  than depending on a separate evidence service. Feedback comes back as free-form text (a
  string) — that stays first-class.
- **Sensors — independent signal.** Oracle checks (tests, CI, coverage, scanners, lint,
  types), product-usage feedback from humans, and fresh-context reviews/retros. Because the
  worker is Claude Code it can *run* these checks itself in-loop; invariant 2's discipline is
  then that the judge weights the **check's result** (exit code, CI status, the diff), not
  the agent's narration of it. The orchestrator, reading from a separate session, is itself
  an independent read.
- **The human edge.** A small, named surface: adjudicate the normative questions and the
  judgment-class flags the loop raises. Everything else runs without them.

## 6. Orientation: the autopilot's starting prompt

The autopilot starts from a single prompt: **the guide** (how to drive the loop) plus a
**deterministic situation snapshot** (where things stand right now). Deterministic matters —
the snapshot is computed, not LLM-generated, so it is cheap and exact, and the orchestrator
is *handed* its bearings instead of spending context rediscovering them. The snapshot
contains at least:

- **Periodical cadence state** — each periodical and when it last ran / whether it is due
  (e.g. "code review: 14d ago → due; security: 3d ago; docs: never").
- **Top of the stack** — the top-N sorted tasks (already available via `/stack`), ideally
  tagged with north-star classification when present.
- **The human's instruction, if any** — a scope ("work the Ship view", "complete project X")
  or nothing.

The autopilot's **first act is to orient**: apply a fixed precedence to the snapshot and
announce what it will work on. A sensible default precedence:

1. an explicit human instruction, else
2. a periodical past its cadence threshold (maintenance debt), else
3. the top of the stack (north-star-aligned first).

This sits right on invariant 1: "what's worth doing next" is normative-adjacent, so the
precedence must be a **human-authored policy the autopilot executes**, not a judgment it
improvises. Orientation = apply the policy to the snapshot, emit the choice, let the human
veto. The moment the autopilot reasons freely about what is *worth* doing, it has crossed
the firewall.

The guide must ask for two distinct outputs, each at a fixed altitude:

- **Internal recitation** — the existing machine-discipline beat (role, next allowed action,
  the strike counters) that keeps the loop honest across turns.
- **External recap** — a short, high-level, human-legible line at each loop boundary
  ("oriented: code review was due, starting it → generated 3 tasks → working LIN-340 →
  worker reports tests pass, PR opened → continuing"). This is the surface the human watches.
  It is *not* the foreman-status log (the durable machine record) and *not* the internal
  recitation — it is the live channel for someone sitting back.

## 7. How it relates to what exists

Honest inventory, because the main risk is parallel-building:

| Piece | Where it is today | State |
|---|---|---|
| The driving verbs (`stack`, `recommend`, `recap`, `brief`, `foreman/status`) | proxy API | **shipped** |
| Single-session foreman + playbook | `lib/prompts/foreman-playbook.js`, LIN-209 | **shipped** |
| Foreman scoped to one project / area | LIN-237 | stub |
| Periodicals (the producer) | LIN-315 | thin stub |
| External-evidence weighting | LIN-292 (epic LIN-289) | specced, unbuilt |
| Periodic cross-task drift supervisor | LIN-291 | specced, unbuilt |
| Measurement spine (benchmark / fuzzy / ablation) | LIN-263 / LIN-45 / LIN-293 | unbuilt |
| Dispatch queue + feedback | `routes/dispatch.js` | shipped (feedback free-form — intentional) |
| Runner: dispatch consumer running Claude Code (local CLI or web remote-control) | separate system | **shipped — the main runner** |
| Harbour (local) runner | `lib/harbour-spawn.js`, LIN-259 | shipped — one such consumer |
| API contract unification | LIN-306 / 309 / 310 / 311 | in-flight — **will move the contract Autopilot drives** |

What is genuinely net-new (lives in no ticket yet, only in the design conversation):

- The **thin-orchestrator-dispatches-to-separate-workers** architecture (vs. LIN-209's
  single session). The runner it dispatches to already exists; the orchestrator that drives
  it this way does not.
- The **deterministic orientation snapshot + human-authored precedence policy** (§6) — the
  autopilot's starting prompt, and its first decision.
- The **external recap** channel (§6) — the high-level, watchable narration, distinct from
  the foreman-status log and the internal recitation.
- A way for the loop to **consult evidence** at the `complete` boundary. Not a rigid schema —
  feedback stays a free-form string; the worker (Claude Code) can run the checks in-loop and
  surface the results. The requirement is that the judge *looks at* the evidence, not that
  feedback conform to a shape. (This is LIN-292 made practical by the runner being Claude
  Code.)
- The **oracle-vs-judgment split** for periodicals (which classes self-ground, which stay
  human-adjudicated).
- The realization that **LIN-291 is a periodical**, so the two should be one machine.

---

## What this document defers

Everything actionable. "What to build vs. refactor vs. tidy," the exact rules of the
orientation precedence policy, whether Autopilot waits on the LIN-306 API unification, the
periodical template set, and the ticket structure are all the *next* steps. This document
exists so those decisions have a fixed intent and four invariants to answer to.
