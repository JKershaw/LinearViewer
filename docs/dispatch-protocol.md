# Dispatch Protocol — the inter-agent communication contract

> **Status: DRAFT (Step 0 of LIN-900).** This is the single source of truth for how any
> dispatcher and any session-node must communicate. It defines *behaviour*, not
> implementation — any conformant dispatcher (Simple Dispatcher today, others later) can be
> built against it. Harbour owns this file; Step 1 makes Harbour honour it, Step 2 makes
> Simple Dispatcher honour it. Full design discussion: the LIN-900 comment thread.

Normative keywords **MUST / MUST NOT / SHOULD / MAY** are used in the RFC-2119 sense.

## 1. The model

The system is **one uniform node type**, not three. An orchestrator, an autopilot, and a
worker are the *same session-node* in different configurations. Every node can:

- **dispatch** — start another node (fresh, or resume an existing one as a follow-up);
- **receive** — take a follow-up message while alive or after it has stopped;
- **report** — emit exactly one *sentinel* when it stops.

Nodes form a **tree**: a dispatch creates an edge from the dispatching node (**parent**) to
the dispatched node (**child**). The entire protocol reduces to **one variable: does an
event at a node propagate up its edge to the parent, or stay local?** Every "independent
problem" in the original audit — dual state machines, two notification mechanisms, five
timeouts, four meanings of "blocked" — is a symptom of that rule never having been stated.
This document states it.

## 2. Sentinel vocabulary — the outcomes

When a node stops it MUST resolve to exactly one outcome. The sentinel is both the node's
self-report *and* the input to the bubbling decision (§5).

| Outcome | Meaning | Node lifecycle | Arms warm receive? (§8.1) |
|---|---|---|---|
| **DONE** | Work completed successfully. | terminate | briefly — completion-hold, a *removable* latency optimization |
| **FAILED** | Work ended without completing (error, crash, gave up). | terminate | briefly — completion-hold, a *removable* latency optimization |
| **BLOCKED** | Cannot proceed without outside help. | park | yes — to receive the unblocking nudge |
| **PENDING-internal** | Waiting on **its own** async work; will self-wake. | stop, not held | **no** — busy with its own async |
| **PENDING-external** | Waiting on **another session** (a child's result, or the parent's next beat). | stop, held | yes — to receive the awaited event |

Two groupings do most of the work:

- **Terminal = {DONE, FAILED}.** They differ only in payload/meaning; in protocol mechanics
  they are identical — terminate the node and **always bubble** (§5). A branch that finished,
  well or badly, always reaches its parent. FAILED is node-emittable, and is also what the
  dispatcher's ultimate backstop resolves an unrecoverable node to (§8).
- **BLOCKED** also always bubbles ("I need you now") but parks instead of terminating.

Rules:

- **PENDING-external is defined by "waiting on another session," not by "waiting on a
  child."** A stepper worker awaiting its parent's next instruction is PENDING-external too.
  Implementations MUST NOT bake "child" into the definition.
- A node SHOULD emit its sentinel as the last thing it does on stop. A stop with no parseable
  sentinel is not an error state — the §8 failsafe re-fires the sentinel to recover it.
- The sentinel marker syntax (the literal strings a node writes) is fixed in §3.

## 3. Marker syntax

A sentinel is a line the node emits that begins with one of four canonical markers, matched
anchored at line start, case-insensitive:

```
DONE:      <optional summary>
FAILED:    <what went wrong>
BLOCKED:   <what is needed>
PENDING:   <what it is waiting on>     # internal vs external is classified per §4
```

- `DONE:`, `FAILED:`, and `BLOCKED:` map directly to their outcomes. `DONE:` and `FAILED:`
  are the two terminal markers (§2).
- `PENDING:` is disambiguated into **PENDING-internal** or **PENDING-external** by the
  classifier in §4 — a node SHOULD state what it is waiting on so the classifier and any
  human reader can tell which it is.
- **This is the canonical vocabulary; there are no aliases.** A dispatcher's own transport
  MAY encode outcomes differently on the wire (an implementation concern — e.g. Harbour's
  feedback strings; see Appendix A), but that encoding is a private layer *below* this
  contract and MUST map one-to-one onto these outcomes. The contract is defined in terms of
  the outcomes, not any wire encoding.

> **This is the load-bearing behavioural change for Step 1.** Today a `[pending]`-style
> marker is uniformly "wake-worthy." Under this contract PENDING-**internal** MUST NOT wake
> the parent; only PENDING-**external** may (and only subject to §5). See §8.

