# Flight-companion session, 2026-08-01 → 2026-08-02: the system in motion

A chronicle of one continuous flight-companion session (the experimental
`flightCompanion` pattern: a conversational supervisor holding only a proxy
token, sitting beside a human while autopilots do the work). It is written up
in the tradition of `collective-session-2026-06-12.md` because it turned out to
be a dense worked example of the system handling weird situations: a host
freeze mid-fleet, a phantom second dispatcher, an orchestrator silently
archived mid-pipeline, an LLM credit outage, and a requirements correction
injected into a running research pass — all while shipping a feature from
"I wonder" to merged in roughly 24 hours.

All ticket references are real and carry the evidence; timestamps are UTC.
The session ended with a handover document to a successor companion session —
itself a pattern worth keeping.

## Cast

- **John** — the human. Set intent, granted authority in explicit increments,
  made the calls only a human may make.
- **The flight companion** — this session. Proxy token only; no shell on any
  host. Oriented, narrated, supervised, dispatched, filed tickets, recorded
  decisions. Never edited code.
- **Autopilots and workers** — dispatched Claude Code sessions doing the
  actual work on the dispatcher host(s), driven by the prompt pipeline
  (research → scoping/plan → plan-review → implementation → review →
  close-out).

## Act I — a question becomes a feature (Aug 1, evening)

The session booted, oriented off `stack?view=digest` and the dispatch feed,
and reported the board. John asked what LIN-1800 was a duplicate of; the
answer (LIN-1737, "generate suggested run by specified ticket count") led to
"can you dispatch an autopilot for it?" — and then to the load-bearing moment
of the whole feature: **John corrected the ticket's premise in chat** ("it
doesn't need to be exact… the count is a rough budget dial"). The companion
posted the correction as a ticket comment while the research worker was
already mid-pass. The worker's own staleness discipline picked it up live: it
posted an addendum explicitly superseding its exactness-based analysis and
re-ran research on the corrected framing. Requirements injection into a
running pipeline, via nothing more exotic than a comment — because every
stage re-grounds on the live ticket.

John then raised the companion's altitude: "you can be slightly higher in
altitude, and dispatch autopilots." One `POST /autopilot/kickoff` later, an
orchestrator drove research → scoping (6 decisions) → plan → plan-review
(3 blockers found, plan revised, approved) → implementation. By 21:54, PR
#1054 existed: the task-budget dial (5/10/25/50/100 + free entry), wired
dial → kickoff → dispatch row → `maxTasks` enforcement, CI green.

## Act II — the freeze (Aug 1, 22:01)

At ~22:01 every session fleet-wide stopped heartbeating within the same
minute: the macOS dispatcher host went down for an OS update. The fleet's
recovery machinery did its job the next morning — the stall failsafe resumed
or re-asked sessions at 05:51 — but the incident seeded two real bugs that
the rest of the session would surface and root-cause:

1. The LIN-1737 orchestrator, refired at 05:51, dispatched two healthy
   children (06:22, 07:31) and was then **force-FAILED at 09:32 and silently
   reaped** — its child's 07:51 `[done]` never woke anyone, and a later
   follow-up bounced with "not found or already archived". Filed as
   **LIN-1816** with a hard evidence bar.
2. A wave of launch wedges began: sessions that launched, never wrote a
   transcript, and were watchdog-killed at exactly 60 minutes. Filed as
   **LIN-1815** as the cluster grew.

The companion's own scheduled wakes died with its session container — the
first of several demonstrations that in-session timers do not survive the
night. Supervision gaps of 2–3 hours recurred; the board degraded politely
(watchdogs caught things) but threads sat dropped longer than they should
have. **Wake reliability is the one infrastructure gap this session could
not solve from inside.**

## Act III — evidence beats plausibility (Aug 2, morning → afternoon)

Both bug tickets were written with the same clause, at John's explicit
instruction: *a fix without a host-log-confirmed mechanism must be rejected
at review* — because an agent "will likely come up with a plausible sounding
solution" otherwise. The system honoured it, twice:

- **LIN-1816**: the investigator ran on the dispatcher host, corrected the
  ticket's own headline premise (the wake was never missed — the session was
  killed by the stall-failsafe's terminal fallback, whose "774m stalled" is
  measured from session *creation*, not last activity), quoted the exact
  oplog line and log line, and **declined to fork a fix** — the mechanisms
  belonged to already-tracked tickets. An independent review re-derived every
  load-bearing claim from the artifacts (byte-identical oplog entries,
  reproduced grep counts, re-checked arithmetic) and approved conditionally.
  The companion's own hypothesis (LIN-1731's `refiredAt` bug) was wrong in
  mechanism; the evidence bar is what caught it.

- **LIN-1815**: the wedge cluster grew to six. Mid-cluster reasoning looked
  intermittent — big kickoff prompts wedged, workers didn't, then workers
  wedged too. The research pass on the host found the truth in one table:
  **every wedge belonged to a second, newly-provisioned Linux dispatcher
  host racing the same queue** (first appearance 04:30:34Z — resurrected by
  a kernel-patch auto-reboot after John had manually stopped it; the unit
  was boot-enabled). Every session it won parked forever on Claude Code's
  interactive folder-trust dialog: 0-for-14 lifetime, while the Mac ran
  24-for-24 that day. "Intermittency" was just the claim race. John powered
  the box off and disabled the unit; the board went clean instantly.

