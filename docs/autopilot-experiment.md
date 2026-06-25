# Autopilot — Experiment 1: Dispatch → Runner → Feedback

## Status

Experiment plan + results for the first end-to-end spike of the Autopilot loop (see
[`autopilot.md`](./autopilot.md) for the design and invariants). Written before running so
the question, the stages, and the success criteria were fixed in advance; the **Results**
section records what actually happened.

**Checkpoint (2026-06-06):** the dispatch API surface is built, deployed, and exercised across
**ten** live runs. Key result: the loop works, but completion must be judged from external evidence
(Linear/git/PR) — the feedback channel is liveness, not result. **Run 4 (clean `cli` retro)** was
decisive: a session that completed normally **still failed to post its terminal event**, proving the
gap is the **terminal-event delivery itself** — so the **launcher/consumer process must own the
terminal post**, not a Stop hook inside the session. **Runs 5–6** verified launcher-owned `[done]` on
both `cli` and `web`; **Run 7** added the session's **final recap** (`cli`) and **explicit `[failed]`
reporting**; **Run 8** fixed a `web` remote-control regression and verified the **recap on `web`** too.
The channel now reliably carries, on **both targets**: phase tags → recap → **structured `[evidence]`
entries (populated `url`)** → terminal `[done]`/`[failed]`, and the watch/list endpoints surface a
derived terminal **`status`** (verified flipping `taken → done` live in Run 9). An orchestrator can
poll a status field and read structured evidence pointers without parsing prose — invariant-2's
evidence discipline made mechanical. As of **Run 10** the last telemetry gap (liveness heartbeats #2)
is closed: 30s adaptive beats carrying tool-activity now cover the work window. **All telemetry
punch-list items are done** (only #4, the optional `dispatchId`→foreman join for loop-reconstruction,
remains). **Stage B has now been driven across three runs (B1–B3, below)** against the guide in
[`autopilot-orchestrator-prompt.md`](./autopilot-orchestrator-prompt.md): **B1** — a clean read-only
drive (orient → dispatch → poll-`status` → cross-check-evidence → recap → decide) with no manual
rescue; **B2** — the first write-class attempt, **halted on a `/recommend` 504**, which exposed (and
corrected) an orchestrator anti-pattern — *silently working around an infra error* — now a first-class
**halt rule** in the guide; **B3** — a clean re-run where `/recommend` recovered, correctly routed the
fresh ticket to **`kind=planning`**, and the plan landed + was verified in Linear. The arc was
deliberately stopped at B3's verified plan when `/recommend` 504'd again (the halt rule firing as
designed). Three durable findings: (1) **halt on infra errors, don't improvise around them**;
(2) **`/recommend` is an intermittently-flaky hard dependency** (Linear context-fetch 504s, twice this
session — a real reliability risk for an autonomous loop, candidate for hardening); (3) the
**merge-to-main write path is still unexercised end-to-end** (no run has reached PR→CI→merge). Two
build-spec gaps from B1 stand: no periodical-cadence source (precedence rule 2 inoperable) and no
structured `kind` on dispatch — the latter is now ticketed as **LIN-319** (planned + implemented
locally, uncommitted). Continuation tracked in Linear as **LIN-318** (In Progress).

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
  `target ∈ {cli, web, dash, local}` (default `cli`). `local` = Harbour OS, localhost-only.
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
proxy-token auth boundary and the read projection. `target: local`/Harbour OS is out of scope.

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

- **Run 8 — read-only retro → `web` (item `8f069f45…`, 2026-06-06 10:15), the remote-control fix.**
  Full success on `web` end-to-end:
  ```
  #3 10:15:27  [working] Summary complete. Executing task...   ← no "command not accepted"; handoff clean
  #4           [launcher project-overview preamble]
  #5 10:16:10  (recap 1/2)  ## Retrospective — Harbour recent activity …
  #6 10:16:10  (recap 2/2)  …### Evidence • Latest CI on main: success — run 27042794260 …
  #7 10:16:10  [done] Task completed in 1m 1s
  ```
  - **Remote-control regression (#8) resolved** — executed end-to-end. The intermediate
    `Connecting / Sending /remote-control / Remote connected` entries are now **gone**; the handoff
    goes straight to `Executing task...` like `cli`, so the fix also streamlined it.
  - **Recap now verified on `web`** — full retrospective (`recap 1/2`+`2/2`) before `[done]`, so recap
    forwarding works on **both targets**. The `web` recap was even richer than `cli`'s: it carried an
    **evidence URL** (a real GitHub Actions link) in its Evidence section and flagged that the branch
    is stale vs `main` with *no open PR* and ~70 uncommitted screenshot PNGs.
  - **Caveat — evidence URL is in prose, not the field.** The link lives in the recap *text*; the
    feedback entry's structured `url`/`urlLabel` is still `null`. So #5 (populate the structured
    artifact field) is **not** done — an orchestrator must parse the URL out of the recap rather than
    read a field.

- **Run 9 — read-only retro → `cli`+`web` (items `c6f0ab5e…`, `10e2d5ae…`, 2026-06-06 11:15),
  post-deploy verification of the status-transition change + the updated consumer.** Three things
  landed at once:
  - **Status transition (#9) verified live on both paths.** The top-level `status` field flipped on
    its own: `taken → done` (`cli` 11:16:46, `web` 11:17:02). The orchestrator polls a field now, not
    prose.
  - **Structured evidence URL (#5) done — and richer than asked.** The consumer now posts dedicated
    `[evidence]` entries with populated `url` fields, and the `[done]` carries a primary artifact URL:
    `cli` surfaced the Linear issues it read (`…/issue/LIN-288`, `-300`, `-301`, `-299`, `-302`);
    `web` found git/CI artifacts (`…/pull/286`, three `…/actions/runs/…`). It extracts *every* artifact
    mentioned in the recap, dedupes with `· N mentions` counts, and attaches a primary URL to `[done]`.
    This is invariant-2's evidence discipline made mechanical — structured pointers to verify against.
  - **Heartbeats (#2) still the one gap.** Both runs went `Executing task...` → ~36s silence → recap
    burst, with no intermediate entry. Didn't bite (55–57s tasks), but a long run would still look
    frozen mid-flight.

- **Run 10 — read-only retro → `cli` (item `c9b5b4f6…`, 2026-06-06 11:32), heartbeat verification
  (timer reduced 2m → 30s).** The silent work window is now covered, and the beats carry *activity*,
  not just liveness:
  ```
  #5 11:32:45        [working] no tool calls in 20s · 0 total · next heartbeat in ≤30s
  #6 11:33:16 (+32s) [working · running] 6 tools in 32s: Bash×6 · 6 total · next heartbeat in ≤1m
  ```
  - A beat fired ~32s into the work window (consistent with the 30s timer) — the exact gap that made
    "working vs dead" indistinguishable in Runs 1–9 is now filled.
  - Each beat is a **progress** signal: tool count + breakdown (`6 tools in 32s: Bash×6`) and an
    idle/running substate (`no tool calls in 20s` vs `· running`), so an orchestrator can tell
    *working* from *stuck*, not just *alive*.
  - **Adaptive cadence** — `≤30s` then `≤1m`: tight early when liveness matters most, widening later so
    a long task doesn't flood the channel. (Append entries rather than a coalesced timestamp, but the
    backoff keeps accumulation bounded.)
  - **This closes #2 — the last telemetry gap.**

### Dispatch-consumer punch-list (for the runner, ranked by leverage)

1. **Terminal completion event** — on stop, post `[done]`/`[failed]`/`[aborted]` + final summary +
   an **evidence URL** (Linear comment / PR / commit). The single highest-value change. **Must be
   owned by the launcher/consumer process, not a Stop hook inside the session** — Run 4 proved a
   cleanly-completed `cli` session still fails to post a hook-based terminal event (see below).
   ✅ **done (Runs 5–9):** the launcher posts `[done]` on **both `cli` and `web`**, with the session's
   **final recap** (`(recap N/M)` entries) and, as of Run 9, **structured `[evidence]` entries +
   a primary evidence URL on `[done]`** (see #5).
2. **Liveness heartbeats** during the work window, so a hung/asleep session is distinguishable from a
   working one in ~1 min instead of never. ✅ **done (Run 10):** the timer was cut 2m → 30s and the
   beats carry activity telemetry (tool count + breakdown, idle/running substate) with an **adaptive
   cadence** (`≤30s` widening to `≤1m`). The previously-silent work window is now covered; this was the
   last telemetry gap.
3. **Stop echoing the full prompt** — a short reference is enough. ✅ done in the improved runner.
4. **Forward `dispatchId` → `/api/proxy/foreman/status`** so work joins to the exact dispatch attempt
   (foreman channel is empty today).
5. **Populate `url`/`urlLabel`** with the concrete artifact. ✅ **done (Run 9):** the consumer posts
   dedicated `[evidence]` entries with populated `url` (Linear issues on `cli`; PR + CI runs on `web`),
   extracts *every* artifact from the recap with `· N mentions` dedup counts, and attaches a primary
   URL to the `[done]` entry itself.
6. **Explicit failure reporting** — stalls/disconnects/errors should be loud, not silent. ✅ done
   (Run 7): a terminal `[failed] … (reason)` now appears instead of a silent freeze.
7. **Launcher owns the terminal post** (resolved by Run 4) — the original framing was "keep the Stop
   hook alive across the handoff, *or* have the launcher own the terminal post." Run 4 settled it: a
   cleanly-completed `cli` session (hooks supposedly alive) **still** didn't post, so the hook path is
   insufficient on *both* targets. The launcher/consumer process must observe child completion and
   post the terminal event itself. This is the prerequisite for #1.
8. **`web` remote-control connect regression** (Run 7) — `command not accepted`, failed twice. ✅
   **fixed (Run 8):** `web` now executes end-to-end and forwards the recap; the fix also streamlined
   the handoff (no more intermediate connect entries).
9. **Terminal `status` transition on the watch/list endpoints** (our side, not the runner). ✅ **done +
   verified live (Run 9):** `GET /api/proxy/dispatch/:id` and `GET /api/proxy/dispatch` derive a
   terminal `status` (`done`/`failed`/`aborted`) from the runner's `[done]`/`[failed]`/`[aborted]`
   feedback marker, so an orchestrator polls a **field** instead of parsing prose. Derived on read —
   the stored lifecycle status and the feedback stream are untouched; `?status=done` is a valid list
   filter. Run 9 confirmed the field flips `taken → done` in production on both paths.

### Stage B — orchestrator spike

**Run B1 — first end-to-end orchestrator drive (read-only research spike, 2026-06-06 11:48,
item `cf108292…`, target `cli`).** A Claude session adopted the draft orchestrator guide
([`autopilot-orchestrator-prompt.md`](./autopilot-orchestrator-prompt.md)) and drove the full
loop over the proxy API alone — **orient → choose (precedence) → dispatch → poll `status` →
cross-check evidence → recap → decide** — with no manual rescue. What each beat looked like:

- **Orient** off live verbs: `GET /stack` (top = LIN-288 bug, already investigated) +
  `GET /foreman/status` (**empty, `total:0`**). Precedence rule 1 (human instruction = "read-only
  spike") fired and correctly *vetoed* dispatching LIN-288's recommended next step (it writes
  code), choosing a read-only retro instead.
- **Dispatch → watch:** enqueue returned `queued`; the `status` field transitioned
  `queued → taken → done` **on its own** — the orchestrator polled a field, never parsed prose for
  completion. Heartbeats (`[working · running] 6 tools in 32s: Bash×6`) gave live working-vs-stuck
  signal through the 1m 33s work window.
- **Cross-check (invariant 2, the load-bearing step):** the runner posted 8 structured
  `[evidence]` PR URLs + a primary URL on `[done]`. The orchestrator did **not** accept the recap
  prose — it independently fetched GitHub and confirmed PRs #318–325 all exist and are merged
  (2026-06-04→06), and that **no new artifact appeared from this run** (read-only honored). Claim
  corroborated by signal the worker can't author. ✅
- **Decide:** evidence confirms → `complete`; no continue (one-shot), no human-help flag.

**What the spike proves:** the Stage B loop is *viable over the existing API* — orient, dispatch,
terminal-`status` detection, heartbeat liveness, and mechanical evidence cross-check all worked on
the first drive. The telemetry shipped in Runs 1–10 is exactly what made the orchestrator able to
*decide* without re-reading everything. Context economy held: steady-state needed only
`{kind, status, evidence URLs, liveness}`; the 3-chunk recap was pulled as drill-down only for the
cross-check.

**Two concrete gaps it hit (next build-spec items, neither blocking):**
1. **Precedence rule 2 is inoperable today.** `foreman/status` is empty, so "a periodical past its
   cadence" has *no data source* — the orchestrator can only act on rules 1 and 3. This is
   `autopilot.md` §8.C (cadence state) / punch-list #4, now confirmed to bite at the **orient** step,
   not just loop-reconstruction.
2. **No structured `kind` on dispatch.** The orchestrator wants `kind` in the task header (§6) to
   read trajectory; today it must infer it from `promptName`. The dispatch verbs don't carry a
   first-class `kind` field yet.

**One design nuance surfaced:** for a *read-only/research* task the recap **is** the deliverable, so
the evidence cross-check confirms the recap's *cited facts are real* rather than proving an *outcome*
exists. Evidence discipline is sharper for implementation tasks (a diff/PR/CI either exists or
doesn't) than for research ones (corroborate the citations; the judgment of "is this a good retro"
stays human-adjacent). The guide should distinguish the two.

**Run B2 — first write-class drive, halted on infra error (2026-06-06 12:02, LIN-319, target
`cli`).** Plan: dogfood the gap B1 found — a deliberately thin ticket (**LIN-319**, "Dispatch
verbs carry no structured `kind` field", no solution baked in) driven by autopilot to a merged
fix, with merge-to-main authorized (Git makes it reversible; the post-merge deploy is the
verification). What happened and what it taught:

- **`/recommend/LIN-319` returned 504 twice** (a timeout on the recommend path; *root cause later
  investigated* — see "`/recommend` 504 root cause" below — it is the **OpenRouter generation leg**,
  not Linear, despite the Linear-flavoured error text).
- **Orchestrator mistake (corrected by the operator):** I treated the 504 as a fallback trigger and
  hand-authored an implementation prompt to keep going. That is a **silent workaround of an infra
  error**, which violates invariant 1 — the loop must *flag*, not paper over a broken signal. The
  correct behavior is **halt and surface**.
- **Policy now encoded** in [`autopilot-orchestrator-prompt.md`](./autopilot-orchestrator-prompt.md):
  a network error / timeout / 5xx from any verb the orchestrator drives is a **halt condition**, not
  a fallback; a handed-in prompt is *only* a human-supplied kickoff prompt, never a substitute for an
  errored `/recommend`. (Distinct from a clean task-level `[failed]`, which stays a normal retry/escalate
  signal.)
- **Run halted.** The watch loop was stopped. An implementation worker had already been taken on the
  runner (re-grounding — `Read×4`, `Bash`) and may still open a PR on its own branch; the orchestrator
  will **not** verify or merge it. Disposition (let it finish for manual review vs. treat as void) is the
  human's call.

**Net:** B2 didn't reach a merge, but it produced the more valuable result for an *autonomous* loop —
the first real test of the failure boundary, and a sharpened rule: **the orchestrator halts on infra
errors rather than improvising around them.** The merge-to-main write path is still unexercised; the
next attempt should start only once `/recommend` is healthy (or with a human-supplied kickoff prompt by
explicit choice, not as error-recovery).

**Run B3 — clean re-run after the halt fix (2026-06-06 12:13, LIN-319, target `cli`).** The
orchestrator re-drove the loop with the halt rule in force:

- **`/recommend` was transient** — 504 on attempt 1, **200 on attempt 2**. The halt rule was armed
  but didn't need to fire; the retry-then-halt shape behaved correctly.
- **The recommender routed LIN-319 → `kind=planning`, not implementation** ("no implementation plan
  exists; Plan signals unmet"). This is the faithful trajectory — fresh ticket plans first — and a
  quiet vindication that B2's straight-to-implementation hand-prompt was the wrong *shape*, separate
  from B2's halt error. The orchestrator dispatched the recommended plan prompt verbatim.
- **Plan dispatch completed `done` in 3m 40s** with full telemetry (heartbeats → `(recap 1/2)`+`(2/2)`
  → `[evidence]` Linear URL → `[done]`).
- **Cross-check (invariant 2):** independently fetched LIN-319 — `In Progress`, a 5.6k-char plan in
  the description (hybrid strategy scored against 2 alternatives, 7-surface map, "fits one session"),
  and a strategy comment posted. The **plan deliverable is verified.**
- **The tangle the cross-check exposed:** the plan's re-grounding reported the change is **already
  implemented and verified in the working tree** (branch `wardrox/lin-319-dispatch-kind`, 8/8 `kind`
  tests) — i.e. the **residual B2 implementation worker's output**, which finished on the runner after
  the orchestrator halted. So the realised `kind` sequence was **implementation(residual) → planning**,
  *backwards*, purely an artifact of the B2 concurrency, not a converging loop.
- **Evidence discipline reinforced:** that implementation is **uncommitted — no commit/SHA/PR/CI**, so
  there is nothing external to verify. The orchestrator marks it **"claimed, unverified"** and does
  **not** treat it as done; only the plan (real Linear artifacts) is accepted. To become mergeable it
  must first be committed → pushed → PR'd so it carries a SHA + a CI result. **Paused here for a human
  decision** (per the "check before the first code-writing/merge action" guardrail), rather than
  auto-advancing to an implementation/commit step.

**Arc stopped at B3 (2026-06-06 ~12:25).** Asked to continue past the verified plan, the orchestrator
re-queried `/recommend/LIN-319` for the next step and it **504'd three times in a row** — so the halt
rule fired as designed and the run stopped at the verified plan rather than improvising. (The
implementation lives, uncommitted, on a *local* branch on the runner — confirmed not on the remote —
so it remains unverifiable from outside and was left for manual disposition.) Judged a successful arc:
the loop oriented, dispatched, judged from evidence, and **halted itself on infra failure** instead of
papering over it.

**Net (B1→B3):** the loop drives cleanly over the API (B1), halts correctly on infra errors (B2 fix),
and produces faithful `kind` trajectories from `/recommend` (B3). Three durable findings:
1. **Halt on infra errors, don't improvise around them** — now a first-class rule in the guide.
2. **`/recommend` is an intermittently-flaky hard dependency** — it 504'd in *both* B2 and
   B3-continuation, on a tiny fresh ticket. The whole loop's step-choice hangs off it, so this is a
   real reliability risk for autonomous operation. **Root cause (investigated, see note below): the
   OpenRouter LLM-generation leg, not Linear.** **Follow-up candidate:** fix the misattributing error
   message, then harden the LLM leg (retry/cache/faster model/relaxed budget), and give the orchestrator
   a *sanctioned* single retry-after-backoff (not a silent workaround).
3. **The merge-to-main write path was still unexercised end-to-end** as of B3 — no run had reached
   PR → CI → merge → deploy. Muddied further in B3 by an impl-before-plan sequence, self-inflicted by
   letting B2's halted worker keep running: **a clean write-path test needs one worker per ticket and a
   healthy `/recommend`.** *(Closed in **B4**: with both conditions met, the loop drove review → resolve
   → merge → CI-green → deploy → ticket Done.)*

- **Still not done (as of B3; B4 closed the first):** (a) ~~an unexercised **merge-to-main write
  path**~~ — **done in B4**; (b) a genuinely *unattended* multi-step loop (B1–B4 were each supervised,
  with a human reading the external recaps — and B4 needed a human observation to break the
  stale-channel tie); (c) deliberately provoking a task-level `[failed]`/stall to watch the `help`
  branch fire (B2–B4 only exercised the *infra-error* halt and an evidence-contradiction flag, not a
  worker-failure escalation).

**Run B4 — resumed to land the fix, caught a false-positive `[done]` (2026-06-06 ~13:10, LIN-319,
target `cli`).** With the `LLM_TIMEOUT_MS=180s` fix deployed, the orchestrator re-drove LIN-319 to
*land* the implementation that B2/B3 left uncommitted-then-PR'd (by B4's start the work was on a
real PR — **#327**, head `aa1eb62`). The loop ran further than any prior run and produced two
results worth keeping:

- **`/recommend` is healthy post-deploy.** `GET /recommend/LIN-319` returned **HTTP 200 in 55.4s** —
  a generation that would have 504'd under the old 50.5s cap. The timeout split is confirmed effective
  in production. `kind` trajectory across the run: **planning → review → blocked**, converging.
- **Review step, dispatched and cross-checked.** The orchestrator dispatched the recommended
  `kind=review` prompt; the worker posted a verdict to LIN-319 (**"Implementation Approved — blocked
  on a merge conflict in `docs/autopilot.md`"**). The orchestrator did **not** take the verdict on
  prose — it independently confirmed `mergeable_state: "dirty"` via the GitHub API. Both signals
  agreed: source auto-merges clean, only the doc conflicts (`main` commit `f1995d1` edited the same
  §6 region).
- **Orchestrator deviation (deliberate, recorded):** the `/recommend` resolution prompt told the
  *worker* to rebase, resolve, **and merge + set Done** itself. The orchestrator moved the merge gate
  off the worker — dispatched a resolve+verify+**push-then-stop** prompt — so the human-authorized
  merge stays a verified orchestrator action rather than a worker self-certifying its own completion
  (invariant 2 at the finish line). The recommended rebase/verification guidance was kept verbatim;
  only the merge gate moved.

- **The decisive finding — `[done]` is a session-end marker, not a task-completion marker, and it can
  race ahead of the work.** The resolution dispatch posted a terminal `[done]` at **12m 28s**, but
  external evidence **refuted** it: PR #327's head SHA was **unchanged** (`aa1eb62`, no force-push),
  `mergeable_state` still `dirty`, and **no new LIN-319 comment**. The worker's last substantive
  message was *"the full E2E suite is running in the background … I'll continue once it completes and
  report."* Read together: **the worker backgrounded the 733-test suite, the launcher's terminal post
  fired at the session boundary, but the suite hadn't finished — so at the moment `[done]` posted, the
  push + comment had not happened.** The work *did* land later: the worker force-pushed the rebased
  branch (head `aa1eb62`→`e17652`) and posted its resolution comment to LIN-319 **~6 min after `[done]`
  (13:39 vs. the 13:33-ish terminal)** — but **the dispatch feedback channel never updated** to reflect
  it (still 16 events, last = `[done]`). So the terminal marker was not just premature; the channel
  went terminal and stayed **permanently stale** relative to the work that completed after it.
  - This is a new failure mode distinct from the Stage-A *silent freeze*: here the channel *did* post
    a clean terminal event, but it was a **false-positive completion**. The launcher-owned `[done]`
    (the Run-5 fix) answers "did the session stop?" — **not** "did the task succeed?" When a worker
    offloads to a background process and exits, those two diverge.
  - **The orchestrator caught it precisely because it refused to trust `[done]`** and verified the PR
    SHA + Linear comment + `mergeable_state` from outside. Invariant 2 earned its keep: a terminal
    status is still a *claim*; the external artifacts are the fact. Recommend the guide note that a
    terminal `done` with **no corresponding evidence change** is treated as *claimed-incomplete*, not
    done — the orchestrator must diff the evidence (a new SHA / comment / state), not just see the
    marker.
  - **Secondary finding — the `[stalled?]` heartbeat can't distinguish a hung agent from one blocked
    on a long synchronous command.** The suite run surfaced as `[stalled?] no tool activity for 8m51s
    in EXECUTING (last tool: Bash)` — benign (the operator confirmed live), but indistinguishable by
    the signal alone from a real hang. "last tool: Bash + no new tool calls" is the signature of *one
    long-running Bash in flight*, not death. The liveness heuristic needs a way to mark "blocked on a
    known long command" vs. "stuck."
- **Disposition — flagged, then closed.** Because the channel was stale and the runner's local
  working-tree state (rebased? suite green?) is observable only on the operator's laptop, the
  orchestrator **flagged to the human** rather than re-dispatching blindly (a fresh worker could
  collide with a half-applied local rebase — the B3 tangle). The operator confirmed + pushed; the
  orchestrator then re-verified from outside: PR #327 `mergeable_state: clean`, head `e17652`, the
  rebase diff sound (both `docs/autopilot.md` sides preserved, no conflict markers, source/tests
  byte-identical to the approved diff). With that gate green and the merge pre-authorized, the
  orchestrator **took the merge itself** (squash `f5354783`), then watched the post-merge evidence:
  **CI `Tests` #820 on `main` → success**, prod `/instructions` now documents `kind` (deploy live),
  and **LIN-319 set to Done**.

**Net (B4) — the merge-to-main write path is now CLOSED end-to-end.** First run to traverse the full
arc: **orient → plan(prior) → implement(prior) → review → resolve conflict → merge → CI → deploy →
ticket Done**, every transition judged from external evidence, with the human supplying exactly two
things: the merge pre-authorization, and the out-of-band observation that broke the stale-channel tie.
Findings to fold into the design:
1. **A terminal `done` is a session-boundary signal, not proof of task success** — and the channel can
   go terminal *before* the work lands and never catch up. The orchestrator must confirm completion by
   a **change in the external artifact** (new SHA / comment / state / CI run), never by the `[done]`
   marker alone. (Now also stated in the guide.)
2. **The `[stalled?]` heartbeat can't tell a hung agent from one blocked on a long synchronous command**
   (`last tool: Bash`, no new calls = one long Bash in flight). *Operator owns the fix in the dispatch
   consumer* — distinguish "blocked on a known long-running command" from "stuck."
3. **A clean write-path drive still wants one worker per ticket and a healthy `/recommend`** (both held
   in B4), plus a way for the worker to report completion *after* a backgrounded command rather than at
   the session boundary — otherwise the channel and the work diverge.

### `/recommend` 504 root cause (investigated 2026-06-06)

The B-runs attributed the 504s to "Linear context-fetch slowness." A live probe **disproves** that
and corrects the record:

| call | time | result |
|---|---|---|
| `GET /me` | 0.86s | ok |
| `GET /issues/LIN-319` | 0.64s | ok |
| `GET /recommend/LIN-319` | **50.5s** | **504** |

- **Linear is sub-second**; the recommend call tripped at **~50s = `MULTI_REQUEST_TIMEOUT_MS`**, the
  wrapper around the **OpenRouter `getRecommendation` call** (`routes/proxy.js:2225`), *not* the 45s
  `CONTEXT_FETCH_TIMEOUT_MS` Linear budget. **The slow leg is LLM generation, not Linear.**
- **Misattribution bug:** `withTimeout()` (`routes/proxy.js:237`) hardcodes the message
  `'Linear API request timed out'` and wraps *both* the Linear fetch and the OpenRouter call;
  `graphqlErrorDetail()` (`:832`) returns that Linear-flavoured text for *any* `TimeoutError`; the
  server log (`:2256`) prints the same. So a slow LLM is indistinguishable from slow Linear in both the
  API response and the logs — which is what misled the earlier notes.
- **Candidate causes (ranked):** (1) OpenRouter/model generation latency > 50s under provider-routing
  variance — large output (reasoning + a full prompt, up to 8000 tokens per PR #320) on a slow route;
  (2) tight serialized budget with **no retry/cache/fast-path** (Linear ≤45s → OpenRouter ≤50s,
  serial); (3) model/output-size choice (`resolveWorkspaceModel`, no smaller-output variant);
  (4) *real but not this case* — `ISSUE_DETAIL_QUERY` complexity (deep `parent→siblings→cousins`,
  `inverseRelations`, `project.content`, no per-connection caps) can trip the 45s Linear budget on
  large epics (the PR #319 class); (5) Heroku keepalive flushes `200` at ~25s and delivers the real
  status in the JSON body (`statusCode`), so a 504 arrives as `HTTP 200` + in-body status.
- **Fixes, in order:** distinguish the two timeout sources in the error/codes/logs (cheap, unblocks
  diagnosis); then harden the LLM leg (bounded retry, brief cache à la `recap-cache.js`, faster/smaller
  model, or relaxed/streamed budget). For autopilot, a *sanctioned* single retry-after-backoff is
  justified because the failure is latency variance, not a hard error.
- **Fix applied (this branch):** the LLM leg now has a **dedicated `LLM_TIMEOUT_MS = 180_000` (3 min)**
  budget (`routes/proxy.js`), used at all five generation sites (recommend / recap×2 / brief×2), while
  the Linear `fetchProjects` backstop stays at `MULTI_REQUEST_TIMEOUT_MS = 50s`. Verified the keepalive
  carries it: `http-keepalive.js` flushes a `200` at 25s then writes a heartbeat **every 15s**, so the
  socket survives an arbitrarily long generation (the keepalive, not the cap, is what defuses Heroku
  H12). Tests green (9 unit + 47 proxy e2e). *Deliberately not done here (per scope):* model change /
  speed-ups, client-facing streaming (the proxy returns buffered JSON behind the keepalive; true SSE
  would change the consumer contract), and the error-message disambiguation (the LLM timeout still
  reports the Linear-flavoured text) — left as the cheap follow-up.

### Endpoints / changes shipped on this branch

- `POST /api/proxy/dispatch` (enqueue) + `GET /api/proxy/dispatch/:id` (watch) + `GET /api/proxy/dispatch`
  (list, filter by `issueIdentifier`/`status`).
- Auto-append proxy context to dispatched prompts (Linear access; reporting left to the runner's Stop
  hook). Standing readWrite token **for now**, flagged in-code as security debt. Fixed a malformed-URL
  bug for dispatches without an `issueIdentifier`.
- Terminal-status derivation (`deriveTerminalStatus`): watch + list surface `done`/`failed`/`aborted`
  from the runner's feedback marker, derived on read (punch-list #9).
- All covered by E2E tests in `tests/e2e/proxy.spec.js` (13 dispatch tests).
