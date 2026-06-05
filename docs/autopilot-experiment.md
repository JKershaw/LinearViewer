# Autopilot — Experiment 1: Dispatch → Runner → Feedback

## Status

Experiment plan + results for the first end-to-end spike of the Autopilot loop (see
[`autopilot.md`](./autopilot.md) for the design and invariants). Written before running so
the question, the stages, and the success criteria were fixed in advance; the **Results**
section records what actually happened.

**Checkpoint (2026-06-05):** the dispatch API surface is built, deployed, and exercised across
three live runs. Key result: the loop works, but completion must be judged from external evidence
(Linear/git/PR) — the feedback channel is liveness, not result. Open work is consumer telemetry
(terminal/heartbeat/failure events; hooks surviving remote-control handoff) before an autonomous
orchestrator can drive it. Continuation tracked in Linear as **LIN-318** (In Progress).

## The question we are answering

Can we dispatch a real task's prompt, have the separate runner execute it as a Claude Code
session, and watch meaningful feedback come back — well enough that an orchestrator could do
this on repeat? The single most valuable thing to learn: **what does the feedback actually
look like, and is it enough for a judge to decide "done" without re-reading everything?**
(That directly feeds the evidence/trust caveat and the shape of the dispatch "watch" verb.)

## Standing facts (so this is self-contained post-compaction)

- Proxy base URL: `https://projects.jkershaw.com/api/proxy` — a `readWrite` proxy token is
  provided in-session (not committed here).
- The existing user-facing enqueue is `POST /workspace/:urlKey/api/dispatch`, body
  `{ prompt, promptName?, issueId?, issueIdentifier?, issueTitle?, issueUrl?, target?, repo? }`,
  `target ∈ {cli, web, dash, local}` (default `cli`). `local` = Harbour, localhost-only.
- The runner already exists: a **separate system** consumes the dispatch queue and runs
  Claude Code as a local CLI or via web remote-control. It posts feedback via
  `POST /api/dispatch/feedback/:itemId` (`{ message, url?, urlLabel? }`) — feedback is a
  free-form string by design.
- The proxy API now exposes the dispatch verb pair (built for Stage B):
  - `POST /api/proxy/dispatch` (readWrite) — enqueue; same body as the UI endpoint, minus
    `target: local`. Returns `{ id, status: "queued", ... }`.
  - `GET /api/proxy/dispatch/:id` (read) — watch; returns `{ id, status, feedback: [...], ... }`,
    resolving across the live queue and the taken/feedback history. Feedback stays free-form.
  - Plus `GET /api/proxy/dispatch` (list, filter by `issueIdentifier`/`status`) and auto-appended
    proxy context on enqueue. Discoverable via `/api/proxy/instructions`; E2E in `tests/e2e/proxy.spec.js`.
  - **Deployed** to production and exercised live (no longer a deploy gap).

## Stage A — plumbing spike (zero build, run first)

Goal: validate the runner + feedback leg and capture the real feedback shape. No code.

1. Pick **one low-blast-radius task** — ideally a Linear-only update, or a small contained
   code change that produces a **PR we review** (never auto-merge). Keeps the
   human-at-the-edge invariant intact during the test.
2. Generate its prompt via the existing `/recommend/{identifier}`, or hand-write it.
3. Dispatch via the existing UI with `target: cli` (or `web`).
4. Watch the runner consume it and the feedback return.

Learns: does a real task run cleanly end-to-end? what shape/quality is the feedback? does it
carry enough (PR link? test result?) for a judge to verify completion, or only a prose
"done"?

## Stage B — orchestrator spike (small build)

Goal: can a Claude orchestrator drive the loop via the API?

**Build (small):** add a proxy-token-authed dispatch pair — a thin wrapper over the existing
store, swapping session auth for the proxy token:

```
POST /api/proxy/dispatch        (readWrite scope)
  Body: { prompt, promptName?, issueId?, issueIdentifier?, issueTitle?,
          issueUrl?, target?="cli", repo? }   ← same shape as the UI endpoint
  → { id, status: "queued" }

GET  /api/proxy/dispatch/:id    (read scope)   ← the watch half (do not skip)
  → { id, status: "queued"|"taken"|"done", feedback: [{ message, url, createdAt }] }
```

Reuses `dispatchQueueStore.addItem` and the history read; the only new logic is the
proxy-token auth boundary and the read projection. `target: local`/Harbour is out of scope.

**Draft autopilot prompt** (pasted into a Claude session) that references the above:
orient → `/recommend` → dispatch via `POST /api/proxy/dispatch` → poll
`GET /api/proxy/dispatch/:id` for feedback → emit a one-line external recap → decide
(continue / complete / help). Completion must be confirmed against a real check / PR, not a
prose claim.

Learns: can the orchestrator actually drive it? where does it get confused, over-trust, or
stall? does the poll/watch verb return enough to decide?

## Experiment hygiene

- **Task choice:** low blast radius; Linear-only or PR-reviewed; no auto-merge.
- **Success criteria (fixed up front):**
  1. the prompt ran without manual rescue;
  2. the change/output was actually correct on human inspection;
  3. the feedback was sufficient to *decide* the next step without re-reading everything.
- **Capture the intervention:** if a human has to step in, record *why* — that is the
  gold-label signal for the trust model, in miniature.

## Sequencing

Run **Stage A first** (free, today). It answers the feedback-shape question that Stage B's
watch verb and the evidence discipline both depend on. Then build the `POST /api/proxy/dispatch`
(+ read) pair and run Stage B from what the real feedback looks like.

---

## Results / observations

*(to be filled in after the run — capture: did it run clean, feedback shape/quality, any
setup or tweak needed, where a human intervened and why, and what it implies for the design.)*

### Stage A

**Captured from the live LIN-288 run (item `58f96bed…`, dispatched 2026-06-05 18:57, target `web`).**

- **The loop physically worked.** The dispatched worker did the research task end-to-end: set
  LIN-288 → In Progress, investigated, and at **19:02:43 posted a findings comment** + updated the
  description, correctly keeping the `bug` label. The execution path is sound.