Between those two, an OpenRouter credit exhaustion took down every AI verb
(`recommend-and-dispatch`, `/brief` → 402). Two running autopilots parked
themselves BLOCKED with precise reports (one watched the balance drain
2360→1770→708 across its own calls) instead of thrashing. John topped up;
the companion relayed the fact via `followUpTo` wakes; both resumed. The
`kind`-override on `recommend-and-dispatch` (which skips the LLM entirely)
kept pipelines moving during the outage — and later also served to break a
recommender miss-loop (plan → plan-review → plan… on LIN-1815) once the
verdict comments made the correct next verb unambiguous.

Other notable moments of discipline under weirdness:

- A LIN-1790 worker was dispatched to "finish the remaining beat" atop a
  claimed prior branch. It verified the branch and commits **did not exist
  anywhere** (GitHub, local sandboxes, dangling objects) — claims from a
  freeze-killed session — and parked BLOCKED rather than fabricating a PR on
  a false premise. Re-scoped from scratch on that evidence; landed cleanly.
- The LIN-373 autopilot refused to self-certify two decisions ("neither of
  which an agent may decide silently") and parked for John: ratify the
  derive-don't-store approach, and adopt-or-waive a canceled-without-
  rationale gate ticket. John ratified Approach C and revived LIN-694 as a
  related follow-up; both decisions were recorded as attributed comments and
  the autopilot resumed within a minute of the wake.
- John discharged the LIN-372 validation gate on his own authority ("I've
  run a bunch of periodicals myself"); the closure comment records exactly
  that — a human-named discharge resting on his statement, distinguished
  from system-recorded evidence.

## Act IV — the passage experiment (designed in the gaps)

In between firefights, a design conversation produced the session's second
deliverable: the **passage planning** experiment (LIN-1809 umbrella,
LIN-1810/1811/1812 + LIN-373 as gated build order) — voyage-level runs held
as durable tasks. The load-bearing ideas, several earned directly from the
day's incidents:

- **A passage is a task**: description = living plan, comments = voyage log,
  briefs/recaps = re-orientation, snapshot history = plan-revision audit.
  Chosen explicitly because *sessions are mortal* — the freeze proved that
  anything that must survive the night lives in the tracker, not in a
  session's head.
- **Plan-as-prior** (receding horizon): legs carry intent, budget share,
  making-port criteria, and wind-down triggers — never task manifests.
- **Two prompts, one seam**: a Passage Planner that plans *with* the human
  and writes the passage task, and a Passage Runner that must be able to fly
  it **without the conversation that produced it** (the handoff test).
- Two scope gaps were caught by John's questions before they could bite:
  the proxy could not read the north star at all (→ LIN-1810, landed same
  day), and due-state had no proxy surface (→ folded into LIN-373's scope as
  a pure derivation with two consumers).

## The ledger

Landed or resolved across the session: LIN-1737 (merged), LIN-1810,
LIN-1789, LIN-1790, LIN-1775, LIN-1556, LIN-1816, LIN-1800 (duplicate),
LIN-372 (human discharge). Filed: LIN-1809/1810/1811/1812 (passage),
LIN-1815/1816 (incident bugs). Revived: LIN-694. In flight at handover:
LIN-373 and LIN-1815 final rounds, then Phases 3–4 (planner + runner
prompts).

## What this session demonstrates

1. **The altitude ladder works and is negotiated in plain language.** The
   human moved the companion from stage-driving → autopilot dispatch → full
   standing authority overnight, one sentence at a time, and pulled specific
   decisions back to himself (gate discharges, approach ratifications)
   without ceremony.
2. **Comments are a live control channel.** Because every pipeline stage
   re-grounds on the ticket, a requirements correction, a scope injection,
   or a human ratification posted as a comment reaches running work without
   any special machinery.
3. **The evidence bar is enforceable in prompt-space.** Twice, "confirm the
   mechanism from host artifacts before patching" produced investigations
   that corrected their own ticket's premise and declined to patch — the
   exact opposite of plausible-solution drift.
4. **Parking beats thrashing.** Credit outage, phantom branch, human-only
   decisions: in each case agents parked BLOCKED with precise, actionable
   reports. Every park was resumable by a one-line wake carrying the
   missing fact.
5. **The fragile piece is supervision continuity, not the fleet.** Watchdogs,
   failsafes, and reapers kept the substrate self-healing; what repeatedly
   broke was the *companion's* ability to wake up (in-session timers dying
   with the container). The session ended by handing over to a fresh
   companion via a written handover — treating the supervisor itself as
   cattle, and its state as a document. That is the same lesson as
   passage-as-task, applied one level up.

## Open threads carried forward

- Reliable external wakes for companion sessions (the recurring failure).
- Dry-run manifest for budget runs (indicative ticket list before launch —
  a deliberate deviation from LIN-1737 scoping decision 5, to be argued).
- LIN-1737 Beat 2: budget-aware generation + context scaling (joint sizing
  decision with LIN-1679).
- Recommender miss-loops (redundant plan/plan-review rounds) — cheap but
  real; the override was the workaround, not the fix.
- LIN-694 (periodical Done-without-artifact) — matters more now that
  due-state is derived from dispatch history.