## 4. Classification — evidence pre-empts the ask

Splitting a `PENDING:` into internal vs external follows one priority order:

1. **Evidence first (fast path).** If deterministic, machine-visible evidence shows the node
   has outstanding async work of its own, classify **PENDING-internal** without asking.
   Evidence is authoritative where it exists.
2. **Ask second.** Where evidence is silent — true completion, and cross-session waits — the
   sentinel the node emitted is the authority.
3. **When in doubt, never assume DONE.** Genuine ambiguity — a missing or garbled sentinel —
   needs no bespoke degradation ladder: the §8 failsafe re-fires the sentinel over the
   durable path and recovers it. The only hard rule here is that a node is never treated as
   DONE without a sentinel that says so.

**Sentinel accuracy is in scope for this work.** Refining the sentinel prompt so a node
reliably picks the *right* outcome is a comms concern, not deferred — see §9 for where the
line sits with the deeper epistemics question.

## 5. The bubbling matrix

An edge carries a declared **subscription level** (§6). Whether a node's outcome propagates
to its parent is a pure function of `(outcome, edge.subscription)`:

| Outcome | `terminal-only` edge | `everything` edge |
|---|---|---|
| **DONE** | bubbles | bubbles |
| **FAILED** | bubbles | bubbles |
| **BLOCKED** | bubbles | bubbles |
| **PENDING-internal** | silent | silent |
| **PENDING-external** | silent | bubbles |

- **DONE, FAILED, and BLOCKED always bubble**, regardless of subscription level. DONE/FAILED
  = "the branch finished" (well / badly); BLOCKED = "I need you now." A parent always learns
  of all three.
- **PENDING-internal never bubbles.** It is internal noise; the node self-wakes.
- **PENDING-external bubbles only on an `everything` edge.** This is the one row the
  subscription level controls — the difference between a stepper (wants every beat) and an
  orchestrator (wants only terminal outcomes).

## 6. The edge schema

A dispatch MUST record, on the edge, at minimum:

| Field | Meaning | Required |
|---|---|---|
| **parent** | The single node this edge reports to (§7). | yes |
| **subscription** | Enum: `everything` \| `terminal-only`. Declared by the dispatcher at dispatch time. | yes |

- `subscription` **replaces the boolean `subscribe`** and its derived companions. A dispatcher
  MUST NOT reconstruct subscription intent from incidental fields (e.g. "has a sessionId");
  it is declared, once, on the edge.
- The parent link is the *only* addressing information a node has. A node MUST NOT be able to
  name any other recipient. This makes altitude structural (§7).

## 7. Altitude is structural — the single-recipient rule

A propagated event goes to **exactly one recipient: the node's parent, one hop up.** A node
cannot address its grandparent or any other node. Therefore:

- Altitude cannot drift — it is a property of the tree, not a policy a prompt must remember.
- **Multi-level propagation is one hop, re-originated per level.** A child's DONE bubbles to
  its direct parent. *Only if that parent then itself stops* does the parent emit its own
  sentinel to *its* parent, re-deciding via §5 against *its* edge's subscription. Events do
  not tunnel N levels; each hop re-decides.

## 8. The receive path — arming it, and delivering over it

Follow-ups reach a node over **one interface with two implementations, selected by
liveness**. A conformant dispatcher MUST provide both:

- **Warm path — the stop-hook long poll.** On stop, a node holds a long poll open so a
  bubbled event can be injected into the still-live process. No window churn. Available only
  while the process is alive and holding.
- **Durable path — resume.** If no live long poll is held, the dispatcher resumes the node to
  deliver the event (or to re-ask its sentinel).

### 8.1 When to arm the warm path

Arming the long poll is the default on every stop — **except PENDING-internal, which is the
one outcome that MUST NOT arm it.** This rests on a safety asymmetry:

- **Firing (or re-firing) a sentinel is always safe** — at worst the node re-reports.
- **Arming the long poll is safe only when the node has no internal pending actions.** A
  PENDING-internal node has its own async in flight; holding a stop-hook long poll would
  misrepresent a busy node as an idle one waiting for input. So it stops without arming and
  relies on self-wake.

The *reason* for arming differs by outcome, and this is where "required mechanism" and
"removable optimization" part ways:

- **BLOCKED / PENDING-external arm because they are genuinely waiting** — for the unblocking
  nudge, or the awaited event. This is the warm path doing its core job.
- **Terminal outcomes (DONE / FAILED) arm only a brief *completion-hold*** — a latency
  optimization so an immediate follow-up lands warm instead of paying a cold resume. This
  single *use* is a removal candidate (dropping it just forces a resume on the next
  follow-up; it does not affect correctness).

The distinction matters for conformance: **the warm-path mechanism itself is REQUIRED** (§8
mandates both implementations exist) — what is optional is only the completion-hold *use* of
it on terminal outcomes. A dispatcher may drop the completion-hold and still conform; it may
not drop the warm path.

### 8.2 The failsafe

A node with no live warm path — PENDING-internal, or any node whose long poll has lapsed — is
covered by a **no-activity timeout (≈60 min) that re-fires the sentinel over the durable
(resume) path.** Because re-firing a sentinel is always safe, this *single* mechanism recovers
every stall uniformly: a self-wake that never fired, a crashed node, and a missing or garbled
sentinel alike — with no per-case handling. A node that cannot be revived at all is resolved
to FAILED by the dispatcher's ultimate backstop (the bound is implementation-defined).

### 8.3 Delivery selector

Delivering a bubbled event is then a single decision: **"is a live warm receive held? →
inject : resume."** The contract requires the *behaviour* (a bubbled event reaches its target
regardless of liveness); the transport mechanics are implementation.

## 9. Scope boundary — sentinel accuracy vs epistemics

Two things about the sentinel are on different sides of the line:

- **In scope (here):** the sentinel's *transport and consequence*, **and its accuracy** —
  refining the sentinel prompt so a node reliably picks the *right* one of the five outcomes.
  A node that mislabels its own state is a comms failure, so making self-classification
  reliable is part of this redesign.
- **Out of scope ([LIN-898]):** the deeper *honesty* question — whether a well-formed `DONE:`
  is substantively *earned* (ledger strictness, verification depth). That is judgment quality,
  not classification.

A **false DONE** — well-formed, correctly transported, but untrue — is the single misreport
this contract cannot catch. It is an accepted backstop because a DONE **always bubbles** (§5):
a wrong DONE still surfaces to the parent, which is the recovery hook, and we have not
observed one in practice.

## 10. Conformance checklist

A dispatcher conforms to this protocol when:

- [ ] Every stop resolves to exactly one outcome (§2); a node is never assumed DONE without a
      sentinel that says so (§4).
- [ ] `PENDING:` is split by evidence-first, ask-second classification (§4).
- [ ] The warm receive (stop-hook long poll) is armed on every stop **except**
      PENDING-internal; a ≈60-min no-activity failsafe re-fires the sentinel over resume (§8).
- [ ] PENDING-internal never wakes the parent; PENDING-external wakes only on an
      `everything` edge (§5, §8).
- [ ] DONE, FAILED, and BLOCKED always bubble (§5).
- [ ] Each edge carries an explicit `subscription` enum, not a reconstructed boolean (§6).
- [ ] A node can address only its parent; multi-level is re-originated per hop (§7).
- [ ] Both notification implementations exist and the live-vs-resume delivery selector is a
      single deterministic decision (§8).

---

## Appendix A — non-normative: where this lands in the current code

Orientation only; not part of the contract.

- **Harbour marker regexes** (`lib/dispatch-terminal.js`): today `WAKE_FEEDBACK_REGEX`
  treats `[pending]` as uniformly wake-worthy. Step 1 makes wake a function of
  *marker-type × subscription-level* (§3, §5), so PENDING-internal stops waking.
- **Harbour wake seam** (`lib/dispatch-wake.js`, `lib/dispatch-store.js addFeedback`): the
  `subscribe===true` boolean gate becomes the `subscription` enum (§6).
- **Harbour long-poll** (`routes/proxy.js`, `GET /api/proxy/dispatch/:id?wait=N`) is the warm
  path of §8; resume is the durable path.
- **Simple Dispatcher sentinel** (`hook.js parseCompletionSentinel`, `outstandingAsyncWait`)
  is §2/§4; `shouldHoldForFollowUp` is the PENDING-external hold; `followup.js
  resolveFollowUpTarget` (signal vs resume vs reject) is the §8 selector.
- **Phase enum** (`phases.js`) collapses after the SDK/dash substrate removal (13 → ~7),
  independent of but sequenced ahead of the §2 tightening in Step 2.
