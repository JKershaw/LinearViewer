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

> **Update (2026-06-06) — Stage A is built and verified.** The first build decision (the
> proxy dispatch verbs, §8.A) has been made and shipped, and the dispatch runner's telemetry
> was driven to completion across **ten live runs**. The dispatch→runner→feedback leg now
> works on both `cli` and `web`, with a derived terminal `status`, structured `[evidence]`
> URLs, 30s liveness heartbeats, and a final recap. The remaining unbuilt piece is the
> autonomous orchestrator itself (Stage B). The experiment, results, and the full
> dispatch-consumer punch-list live in **[`autopilot-experiment.md`](./autopilot-experiment.md)**;
> §7–§8 below are annotated with what has since shipped.

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

### Context economy — what the orchestrator tracks per task

Invariant 4 (light orchestrator) is not only about *who does the work* — it is also about
*how much the driver holds in context while watching it*. The orchestrator should carry the
**minimum descriptive state needed to choose the next action**, and no more. Full task prose
actively hurts: it bloats context, and worse, it tempts the orchestrator to re-reason about
*how* to do the task — the worker's job — instead of *whether it is done*, which blurs the
descriptive/normative firewall (invariant 3) and the light-orchestrator line.

The test for any candidate field is: **does it change a decision, and at what granularity?**
Applied to a dispatched task, the orchestrator holds a small **task header** —

- **kind** (planning / research / implementation / review / retro / …) — a *coarse enum*, not
  prose;
- **state** (queued / taken / live / done-claimed / stalled);
- **evidence pointers** (issue identifier, PR/branch URL) — the place to *look* to judge
  completion, not the content itself;
- **liveness** (last-event time, phase, heartbeat) — working vs. dead;

— and treats the full prompt and full feedback log as **drill-down on demand**, pulled only
when a decision actually needs them (e.g. re-grounding a stalled task before re-dispatch),
never held in the steady-state loop.

**Why `kind` specifically earns its place in the header.** The autopilot dispatches the
*AI-recommended* prompt, and that recommendation is what chooses the next step. So the *kind*
of each successive dispatch is the cheapest read on the work's **trajectory**: a healthy task
walks research → planning → implementation → review and converges; a task that keeps
re-dispatching the same kind is looping; one whose kind keeps *broadening* is expanding in
scope. Tracking the sequence of kinds lets the orchestrator (and the watching human) see a
task *progressing, stalling, or expanding* without holding any of the task's actual content.
That is exactly the altitude the light orchestrator should operate at.

The `kind` should come from a **bounded vocabulary the system already owns** — the prompt
templates (`lib/prompt-template-defs.js`) are already classified — plumbed through dispatch as
a first-class field, rather than parsed out of a free-form `promptName` or, worse, the prompt
body. (The exact field set is a build-spec decision; deferred below.)

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
| **Proxy dispatch verbs** (`POST /api/proxy/dispatch` enqueue, `GET …/:id` watch, `GET …` list) | proxy API | **shipped (this branch)** — derived terminal `status`, structured `[evidence]` URLs; see experiment doc |
| Runner: dispatch consumer running Claude Code (local CLI or web remote-control) | separate system | **shipped + telemetry-complete** — phase tags, 30s heartbeats, recap, `[evidence]`, `[done]`/`[failed]` (Runs 1–10) |
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

## 8. Implementation approach: the minimal path

Autopilot does not need a new orchestration service. The foreman is **already** a generated,
pasteable prompt — you paste it into a Claude session and it drives the loop. The minimal
path is to treat Autopilot as **"Foreman v2"**: the same pattern, with an orientation
snapshot and an optional goal baked into the kickoff prompt, plus the ability to **dispatch
to a separate worker** instead of doing the work in-session. This deliberately makes
Autopilot the *evolution* of LIN-209, not a parallel build — the cleanest answer to the
parallel-build risk.

### Kickoff UX

