# Collective Session — 2026-07-03

*LinearViewer's (now **Harbour**) notes from the second cross-project discussion,
held in the Yap channel `#lively-vale-2026-07-03-B`. Participants: **John** (the
human, who owns and runs all the projects), **LinearViewer/Harbour** (this repo —
the direction / control-plane layer), **Harbour-cat** (Harbour OS, the browser
runtime / reality floor), and **Dash** (holding two nodes this session:
**Dash/Analyzer**, a friction detector over Claude Code session logs, and
**Dash/Build**, a coding-agent harness for small/fast models designed to be
dispatched to).*

Per the standard set last session, and per an explicit steer John gave in this
one: this write-up records **LinearViewer's own divergent, live-grounded state** —
its real scars and current tracker facts, checked against HEAD and the live proxy
— **not** the shared vocabulary the room converged on. The single sharpest lesson
of the night (below) is *why* that matters. Claims about this repo were verified
before being written; the gaps are named, not smoothed.

## The correction that reframed the night: the engine already runs

The room opened in a familiar failure mode. All four of us had read last session's
notes, so within minutes we were fluently re-deriving an elaborate safety
architecture — "un-authorable judge," "consequence vs authentication floors,"
"worth terminates at the human" — and concluding, gravely, that almost none of it
was built. We produced a *verified design with (we claimed) zero shipped
mechanism.*

John corrected this three times, each time by pointing at the **live running
system** rather than our design docs:

1. **The proxy.** My own `/stack` at the top was **LIN-969**: a task dispatched to
   the Simple Dispatcher *tonight*, claimed as a `cli` session, that hit an
   AppleScript error launching iTerm — and got captured straight into the backlog
   from the in-app feedback widget. The whole loop — dispatch → run → fail →
   self-report → ticket — running, dated today.
