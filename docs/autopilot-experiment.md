# Autopilot — Experiment 1: Dispatch → Runner → Feedback

## Status

Experiment plan + results for the first end-to-end spike of the Autopilot loop (see
[`autopilot.md`](./autopilot.md) for the design and invariants). Written before running so
the question, the stages, and the success criteria were fixed in advance; the **Results**
section records what actually happened.

**Checkpoint (2026-06-06):** the dispatch API surface is built, deployed, and exercised across
**seven** live runs. Key result: the loop works, but completion must be judged from external evidence
(Linear/git/PR) — the feedback channel is liveness, not result. **Run 4 (clean `cli` retro)** was
decisive: a session that completed normally **still failed to post its terminal event**, proving the
gap is the **terminal-event delivery itself** — so the **launcher/consumer process must own the
terminal post**, not a Stop hook inside the session. **Runs 5–6** verified launcher-owned `[done]` on
both `cli` and `web`; **Run 7** added the session's **final recap** on the channel (`cli`, as
`(recap N/M)` entries before `[done]`) and **explicit `[failed]` reporting**. Two things now block an
autonomous orchestrator: the **`web` remote-control connect has regressed** (`command not accepted`,
failed twice) so `web` work and recap-on-`web` are down, and the channel still lacks **heartbeats** and
an **evidence URL**. Continuation tracked in Linear as **LIN-318** (In Progress).

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
  stall. Inconclusive (laptop sleep, not a clean test).
- **Run 4 — read-only retro → `cli` (item `df85e338…`, 2026-06-06 07:14, laptop awake), the clean
  re-run of #3.** Launched the same way (`[started]` + `[working] Session launched`, session
  `e629d2d7`, tty `/dev/ttys002`) and then sat at `feedbackCount=2` for ~11+ min. Operator then
  confirmed out-of-band: **the session actually concluded and produced its findings — but the
  terminal event never reached the feedback channel.** This is the decisive result.

**Decisive finding (Run 4):** the silent freeze is **not** unique to the `web`/remote-control
handoff, and it is **not** "still working." A `cli` session that completed normally — the path
where hooks were assumed to survive — **still failed to post its terminal event.** So:

- The "hooks die on remote-control handoff" story (Run 2) is *a* cause but **not the whole cause** —
  the terminal post is missing on the plain `cli` path too. The terminal-event delivery is the gap,
  independent of the handoff.
- This **promotes punch-list #7's second option to the answer:** the **launcher (the dispatch
  consumer process itself) must own the terminal post**, observing the child session's completion —
  *not* a Stop hook running inside the session, on either path. Keeping hooks alive across handoff is
  necessary-at-most for `web` and provably insufficient for `cli`.
- A stalled run, a dropped remote tail, a sleeping laptop, **and a cleanly-completed cli session** all
  produce the **identical silent freeze**. Nothing on the channel distinguishes working / done / dead.
  Here external evidence couldn't break the tie either (read-only task → Linear/git silent by design),
  so only the operator's direct observation of the session revealed completion.

This makes **terminal event (#1)**, **heartbeat (#2)**, and **failure report (#6)** load-bearing, and
re-roots #1 in the **launcher**, not the session hook. The orchestrator must treat **external evidence
(Linear/git/PR) as the source of truth** for completion, with the feedback stream as liveness only.
*(Operator is debugging the dispatch consumer to add the launcher-owned terminal post.)*

- **Run 5 — read-only retro → `cli` (item `d1b3ac08…`, 2026-06-06 07:42), regression after the fix.**
  The launcher-owned terminal post landed. **First time a dispatched session has ever posted a
  terminal event to the channel:**
  ```
  #1 07:42:40  [started] Summarising project… (1074 chars)
  #2 07:42:40  [working] Session launched (session 5339070c, tty /dev/ttys003)
  #3 07:42:53  [working] Summary complete. Executing task...
  #4 07:43:24  [done] Task completed in 45s          ← NEW terminal event
  ```
  Completion detection on the feedback stream now **closes** on `cli`. Punch-list #1 (terminal event)
  is delivered by the launcher, confirming the Run-4 diagnosis. Two refinements remain:
  1. The `[done]` carries **duration but no final summary and no evidence URL** (`url`/`urlLabel`
     still `null`). The orchestrator can now detect *that* it finished, but not read *what* was done
     from the channel — for real tasks it still goes to Linear/git/PR. #1's full ask (marker +
     summary + evidence URL) is partially met.
  2. The item's top-level **`status` stays `taken`** — the terminal signal lives only in the feedback
     *text* (`[done]`). An orchestrator must parse the latest `[done]`/`[failed]` marker rather than
     rely on `status` flipping. Open question: should the watch endpoint transition `status` on a
     terminal feedback event?
  `web` is expected to benefit from the same launcher-owned post (the launcher observes child exit
  regardless of path) but is **not yet re-verified**.

