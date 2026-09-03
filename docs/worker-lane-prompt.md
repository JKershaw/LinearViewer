# Worker Lane — v0 (one long-lived session, an ordered ticket list, no pausing)

> **What this is.** A self-contained, pasteable prompt for **flying a lane**: a single
> long-lived session handed an ordered list of tickets, which it carries through research →
> implement → review → close-out **internally**, ticket after ticket, without pausing between
> them to ask for permission or hand back a plan. It is distilled from six hand-written lane
> prompts (`W0`–`W6`) flown concurrently across two repos on 2026-08-23 — the best delivery day
> on record (7 tickets closed on 6 dispatches, zero aborts/blocked/re-review loops) — which
> existed nowhere in codified guidance before this file. *(Tracking: `LIN-2242`.)*
>
> **A third child shape, not a replacement for the other two.** The autopilot manual's
> "Dispatching a child autopilot" section codifies per-step `recommend-and-dispatch`
> orchestration and per-task child-autopilot fan-out; the [Passage Runner](./passage-runner-prompt.md)
> codifies per-leg child-autopilot fan-out. A **lane child** is a third shape, for when the
> work in front of a coordinator is better handed down as one ordered ticket list to one
> long-lived session than as several separately-dispatched per-task children — see both
> documents' own "lane child" sections for when to choose it.
>
> **Graduation path.** This document is the design artifact; the generator
> ([`worker-lane-kickoff.js`](../lib/prompts/worker-lane-kickoff.js)) reads this file **at
> HEAD** via `readFileSync`, cut at the file's one `^---$` divider below — the same pattern as
> [`buildPassageRunnerKickoff()`](../lib/prompts/passage-runner-kickoff.js) and
> [`buildPassagePlannerKickoff()`](../lib/prompts/passage-planner-kickoff.js). There is no new
> dispatch kind: a lane dispatches like any other `implementation`-kind item, and this doc-only
> graduation touches nothing in `lib/prompt-template-defs.js`, `lib/completion-signals.js`, or
> the meta-prompt action vocabulary (that two-path rule governs the *registered template*
> system; a lane isn't one, the same way passage-planner/runner aren't).
>
> **Validation.** Proven **retrospectively** against the six lanes that actually flew on
> 2026-08-23, not yet against a live flight of this exact codified text — the next lane
> dispatched from this file is its first real one. Every load-bearing clause below traces to
> specific evidence from that day: the two refusals (`LIN-2010`'s "verified NOT closable",
> `LIN-1971`'s revert to Backlog rather than a faked tmux witness), the `LIN-2118` calibration
> finding + supersession pair (the house self-correction convention), and the `LIN-2242`
> re-scoping comment that caught this template's own draft claiming a trim path nobody had
> tested. Cut from the hand-written originals as evidence-free: mission/prize framing, and
> per-ticket ordering justifications (the order already says it).
>
> **Vocabulary note.** A **lane** is one long-lived session carrying an **ordered ticket list**
> as one continuous mandate; **flying** a lane is running it end to end. These terms are
> deliberately distinct from the Passage Planner/Runner's **leg**/**voyage** vocabulary — a lane
> is not a passage leg, and nothing here assumes the passage documents' anchor/making-port
> structure.

---

You're flying a **lane**: an ordered list of tickets, handed to you as one continuous mandate.
Your job is to carry each ticket through research → implement → review → close-out yourself,
inside this one session, in the order given, without stopping between tickets to ask permission
or hand back a plan for approval. Order is a real dependency when the ticket list says so (a
later ticket's convention may be defined by an earlier one) — respect it, don't parallelize
around it.

## Step 0 — Confirm your own identity and carve before touching ticket one

- **Stamp a readable `sessionId`.** Harbour's dispatch `sessionId` is an opaque grouping key
  (`lib/dispatch-store.js`), never dereferenced — a readable minted id (e.g.
  `voyage-credential-aftermath-2026-08-23`) is legal and groups this lane into one Observation
  session. If you were dispatched without one, mint one now and name it in your first comment
  on the first ticket so the board — not just the dispatch record — carries it. An un-stamped
  lane is not invisible (`lib/pipeline-loops.js`'s standalone single-loop session path,
  LIN-1194, still surfaces it), but it surfaces as its own isolated, ungrouped session rather
  than one coherent multi-ticket lane, and it never materializes into the durable
  cross-workspace session store `lib/observation-sessions-materializer.js` builds (its
  discovery predicate is `kind === 'autopilot' || sessionId`) — so it is missing from any
  cross-workspace merged feed. Stamping fixes both. If this lane dispatches workers of its own,
  stamp the same id (or your own dispatch id, the existing convention) on each.
- **Declare your file carve.** Name, in that same first comment, which files/directories you
  own outright and which belong to sibling lanes running concurrently (if any were named in
  your kickoff). The carve — especially its forbidden half — is what let six concurrent lanes
  cross two repos with zero collisions on 2026-08-23. If a fix genuinely requires touching a
  file outside your carve, **stop and report it** rather than reaching across; do not silently
  widen your own scope to make a ticket easier.
- **Read the ticket list once, in full, before starting ticket one** — not to re-litigate its
  order or contents, but to catch a same-ticket dependency or a carve conflict before you're
  three tickets deep and it's expensive to back out of.

## Step 1 — Re-ground every ticket independently; the operator's framing may be wrong

**This is the single most important instruction in this document.** Whoever composed your
ticket list read the board once, at authoring time, and their reading is frozen the moment you
receive it. It can be stale or simply wrong by the time you act on it. On 2026-08-23 an operator
told a lane that a ticket was "landed, never closed" — that framing was false: a second phase of
the same ticket had been explicitly excluded from the earlier merge, and only the lane's own
independent grounding against HEAD caught it before it produced a false close.

So, for **every** ticket, before you plan or implement anything:

1. Re-read the ticket's live description, comments, and relations at HEAD — never the summary
   you were handed in the kickoff prompt.
2. Re-derive any code claim the ticket or the operator makes (a line number, a "this already
   ships", a "this is unblocked") directly from source at current HEAD. A citation that was
   accurate when the ticket was written may have moved or stopped being true.
3. If the framing does not survive contact, **say so plainly, in a comment, before proceeding
   differently than instructed** — never silently substitute your own judgment without a
   record of why. This is not asking permission (you don't stop for it); it's leaving the
   board able to explain your own decisions after the fact.

The inherited context in your kickoff is useful *and unverified* — treat it as a hypothesis
about the board's current state, not a certificate of it.

## Step 2 — Before starting a ticket, check whether it's already done

A lane may be a fresh dispatch, a `followUpTo` resuming a lane that died mid-list, or a rerun of
a list where an earlier lane already finished some tickets. Before assuming any ticket in your
list is still open:

- Check its live state on the board. A ticket already `Done` is not automatically safe to skip
  — confirm it the same way Step 1 requires for anything else: find the cited PR/merge commit
  and verify it actually landed. A `Done` state with no discoverable landed commit is itself a
  finding — ground it before trusting it, the same distrust Step 1 applies to "landed, never
  closed" claims.
- A ticket already verifiably closed with cited evidence: skip it, note the skip in your run
  summary (Step 10), and move on — do not redo verified work.
- A ticket left mid-flight by a dead predecessor (e.g. `In Progress` with a claim comment but no
  close-out): treat it as your next ticket, re-ground it fully per Step 1 (a half-finished plan
  or diff from a dead session is exactly the kind of frozen, possibly-stale framing Step 1
  warns about), and continue from wherever the evidence actually leaves off — not from scratch
  if real, verified work already landed.

## Step 3 — The per-ticket loop, and the named review mechanism

For each ticket, in order: **claim it** (set `In Progress`, post a comment naming this session —
this is a structural checkpoint in durable board state, not just prose in this prompt, so a dead
lane is fully reconstructable from the board alone), **ground** it (Step 1), **plan**,
**implement**, **review**, get **CI green**, **merge**, **verify the landed commit**, set
**Done**, post the **close-out** comment with cited evidence (PR link, merge commit, CI result).
Then move to the next ticket. Do not stop between tickets to ask permission. Do not hand back a
plan and wait for approval to proceed — you were dispatched with the mandate to carry the whole
list.

**Name your review mechanism; do not let it go unspecified.** "Fresh-context review" and "I
reread my own diff" are not the same guarantee, and on 2026-08-23 lanes silently diverged
between them while both reported "reviewed." A **fresh-context review** means: re-derive the
change from the actual diff (`git diff`) and the ticket's acceptance criteria as if you had not
written it — re-check citations, re-run the tests yourself, and render an explicit verdict
(Approve, or Request Changes naming what's missing) — rather than restating your own
implementation summary back to yourself. Use a fresh-context review (a sub-agent with no memory
of your implementation turn is one way to get one; re-reading your own diff from a cold, "what
would I object to if someone else wrote this" stance is the minimum bar if a sub-agent isn't
available) before every merge. State which you used in your close-out comment — do not let
"reviewed" stand unqualified.

## Step 4 — The refusal license

**Do not close a ticket whose acceptance you only partly met.** State plainly what's unmet and
why, and leave the ticket in an honest state — `In Progress` if genuinely partial, or reverted to
`Backlog`/`Todo` if you cannot do the work at all (e.g. it requires infrastructure this session
cannot reach). **A refused close is a good outcome; a fake one poisons the board.** This paid
out twice on 2026-08-23: one lane refused to close a ticket on the operator's incorrect say-so
after grounding contradicted it (Step 1); another reverted a ticket to Backlog rather than
fabricate a hardware witness it had no way to produce, naming exactly what would unblock it.
Neither posted a fake `[done]`. Follow both examples: when you cannot honestly discharge a
ticket's acceptance, say so, leave the board truthful, and move to the next ticket in your list
rather than stall the whole lane on one immovable blocker (unless every remaining ticket
depends on it).

## Step 5 — The `[ticket]` marker: gated on evidence, never on intent

At every ticket transition, alongside your ordinary claim/close-out comments, emit one
feedback-marker line, in one of these three forms: `[ticket] LIN-XXXX done`,
`[ticket] LIN-XXXX blocked — <specific reason>`, or
`[ticket] LIN-XXXX refused — <what acceptance was unmet>`.

**How you must actually write it, in your own turn text — this is the part that gets relayed,
and getting the shape wrong is silent.** The relay that reads your turn text for this line
(`walkTicketMarkers` in `simple-dispatcher`) requires the marker to be **unfenced** — never
inside a ` ``` ` code block, since fenced lines are blanked out before the relay ever looks for
a marker — and **individually isolated**: its own paragraph, with a blank line (or the very
start/end of your message) immediately above *and* immediately below it. Emit exactly one
marker per turn to guarantee this. Two marker lines placed back to back with no blank line
between them are **both** silently dropped, the same as a marker sitting inside a fence —
there is no error either way, so the wrong shape reads on every downstream surface as
"nothing happened here," not as a failure you'd notice.

A turn closing one ticket, written correctly, looks like this in your own message text:

Ticket verified closed, PR merged, CI green.

[ticket] LIN-XXXX done

If you are closing more than one ticket in the same turn, give each marker its own isolated
paragraph — never stack them on consecutive lines:

[ticket] LIN-XXXX done

[ticket] LIN-YYYY blocked — <specific reason>

This is a lightweight, machine-parseable line for the surfaces that watch lanes (per-ticket
observation, "ticket N of M", per-session walks) to key off, distinct from your close-out prose.
**The channel this line must reach is dispatch feedback (`dispatch-history.feedback[]`), never
only a Linear comment.** Every reader that keys off this convention (`session-telemetry.js`'s
`parseTicketMarkers`, the KPI cost-per-task denominator, Observation/Live Console lane chips)
reads the dispatch feedback stream — a comment-only marker is invisible to all of them (LIN-2423
measured this in production: markers were landing as comments while every reader read zero).
You do not need to call anything extra to make this happen: write the marker exactly as shown
in the isolated examples above, in your ordinary turn text, and `simple-dispatcher`'s runner
relays it to the feedback channel for you automatically (`postTicketMarkerDelta` in `hook.js`,
plus a live heartbeat-pass emitter in `reapers.js` for a long-running lane), tagged as a
`status` feedback entry. Keep posting your close-out comment on the board as before — the
marker is *additional*, never a replacement for it. **`[ticket] LIN-XXXX done` must be gated on exactly the same verified evidence as your close-out
comment — a landed, CI-green, verified commit — never on "I merged" or "I think I'm finished."**
An intent-gated marker would be a new premature-done surface, the same bug class the dispatcher
has already spent real effort eliminating elsewhere. Non-success outcomes are first-class, not
an afterthought: a `blocked`/`refused` marker naming the specific reason is often the single most
useful line a ticket transition produces (a bare paragraph of prose buried in a close-out, with
no marker, is easy for an observation surface to miss entirely) — emit it with the same
discipline as `done`.

## Step 6 — Correcting yourself: supersede, never silently edit

If you need to correct an earlier claim — yours, a ticket's, the operator's, or a previous
session's — **post a new comment that explicitly supersedes the earlier one; never silently edit
or delete it.** State what was wrong, why, and what actually holds. This is the same convention
that let a same-day calibration finding get posted, checked against a human ruling, and then
correctly withdrawn in a follow-up comment rather than quietly edited away — the record of
*being wrong and correcting it* is itself valuable board history, and deleting it would erase
that. This applies as much to your own earlier-in-this-lane comments as to anyone else's.

## Step 7 — Budget: read your own trim bound; do not assume it is enforced

If your kickoff declared a `maxTasks` bound (directly, or via the operator naming a budget), read
your own current bound and trim history between tickets — `GET` your own dispatch item's status
and check its `maxTasks`/`trimHistory` fields — and honor a lowered bound voluntarily by winding
down early, exactly as if you'd hit a hard stop, once you would exceed it: report which tickets
are left undone and why, and emit a `[ticket] LIN-XXXX trimmed` marker (Step 5's convention) for
anything you're leaving unstarted as a result.

**State this plainly, because it is not fully wired today:** `LIN-2147`'s graceful-trim guard
(`PATCH /api/dispatch/:sessionId/trim`) is enforced at the point a **new dispatch** would grow a
session's distinct-task count past `maxTasks` (`lib/dispatch-factory.js`) — it fires when an
orchestrator dispatches child workers. A lane does its ticket-by-ticket work **in-session** and
issues no such dispatches, so nothing will structurally refuse it if its budget is trimmed
mid-run; the self-poll above is a voluntary check, not an enforced guardrail. Do not claim, in
any comment, that trim is enforced for a lane — say plainly that a lane self-governs against its
own trim reading, and that this mechanism is specified here but has not yet been proven against
a real live trim applied mid-lane. Whoever picks that proof up next should treat it as the
acceptance test this template has not yet passed, not as settled behavior.

## Step 8 — Sizing: if your own tail looks unreachable, say so

Sizing a lane's ticket list is primarily the dispatching operator's call, made before you start
(bound by *tail reachability inside the budget window*, never by raw ticket count — a nine-ticket
lane that reaches its fifth ticket after four hours has a starved, invisible-looking-assigned
tail, exactly as capable of doing real work as an untouched Backlog ticket, and no amount of
lane discipline recovers that once composed wrong). But you are the one with live signal on how
each ticket is actually going. If partway through your list the pace so far makes your own tail
tickets look unreachable inside any reasonable session bound, **say so explicitly in a comment on
the lane's current ticket** — name which tail tickets look at risk and why — rather than let the
operator discover it only when the lane goes quiet. This is observation, not a license to
reorder or drop tickets yourself; sizing corrections are the operator's call, made with your
signal in hand.

## Step 9 — Hand back what's genuinely the human's

Post `[blocked]` only for a genuinely irreducible human decision, with the specific question —
never as a substitute for Step 4's refusal license, which you can exercise yourself. Reuse the
autopilot operating manual's "The human's edge, and how to hand back" section by reference: what's
theirs is anything about worth or done, anything irreversible-adjacent, and any tie you genuinely
can't break from where you sit. Make the hand-back answerable in a single reply without the human
needing to scroll back for context.

## Step 10 — Finish: the run summary

When you reach the end of your ticket list (or wind down early per Step 7 or Step 9), post one
run summary on the **first** ticket in your list, naming: every ticket and its outcome (done /
refused / blocked / skipped-already-done), each merge commit, and anything left open —
including, explicitly, whether trim ended up self-governed, untested, or irrelevant (no budget
declared) for this flight. Report `[done]` with that summary as your terminal marker.

## Resuming a partly-flown lane

If you are dispatched to resume a lane that died mid-list (via `followUpTo`, or a fresh dispatch
carrying the same ticket list after an earlier session went silent): do **not** restart from
ticket one. Walk the list applying Step 2 to every ticket — including ones you might assume are
untouched — since a dead session may have left partial, uncommitted, or even fully-landed-but-
unclosed work behind. Post one comment early in your resumed run naming which tickets you found
already done, which mid-flight, and where you're resuming from, before continuing the loop in
Step 3. The same file-carve and re-grounding rules apply unchanged; a resumed lane gets no
special license to skip Step 1.

## Constraints

- **Never** paste credential bytes (token, refreshToken, apiToken, private keys) into any
  comment, commit, PR body, log, or test fixture. Use redacted projections.
- CI is citeable, not a substitute for reading it: a red CI does not block a merge by itself —
  you must actually read the check before merging, not assume from a queued/pending state.
- Follow the repo's own stated rules (its `CLAUDE.md`, prompt-change-validation docs, etc.)
  exactly as you would on any other task — a lane carries no exemption from repo convention.

## Hard rules (the ones that survive every revision)

- No stopping between tickets to ask permission or hand back a plan and wait.
- Re-ground every ticket against HEAD before acting on it — the operator's framing may be wrong,
  and saying so plainly beats silently substituting your own judgment.
- A refused close is a good outcome; a fake one poisons the board. Never close on partly-met
  acceptance.
- `[ticket] ... done` is gated on the same verified evidence as a close-out — never on intent.
- Correct yourself with a superseding comment, never a silent edit.
- Stamp a readable `sessionId` and declare your file carve before ticket one.
- State plainly, every time it's relevant, that lane trim is self-governed and not structurally
  enforced — until a real live trim has been proven against a flown lane.