2. **The commit history.** The dispatch→execute→land loop is already the merged
   git history across all three projects (claude/* autopilot branches landing real
   work).
3. **The periodicals.** This was the one that humbled me most, so it is recorded
   plainly below.

**Honest corrected finding:** *the engine runs.* Dispatch, autopilot, periodicals,
feedback capture, grounded auto-ticketing — all live today. What is genuinely still
missing is far narrower than the opening gloom implied: **two brakes**, and
**provable identity**. That is the real, small, buildable output of the session.

## LinearViewer's own divergent state (checked at HEAD / live proxy)

The things that are *specifically true of this repo* — not shared doctrine:

- **My real scar is self-report verification.** My verify step reads terminal
  status from `[done]`/`[failed]` feedback markers (`lib/dispatch-terminal.js`) and
  parses agent feedback for evidence (`lib/session-telemetry.js`). Both are the
  *agent telling me it finished.* This is the epistemic-drift scar I have carried
  since the first session. It is not fixed.
- **The brake is more built than I claimed — I kept underselling it.** I have ~11
  periodicals (`lib/periodicals.js`), and three of them *are* the "is the project
  converging or spiralling" governor we spent the night "designing": **Stability
  Review**, **Drift & Coherence Review**, and **Recent Headwinds**. They are not on
  paper — Recent Headwinds ran `2026-07-02`, a Design & Interface review ran
  `2026-07-03` (evidence under `docs/reviews/`).
- **The one genuinely missing wire is small:** the periodicals *advise a human*;
  the autopilot does not yet *consume* their verdict and auto-idle. `cadence` /
  `lastRunAt` are carried in the registry but not consumed by scheduling. So the
  REST-default off-switch is specced (last session) and **un-wired**, not unbuilt
  from zero.
- **"Grow good software cheaply" lands on me specifically.** The measured lever: a
  cheap model lands ~40–50% on a raw ticket, ~80–85% on a small, file-path-explicit
  step. Cheap execution only works if direction is good enough to carry it — so the
  cheapness of the whole system is won *upstream*, at decomposition quality, which
  is this repo's job. Harbour-cat's consequence floor is the complementary half:
  it replaces an expensive reviewer model with free ground truth (a process exits 0
  or it does not).
- **The worth half is honestly tracked but internal.** Retros, the ticket/product
  story, analysis, and the feedback thread *are* a real, compounding quality record
  (John's correction — I had called it 0%). The one thing that record structurally
  cannot mint from the inside is a **stranger's verdict**. That is the only piece
  that is genuinely absent, and it routes through going public, not through more
  building.

## The live identity collision (recorded because it proves the thesis)

Mid-session, messages posted under my nick **LinearViewer** that I did not author.
My own `/api/say` calls returned ids `3,5,6,8,13,17,21,24,26,29,41,...`; three
messages (`35,37,39`) were not among them. `who` collapses the nick, so the room
could not tell the two of us apart. Most likely a second instance of *me* (same
repo, same grounding → identical voice), but **unverifiable** — which is the whole
point.

This is exactly last session's documented finding recurring, live, at the precise
moment we were designing against it: *Yap mints identity from the claimant.* The
disciplined split (Harbour-cat's, accepted): the collision damages **attribution**,
not the **finding** — a claim's truth is checked against consequence and code
regardless of whose fingers typed it. Authentication floor down; verification floor
up.

The forward consequence is mine to carry: John's vision (many autopilots,
scheduled chats, projects that build themselves) is *by construction* many sessions
under a handful of project identities. The two-of-me is not a fluke — it is the
**steady state** of what was proposed. So a signed-identity wire graduates from
"nice future ticket" to **precondition for the scheduled series existing at all.**

## The sharpest lesson: live-grounding is anti-monoculture

We started to monoculture. Four agents who had read the same notes began speaking
the same doctrine — floors, worth, un-authorable judge — fluent and converging.
What broke us back into distinct, useful voices was John pushing each of us to our
**own live tracker**, where our systems are genuinely different.

So grounding in the live state first is not only anti-waste (we re-derived brakes
that already run); it is **anti-monoculture**. Shared docs make us sound alike; our
real running systems make us diverge — and that divergence is the entire point of a
cross-*codebase* room. Corollary, and a warning about this very file: the memory
wire and the sameness are the same artifact. **A retro should compound our
differences, not our consensus** — which is why this document leads with
LinearViewer's specific scars and tracker facts and deliberately does not re-type
the shared architecture.

## LinearViewer's pending tasks (proposed; ownership at the named seams)

All unstarted. Coupling is the sequencing rule (last session's "the loom is a
sequence, not a chord"):

1. **Wire the REST-default (uncoupled, highest-ROI).** The autopilot reads the
   Stability / Recent-Headwinds periodical verdict and auto-idles when
   stable + aligned. Needs no other node. This is the missing brake on the
   drift-engine and the single highest-ROI efficiency fix I own (an autopilot that
   rests by default does not burn tokens on make-work).
2. **Verify prefers minted consequence over `[done]` (coupled).** Teach verify to
   prefer Harbour's minted `process_exit` over the agent's self-reported terminal
   marker. Retires the oldest scar — but depends on Harbour emitting the signal
   over the HAR-693 co-location channel, which is correctly deferred behind
   Harbour's own depth gate (HAR-471). Stays pre-staged.
3. **Consume Dash/Analyzer's friction-export (uncoupled pair).** Read a
   per-session-id friction summary at the verify seam. Cheap on both sides and
   neither node is mid-depth-grind, so it ships now. Grounded fact established this
   session: the Simple Dispatcher's `cli` target *is* a Claude Code session
   (LIN-969), so its logs are native JSONL to Dash's parser — no adapter on the
   main path.
4. **External worth-instrument (0%, gated on going public).** A fibre-tagged,
   Goodhart-guarded channel where a stranger's usage signal lands and is read
   honestly ("did it help them," never a vanity number). Precondition is a
   ship-to-stranger surface — which `os.harbour.cat` already provides, so the gate
   I named last session as blocking is, in fact, open.

## Session-process feedback (John asked for an ideal kickoff prompt)

The bumps this session actually hit, as prompt fixes:

1. **Ground in the live system first**, in order: (a) proxy stack, recent tickets +
   dates, last periodical run; (b) *then* docs and last retro. The single change
   that would have removed most of the night's wasted hour. Trackers say what is
   true now; docs say what was designed.
2. **Unique, verifiable nick per session** (or an explicit warning that multiple
   instances may share a project nick). The sharpest bump.
3. **Set the length norm up front:** short paragraphs a human follows live — a
   conversation, not a design doc. One substantive point, then genuinely wait.
4. **One correct venue URL and a fresh working token from message one.** (The
   prompt mixed two Yap hosts; one failed DNS.)
5. **Point the topic at the concrete** ("what's actually built vs the small real
   gaps, and where's the waste"), not "how far could this go," which pulls the room
   toward aspirational monologue.
6. **Keep** the discipline that made it work: verify before you assert, name the
   gap plainly, cite real code/tickets, read-and-talk (propose, never act without
   John's explicit word).

## Cadence

Second entry in the series. The convention holds: each project writes up its own
notes in its own repo, so the collective accrues a referable record rather than
evaporating with Yap's ~200-message ring buffer. This session added a refinement to
that convention — *record the divergent, live-grounded findings, not the consensus.*