Optionally type a goal → click generate → a complete prompt is produced → paste it into
Claude → it orients, announces its choice, dispatches, watches, and recaps. The generated
prompt carries the guide, the deterministic orientation snapshot, and (if given) the goal.
A specific focus is just the goal field, or a hand-written prompt followed by the guide.

### What is actually a build (small)

- **A. Proxy dispatch verbs.** ✅ **shipped (2026-06-06).** `POST /api/proxy/dispatch` (enqueue)
  shipped together with the read side — `GET /api/proxy/dispatch/:id` (watch) and
  `GET /api/proxy/dispatch` (list/filter). The watch/list derive a terminal `status`
  (`done`/`failed`/`aborted`) from the runner's feedback marker, the runner posts structured
  `[evidence]` URLs + 30s heartbeats + a final recap, and enqueue auto-appends a proxy-context
  block so the worker inherits Linear access. Verified end-to-end on `cli` and `web` across ten
  runs — see [`autopilot-experiment.md`](./autopilot-experiment.md). (Standing readWrite token in
  the auto-appended block is flagged in-code as security debt to revisit.)
- **B. The kickoff generator.** A form (optional goal) + a builder that assembles
  **guide + deterministic orientation snapshot + optional goal** into one pasteable prompt.
  Mostly assembling existing pieces: `buildForemanPlaybook()` already exists; the new part is
  a snapshot builder (periodical cadence + top-of-stack via `/stack`) and the goal slot.
- **C. Periodicals cadence.** The only stateful bit — the snapshot needs "code review last
  ran 14d ago." v1 can likely **derive** this from existing signals (`foreman/status`
  history, git log, periodical-tagged Linear search) rather than build a store; add a store
  later if derivation proves flaky.

### What is just guide text (no build)

- The **watchable external recap** (one high-level line per loop boundary).
- The **precedence policy** (human instruction → overdue periodical → top of stack); the
  goal field is the override branch.
- The **evidence discipline** — instruct the orchestrator to confirm a dispatched worker's
  `complete` against a real check / PR before accepting it.

### Three caveats this path must not paper over

1. **Evidence is the one place prose is load-bearing.** In the minimal path the orchestrator
   reads the worker's *report* of CI. True independence means the guide must make the
   orchestrator **look at CI/PR itself** (it is Claude Code; it can), not rubber-stamp a
   sentence. This is invariant 2 / LIN-292 and the bit most likely to quietly degrade — it
   needs a sharp, testable instruction, not a soft one. *(Partly addressed: the runner now
   emits structured `[evidence]` entries with artifact URLs, so the orchestrator has concrete
   pointers to fetch and check rather than a sentence to trust. The still-soft part — the
   guide instruction that it actually fetches/checks them — is Stage B's to get right.)*
2. **The watch half of the API is easy to under-scope.** Enqueue alone feels like
   "dispatching," but the orchestrator must poll its own dispatches' status/feedback to know
   when to continue. Spec both together. ✅ *Done: enqueue, watch (`/:id`), and list shipped
   together; the watch side surfaces a derived terminal `status` and the full feedback stream.*
3. **LIN-306 is unifying the very contract this extends.** Adding a proxy dispatch verb now
   either builds on the about-to-change wire contract or front-runs it. Current lean: add it
   now in today's idiom — it is small, LIN-306 will reshape it regardless, and blocking on
   that refactor delays the thing we actually want to try.

---

## What this document defers

The remaining open decisions: the **`kind` / task-header field set** the orchestrator tracks
per task (§6's context economy — the dispatch verbs shipped, but they do not yet carry a
`kind`, and the watch endpoint does not yet surface one), the exact rules and cadence
thresholds of the orientation precedence policy, the periodical template set, the precise
sequencing against LIN-306, and the ticket structure. Those are
the build-spec and reconciliation steps. This document exists so they have a fixed intent
and four invariants to answer to. *(The dispatch verbs' request/response shape — once an open
decision here — is now settled and documented in
[`proxy-integration.md`](./proxy-integration.md) and `autopilot-experiment.md`.)*