- **But the dispatch feedback channel did NOT carry the result.** The 5 feedback entries are all
  runner *lifecycle narration* from the first ~30s ("Starting…", "Prompt: ```# Investigate
  LIN-288…", "Sending /remote-control command…") — process telemetry, not result telemetry. They
  end at 18:58:19; the actual deliverable landed in Linear ~4.5 min later (19:02:43) and was
  **never posted to the feedback channel.**
- **Therefore completion is judged from external evidence, full stop.** Not as a trust nicety —
  the self-report channel literally doesn't contain the result. The orchestrator/judge has to read
  Linear state (new comment, status change) / git / PR to know the task is done. This is invariant
  2 confirmed empirically, and stronger than expected: watching the dispatch item's feedback ≠
  watching the work.
- **Architecture implied:** the runner posts *launch* lifecycle to the dispatch feedback, then
  hands the real work to a remote-control session that writes its results into **Linear** (via the
  proxy), decoupled from the dispatch item. So the autopilot watches *outcomes in Linear/git*, not
  the feedback stream.
- The "Summarising project in linearviewer" / "Summarise this project briefly" entries are the
  runner's **expected launcher preamble** (confirmed), not cross-prompt bleed.

**Net for the design:** the auto-appended Linear access is what made the result observable (it
landed in Linear). The "end with an evidence-rich summary" line only helps if the Stop hook is
later changed to forward the worker's final message — today it forwards launch narration, not the
summary. The judge reads Linear/git/PR regardless.

### Stage A (cont.) — consumer-improvement run, 2026-06-05 later

After the first run we wrote a **dispatch-consumer punch-list** (below). The runner was improved
and we re-ran. Two more dispatches, both via the new `POST /api/proxy/dispatch`:

- **Run 2 — LIN-288 planning task → `web` (item `cfa2eb90…`).** Improvements visible immediately:
  phase tags `[started]`/`[working]`, prompt **reference** instead of a full dump (`(2016 chars)`),
  session id + tty. But it then **stalled silently** after `remote-control slow to connect — sending
  prompt anyway` → `Remote connected. Executing task…`, and ~18 min later nothing had reached the
  feedback channel **or** Linear.
- **Root cause (operator):** *hooks stop firing once a session hands off to remote control.* So on
  the `web`/remote path the **Stop hook can't post the terminal event** — structurally, not a bug in
  our watch verb. Both `web` runs therefore showed launcher narration and then went dark, even when
  the underlying work completed.
- **Run 3 — read-only retro → `cli` (item `cb9917e2…`), to test the hook hypothesis on a path that
  keeps hooks alive.** It launched (`[started]` + `[working] Session launched`) and then **froze at
  launch** — operator's laptop went to sleep right after spawn. Same silent-freeze signature as a
  stall.

**Combined finding:** a stalled run, a remote-handoff that drops the tail, and a sleeping laptop all
produce the **identical silent freeze** on the channel. Today nothing distinguishes "working" from
"dead" without manually checking Linear/git. That makes the punch-list's **terminal event (#1),
heartbeat (#2), and failure report (#6)** the load-bearing changes — and confirms the orchestrator
must treat **external evidence (Linear/git/PR) as the source of truth** for completion, with the
feedback stream as liveness only.

### Dispatch-consumer punch-list (for the runner, ranked by leverage)

1. **Terminal completion event** — on stop, post `[done]`/`[failed]`/`[aborted]` + final summary +
   an **evidence URL** (Linear comment / PR / commit). The single highest-value change. *(Blocked on
   the remote-control path until hooks survive handoff — see below.)*
2. **Liveness heartbeats** during the work window, so a hung/asleep session is distinguishable from a
   working one in ~1 min instead of never.
3. **Stop echoing the full prompt** — a short reference is enough. ✅ done in the improved runner.
4. **Forward `dispatchId` → `/api/proxy/foreman/status`** so work joins to the exact dispatch attempt
   (foreman channel is empty today).
5. **Populate `url`/`urlLabel`** with the concrete artifact (all `null` today).
6. **Explicit failure reporting** — stalls/disconnects/errors should be loud, not silent.
7. **Hooks survive remote-control handoff** (newly found) — without this, #1 is impossible on `web`.
   Either keep the Stop hook alive across the handoff, or have the launcher (not the remote session)
   own the terminal post.

### Stage B — orchestrator spike

- **Partially exercised manually:** the human-as-orchestrator loop now runs over the API —
  `POST /api/proxy/dispatch` (with auto-appended proxy context) → `GET /api/proxy/dispatch/:id` +
  `GET /api/proxy/dispatch?issueIdentifier=…` to watch → cross-check the outcome in Linear. That
  round-trip works.
- **Not yet done:** an actual Claude *orchestrator* prompt driving the loop unattended (dispatch →
  detect completion via Linear evidence → recap → decide next). Blocked less by the API than by the
  consumer telemetry gaps above — without a terminal/heartbeat signal, an autonomous orchestrator
  can't reliably tell when to advance.

### Endpoints / changes shipped on this branch

- `POST /api/proxy/dispatch` (enqueue) + `GET /api/proxy/dispatch/:id` (watch) + `GET /api/proxy/dispatch`
  (list, filter by `issueIdentifier`/`status`).
- Auto-append proxy context to dispatched prompts (Linear access; reporting left to the runner's Stop
  hook). Standing readWrite token **for now**, flagged in-code as security debt. Fixed a malformed-URL
  bug for dispatches without an `issueIdentifier`.
- All covered by E2E tests in `tests/e2e/proxy.spec.js` (11 dispatch tests).