- **Run 6 — read-only retro → `web` (item `c32bd6c0…`, 2026-06-06 08:13), the `web` re-verification.**
  *(A first attempt, `e17e6bd6…`, surfaced a separate bug — the dispatcher logged `Sending
  /remote-control command...` but never actually fired it, so the session never moved cli→web; that
  run was aborted and the operator fixed the trigger.)* The retry cleared the full handoff — including
  the exact point Run 2 went dark — and landed a terminal event:
  ```
  #3 08:13:25  [working] Summary complete. Connecting remote session...
  #4 08:13:27  [working] Sending /remote-control command...
  #5 08:13:33  [working] Remote connected. Executing task...     ← cleared the Run-2 stall point
  #6 08:14:30  [done] Task completed in 1m 26s                   ← terminal event on web
  ```
  **Two fixes confirmed at once:** the remote-control trigger now actually connects (`Remote
  connected`), and the **launcher-owned terminal post is path-independent** — `[done]` lands on `web`
  exactly as on `cli`. Completion-detection now **closes on both targets.** The same two refinements
  carry over (no final summary / evidence URL; `status` stays `taken`).

- **Run 7 — recap forwarding + failure reporting, dispatched to both targets, 2026-06-06 ~08:38 and
  ~09:57.** Goal: get the **session's final recap** onto the channel (refinement #1), not just a bare
  `[done]`.
  - **First attempt** forwarded session text but the **wrong message** — the session's *opening*
    orientation line ("Let me look at the current branch's work…"), as a separate entry after a bare
    `[done]`. The actual findings still weren't on the channel.
  - **After the fix, `cli` (item `73d09670…`) is excellent.** The session's **actual final
    retrospective** now lands as `(recap 1/2)` + `(recap 2/2)` entries immediately *before* `[done]` —
    a real descriptive recap with *what was done*, *what stands out*, and an **Evidence** section
    (branch, HEAD commit, latest merged PR), even flagging 55 uncommitted screenshot baselines as
    drift. This is exactly the watchable recap refinement #1 wanted.
  - **`web` (items `267c1710…`, `21d79ed6…`) failed both times** at the cli→web handoff:
    `[failed] remote-control never connected (command not accepted)` — the **identical error twice**,
    so the remote-control trigger has **regressed since Run 6** (broken, not flaky). The local half
    works (the launcher forwarded its project-overview before failing); recap-on-`web` is therefore
    **still unverified**.
  - **Win regardless:** this is the first time **explicit failure reporting (#6)** appeared — a
    terminal `[failed]` *with a reason*, instead of the silent freeze every earlier broken run
    produced. A flaky path that fails *loudly* is safe for an autonomous orchestrator (retry/escalate)
    in a way a silent one never is.
  - **Note (context economy):** the full recap is two chunks of detailed prose. Great for the
    human-watchable channel, but per §6 of `autopilot.md` the *light orchestrator* should treat it as
    **drill-down**, not steady-state context — hold the `[done]`/`kind`/evidence-pointer header, fetch
    the recap only when a decision needs it.

### Dispatch-consumer punch-list (for the runner, ranked by leverage)

1. **Terminal completion event** — on stop, post `[done]`/`[failed]`/`[aborted]` + final summary +
   an **evidence URL** (Linear comment / PR / commit). The single highest-value change. **Must be
   owned by the launcher/consumer process, not a Stop hook inside the session** — Run 4 proved a
   cleanly-completed `cli` session still fails to post a hook-based terminal event (see below).
   ◐ **Mostly done (Runs 5–7):** the launcher posts `[done]` on **both `cli` and `web`**, and (Run 7)
   the session's **final recap** now lands on `cli` as `(recap 1/2)`+`(recap 2/2)` entries before
   `[done]`. Remaining: the recap is **not yet verified on `web`** (blocked by the remote-control
   regression, below); the **evidence URL** is still unpopulated (`url`/`urlLabel` null); and the item
   `status` does not transition on the terminal event (signal is feedback-text-only). Open question:
   fold the recap into the `[done]` payload vs. keep it as adjacent `(recap N/M)` entries.
2. **Liveness heartbeats** during the work window, so a hung/asleep session is distinguishable from a
   working one in ~1 min instead of never.
3. **Stop echoing the full prompt** — a short reference is enough. ✅ done in the improved runner.
4. **Forward `dispatchId` → `/api/proxy/foreman/status`** so work joins to the exact dispatch attempt
   (foreman channel is empty today).
5. **Populate `url`/`urlLabel`** with the concrete artifact (all `null` today).
6. **Explicit failure reporting** — stalls/disconnects/errors should be loud, not silent. ✅ done
   (Run 7): a terminal `[failed] … (reason)` now appears instead of a silent freeze.
7. **Launcher owns the terminal post** (resolved by Run 4) — the original framing was "keep the Stop
   hook alive across the handoff, *or* have the launcher own the terminal post." Run 4 settled it: a
   cleanly-completed `cli` session (hooks supposedly alive) **still** didn't post, so the hook path is
   insufficient on *both* targets. The launcher/consumer process must observe child completion and
   post the terminal event itself. This is the prerequisite for #1.
8. **`web` remote-control connect regression** (Run 7, newly found) — `command not accepted`, failing
   twice consecutively where Run 6 connected. Currently blocks all `web`-target work (and the
   recap-on-`web` verification). Highest-priority bug for the `web` path.

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
