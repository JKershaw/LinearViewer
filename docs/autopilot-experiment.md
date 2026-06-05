# Autopilot — Experiment 1: Dispatch → Runner → Feedback

## Status

Experiment plan for the first end-to-end spike of the Autopilot loop (see
[`autopilot.md`](./autopilot.md) for the design and invariants). Written before running so
the question, the stages, and the success criteria are fixed in advance. The **Results**
section at the bottom is filled in *after* the run — expect setup friction and tweaks.

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
  - Discoverable via `/api/proxy/instructions`. Covered by E2E tests in `tests/e2e/proxy.spec.js`.
  - **Deploy gap:** the proxy runs on production (`projects.jkershaw.com`); this branch isn't live
    there yet, so calling it with the proxy token requires a deploy (merge to `main`) first.

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

- **Reporting/transport is a harness concern, handled by the runner.** The dispatch consumer
  (runner) uses a **Stop hook** that phones home automatically when the Claude session ends — so
  completion telemetry returns without the prompt teaching it. This is cleaner than betting on the
  model remembering to curl an endpoint.
- **Where the report lands:** the Stop hook posts to the dispatch **feedback** channel (history),
  not the foreman channel. So `foreman/sessions|status|tasks` being empty during the LIN-288 run
  did **not** mean "no telemetry" — I just couldn't see the feedback history through the proxy yet
  (no list/read endpoint until this branch deploys). Correction to my first read.
- **Auto-append is about Linear access, not phone-home.** `POST /api/proxy/dispatch` appends a
  proxy-context block to the prompt by default (`appendProxyContext:false` to opt out): base URL +
  token + a pointer to `/instructions`, giving the worker the rich Linear access that the old local
  MCP used to provide. It does **not** instruct the worker to report (the Stop hook owns that). It
  only asks the worker to END with an evidence-rich summary (PR/commit/CI) so whatever the hook
  forwards carries proof, not a bare "done".
  - Token: **standing readWrite for now** (explicit choice) — flagged in-code as security debt;
    planned hardening is a per-item, short-TTL, narrowly-scoped token (mirrors Harbour's).
- **Watch ergonomics:** added `GET /api/proxy/dispatch` (list, filter by `issueIdentifier`/`status`)
  so the orchestrator can find its own item by issue, and `GET /api/proxy/dispatch/:id` to read the
  status + feedback the Stop hook posted.
- **Open question for tuning:** does the Stop hook forward the session's final summary, or just a
  static "session ended" signal? If the former, the evidence-summary instruction is load-bearing
  (it shapes the payload); if the latter, evidence has to come from the orchestrator's own CI/PR
  lookups. Either way the trust caveat holds: a worker/hook self-reporting "done" is still
  self-report (invariant 2 / LIN-292) — the judge weights external CI/PR/diff over the claim.

### Stage B

- _pending_
