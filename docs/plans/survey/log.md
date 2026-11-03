# Survey spikes: log

A running log of the overnight run of 2 to 3 November 2026 and after. The newest entries are at the bottom. The plan is `../survey.md`, and the prompt is `prompt.md`.

## Wrap-up (3 Nov, 16:20 UTC; all spikes in)

**Short version.** The Survey works as a *surveyor*, not just a reviewer.

On three live tickets, its forecasts, written before any work, named where the change would bind and what a plain build would leave behind. Then it happened:
- **S4 (LIN-4106):** both left-behind pill tables became LIN-4159, and the review's regression landed where it pointed.
- **LIN-4110 (the flake):** it read the cause from code, warned that the ticket's own fix would weaken the guard, and proposed the seam the builder then built (better placed).
- **S5 (LIN-4107):** it named the 12px pin collision that became two rulings.

Its misses are one class: things only learned by drawing or running (CSS draw order, phone pixel budgets, test seeding, the runtime cascade). That held on S4 and S5 alike. v2 now asks it to name those, and on LIN-4110 that list was exactly the builder's first checks.

| Spike | What it tested | Result |
|---|---|---|
| 0 | Can we ask a finished session? | Yes, within simple-dispatcher's 6 h reap window (`REAP_INACTIVITY_MS`). Answers must go to a ticket comment. Each question wakes the lineage's autopilot. |
| 1a | Builders and researchers: "why was this difficult?" | 7 answers (5 UI round, S4, LIN-4110), all concrete and causal. Every one names a decision held in several places, or shared test state. Each "first" is a small, complete tidy or a consolidation, with a sized payoff (a third to a half of the diff, a review round, a day of E2E). |
| 1b | Builders against the map | They see different halves. The census catches decisions *spelled* the same; builders catch decisions *meant* the same but spelled differently (parent/children in 3–5 structures, ruling count in 4 places). |
| 1c | v0, blind at S3's base | Two named tidies became real prerequisites (LIN-4118, LIN-4140). Scale badly under-forecast (2 prerequisites predicted, 11 tickets actual). |
| 3 | v0 backtest: 5 prize tickets, 4 clean | 2 hits, 2 partial, 1 miss. Diagnosis strong; it recommended "just drill" past copies it had found (C1 escapes *are* copies left behind). Clean: 2 quiet, 2 small tidies pulled by the task. |
| 2 | v1 forward on S4 | 0 plan-review rounds (✓). It named 3 copies of "last run" (✓, the builder agreed). A drill leaves the pill tables (✓, became LIN-4159). Home's empty cases (✓, the review's regression). The new word table drift (pending). Missed the CSS grid order, the phone budget, a seeding trap. |
| 2 | v1 forward on S5 | Named: the `em` tokens compound (✓); the phone shrink is one global `body` rule (✓); the four-size test over shared sheets "measures the site, not Home", so witness computed sizes per page (✓, the builder's own words and its "what I'd do first"); "there are three tokens" (✓); the 12px pins (✓, rulings). Missed: what depended on the shrink (LIN-3987 first screen, header rows), the runtime cascade (CI red on 3 shards, a bisect). Merged as `048c3319` after John's ruling. |
| 2b | v2 forward on LIN-4110 | Cause (✓), GET warning (✓), seam (✓, builder generalised it), sibling memo (✓), and its "couldn't check" list was the builder's first verification. The cleanest result. |

**Survey versions.**
- **v0:** the base prompt.
- **v1:** name the copies a drill leaves behind; look at the test harness; list the pieces; drop the duration guess.
- **v2:** say what you couldn't check by reading.

Each change came from a specific miss, and v1 dropped one line.

**The best-attested tangle:** per-worker-key test state with no single reset. Three independent hands named it (LIN-4113's builder, the LIN-4110 Survey, LIN-4110's builder: "a third to a half of this ticket"; LIN-4120 and LIN-4110 "would have been the same fix"). The census didn't see it. It's the natural first *acted-on* Survey recommendation.

**Follow-ups surfaced** (not filed): see "Follow-ups the spikes have surfaced" below, plus:
- LIN-4110 was raised to High and is now fixed.
- The flake-blocked deploy didn't retry.
- D&C's "coherence loop stalled" (the 23 Oct follow-ups never moved).

**Caveats.**
- Three forward tests, all in areas the UI round had just mapped.
- One rater (me) judged hits.
- The forecasts' "bites later" items can take days to mature; `plainRunState` is still pending.

---

## 2 Nov, about 21:35 UTC: Spike 0 (can we ask a finished session?)

- **It works, with limits.** `POST /dispatch` with `followUpTo` resumed LIN-4114's builder session about 45 minutes after it finished.
- **The first answer was lost.** It was asked to "answer in your reply", and reply text isn't captured in the dispatch feedback, so the answer never reached the record. Fix: ask for one comment on the session's own ticket.
- **Reach.** Sessions that finished within about 6 hours resumed: LIN-4113 (impl, finished 15:58), LIN-4114, LIN-4145, LIN-4139 (research), LIN-4140. Sessions from 10 or more hours earlier failed with "no live session": LIN-4115, LIN-4117, LIN-4118, LIN-4119, LIN-4120, and LIN-4113's research. The runner holds sessions somewhere between 6 and 10 hours. **So spike 1a has to ask within a few hours of the work finishing.**
- **Side effect.** Each follow-up's completion (or failure) queues a "wake" for its ticket's lineage, which resumes that lineage's autopilot with "a child reached a terminal outcome, resume your cross-check". On finished lineages that's harmless churn. One landed on LIN-4145's live autopilot. Worth knowing before sending follow-ups at scale.

## 2 Nov, about 21:40 UTC: Spike 1a sent

- The same three questions went to each session, independently: why was it difficult and where did the change bind; what would you have done first (just build it, up to a larger tidy); what did the ticket get wrong. Each was told: read-only, one comment on its own ticket, don't read other tickets' Survey comments.
- 5 of 12 sessions were reachable. Answers are collected below once posted.

## 2 Nov, about 22:00 UTC: Survey v0 written, calibration runs set up

- **Spike 3, the backtest set.** Five "prize" tickets, each a ticket that touched a known scattered decision (census `perPr`, exposed) *and* that the coherence paper traced a later coherence-class escaped defect to (`escape-codes.json` `introducedBy`):

  | Ticket | Decision it touched | Later escape |
  |---|---|---|
  | LIN-1318 | kickoff-text twin | → LIN-1324 |
  | LIN-1341 | session classification | → LIN-1394 |
  | LIN-1736 | duration formatting, tolerant timestamp parse | → LIN-2291 |
  | LIN-2354 | kickoff-text twin | → LIN-2370, LIN-2371 |
  | LIN-2619 | LANE_KEYS twin | → LIN-2849 |

  LIN-2444 was dropped because its earliest snapshot postdates its first PR, so its ticket text would leak the outcome.

  Four clean controls, drawn at random with seed 20261103 from tickets with no exposure and no escape introduced: LIN-1058, LIN-1282, LIN-1425, LIN-2666.

  Each is surveyed at its PR's first parent, with the ticket text from its earliest snapshot.
- **Spike 1c.** S3 (LIN-4105), surveyed at `4a0d90ee` (main at S3's start, 2 Nov 01:08). It uses S3's earliest snapshot text. The answer key is the 17-ticket tree and its prerequisites (S3a-0 to S3a-3, S3c-0, S3e and S3e-0), the 80 to 256 minutes per piece, and the browser-test friction.

## 2 Nov, about 21:45 UTC: Spike 1a answers (5 sessions)

Full answers are comments headed "Survey spike 1a" on LIN-4113, LIN-4114, LIN-4139, LIN-4140 and LIN-4145. Every answer is concrete and causal, with file paths and the decision named. None blamed the code vaguely.

**What binds, as the builders tell it:**

| Ticket | Where it bound | What it would have done first |
|---|---|---|
| LIN-4113 (Up next) | Tests pinning the old shape (~30 files selecting by class, not `SELECTORS`); the run offer decided far from Home (`/state` → task-facts holder → write gate); E2E flaking from shared per-account state (`?team=invalid-team-id` leaking between specs, "failed in 7 of 8 full runs") | a test-isolation tidy (seed resets per-account prefs) plus `SELECTORS` for Home regions: "most of the corrective beat (roughly a day of E2E runs)" |
| LIN-4114 (Waiting on you) | "Which rulings get a card" in **four** places (view filter, `rulingCount`, the badge's read, the client's `setWaitingCount`); three tests pinning the wrong shape | make ruling rows one value that count, badge and cards derive from: "F1 could not have reached review", saving one review round |
| LIN-4139 (Up next = what's next, research) | **"Parent" means different things:** `buildForest` (same project only), `buildInProgressForest` (cross-project), Home's fold, `indexNodes.parentOf`, `clusterByParent`; deck eligibility inside `orderIssuesForSwipe`; no tool to see Home's inputs (297 API calls to reconstruct) | one parent index from `issue.parent` (~30 lines, removes 3 of 5 wrong cards before any ranking debate); a read-only view of Home's inputs |
| LIN-4140 (shared question card) | "Is this task-bound?" asked **four** ways; comment payload hand-built at **four** `postComment(` sites; effect decided in **three** layers, plus a stub copy in a test | a small consolidation (one decision-object builder, one exported predicate): "maybe a third less diff" |
| LIN-4145 (cross-project children) | "Who are this task's children" answered by **three** structures with different rules; one fold rule in **three** copies, one of which disagreed and hid a done-child bug | consolidate "what a fold contains" into one function: "about half the diff, no post-pass" |

**Readings:**
- **Independent convergence.** LIN-4139 (a researcher) and LIN-4145 (a builder), asked separately, name the same tangle: the parent/children decision held in three to five structures with different rules. This is the strongest single signal in the set. Two independent hands naming one shape is more than a guess.
- **The pattern is "scattered between", every time.** Four of the five name one decision held in three or four places as where it bound, and the fifth (LIN-4113) is test-isolation friction. None names "tangled inside", meaning a long function. That fits the coherence paper's second kind of mess.
- **Every builder's "first" is option 2 or 3** (a small complete tidy, or consolidating one decision), with a sized payoff: a third less diff, half the diff, one review round, a day of E2E runs. None asked for a Theseus pass, and none said "just drill", though LIN-4140 said "not very hard".
- **Tickets got things wrong in a repeated way:** witnesses that couldn't fail ("fails before" impossible; a check over an empty list), stale assumptions ("always `record`", "unprioritised"), and fences that contradict each other ("/backlog unchanged" against "extend the reachability test"). This is the Costs bar's lessons arising independently in the UI area.
- **Tooling friction is real and specific.** Shared E2E state and a missing "inputs of this page" view. The workshop is part of the place.

## 2 Nov, about 21:55 UTC: an in-flight session touched, and a coordination note

- **One survey follow-up reached a session still at work.** That was LIN-4145 (S3e-0, mid-build). I had picked sessions by "latest implementation dispatch is done" without checking whether the ticket itself was still in flight. It answered (its comment is above) and its build carried on to review, so nothing was blocked. Its live autopilot got one extra wake. **Rule for this run:** follow up only sessions whose ticket is Done and whose lineage autopilot has ended. The UI session ("Rebuilding the UI layer") flagged it, and I messaged it directly.
- **S3e's (LIN-4139) own run was cut off before this, unrelated to the Survey.** Its autopilot started at about 17:00, waited 4.5 hours for S3e-0, and simple-dispatcher's stall failsafe killed it at 21:30. LIN-4040's autopilot will start a fresh one. It's another "should this session be running?" item: started too early, then killed for waiting.
- **Coordination with the UI session:**
  - S4 and S5 stay held until the Survey of S4 is posted on LIN-4150, then I'll ask the UI session to resume. LIN-4040's autopilot owns the run; I won't start a rival.
  - The UI session will tell me when S3e-0 and S3e land, which is my cue to run the periodicals.
- **22:00: the UI operator will keep S4 and S5 held until John tells it directly.** It's a reasonable caution, since resuming dispatches real work and it wanted the word from John rather than a relay. So **Spike 2's forecast will be posted overnight, but S4 runs only after John resumes it in the morning.** The forecast is committed before the work either way, so it remains a genuine prediction.
- **21:56: John confirmed directly to the UI operator** that a "resume S4" from this session counts. So S4 can run overnight once its Survey is posted on LIN-4150.

## 2 Nov, about 22:20 UTC: Survey v0 results (spikes 1c and 3)

Ten runs, all posted to LIN-4150 between 21:44 and 21:48. Each took about 3 to 5 minutes. Judged by reading each output against the key.

**Spike 3, prize tickets.** Did it name the census decision, or the area the later escape came from?

| Ticket | Key (decision → later escape) | What v0 named | Verdict | Recommended |
|---|---|---|---|---|
| LIN-1318 | kickoff-text twin → LIN-1324 (C5: prescribes a standing poll on a wrong assumption about standalone runs) | "One decision ('how does an orchestrator wait?') lives in about seven places", including `autopilot-kickoff.js` and `docs/autopilot-kickoff.md`; "the copies already contradict each other", standalone against dispatched | **hit**: exactly the twin and the standalone-poll area of the escape | consolidate |
| LIN-1341 | session classification → LIN-1394 (C1: session resolution done independently of the builder) | "Two renderers in two runtimes… share no code"; existing chain walks (`resolveChainRoot`, `resolveFollowUpRoot`) duplicated; consolidate = "export the one walker" | **partial**: it named the scattered resolution, but recommended drilling past it | just drill |
| LIN-1736 | duration formatting / tolerant timestamp parse → LIN-2291 (C1) | outcome held in two shapes (loop stamps against task-store column), lean loops, retention | **miss** against the census decision (it found a different real two-shape decision) | just drill |
| LIN-2354 | kickoff-text twin → LIN-2370 and LIN-2371 (C1: client-side copies deferred, still asserting) | "The sentence lives in six places, not two. … Two of them are browser code (`public/common.js`, `public/proxy.js`)" | **strong hit**: it predicted exactly the browser copies that the real work deferred and that escaped. Its drill changes all six copies | just drill (all copies) |
| LIN-2619 | LANE_KEYS twin (gate ↔ sweep) → LIN-2849 (C1: "a fossilised fleet reads as quiet" again) | "the 7-day figure lives in two files" (gate against sweep); the gate is "zero imports" by design | **partial**: right seam (`flight-companion-gate` ↔ `observer-sweep`), different constant | just drill |

That's **2 hits, 2 partial, 1 miss.** Diagnosis is strong and concrete: file paths, counts of copies, contradictions between them. **The weakness is the menu.** It recommended "just drill" on 4 of 5 prize tickets, three of which went on to an escape of the kind it had half-named. Only on LIN-2354 did its drill reach every copy.

**Spike 3, clean controls.** Did it stay quiet?
- **LIN-2666 and LIN-1425: just drill.** Quiet. LIN-2666 even named a 7th copy of the resolve-then-gate block and declined to gather it, correctly, as outside the task's pull.
- **LIN-1282 and LIN-1058: a small tidy first.** One owner for the harness→models lists duplicated across server and browser; the nav height literals in three files. Neither decision is in the census's 33 twins, so this is unjudgeable against the key. Both tidies are pulled by the task: the change is literally a per-harness model link and a taller nav. I'd count them as plausible real findings outside the census, not noise.

**Spike 1c: S3 (LIN-4105) at `4a0d90ee`**, against what actually happened.
- **Hits:**
  - "Home is assembled twice … every new input has to land in each copy": its recommended small tidy, "one `buildHomeModel`", became **S3a-1, "one Home pipeline" (LIN-4118)**.
  - "The shared card is radios plus Answer … switching to buttons also changes the session and task pages" became **S3c-0, the shared question card (LIN-4140)**.
  - "Ruling rows are thrown away; count line and badge are server-only" is **LIN-4114's after-answer** ("which rulings get a card, in four places").
  - "Section membership is split … needs one owner" anticipates **LIN-4113 and LIN-4145** (membership, and parent and children).
  - "Test fan-out is about 21 files" (LIN-4113: about 30).
  - The halt banner split off (S3d, LIN-4115).
- **Misses:**
  - **Scale.** It predicted 2 prerequisite tickets and about 3 sessions. In reality S3 became 11 tickets, at 80 to 256 minutes per piece.
  - **The cross-project parent and children decision** (S3e-0).
  - **E2E shared-state flakiness**, the single biggest cost in LIN-4113.
  - The top-task fix (S3a-0).

**Readings:**
- v0 explains well and predicts the *shape* well. In 1c, two of its named tidies became real prerequisites.
- It is weak in exactly two places. First, it under-weighs a copy left behind when it recommends drilling, and C1 escapes *are* copies left behind. Second, it under-predicts scale and time.
- The 1a builders' biggest cost (test isolation) was invisible to a read-only reader that doesn't run suites.

## Survey v1: what changed and why

- **Added, under "Just drill": "name every copy of each decision you found that drilling would leave unchanged."** A copy left behind is the commonest escaped defect here (C1). v0 found copies, then recommended drilling past them on LIN-1341, LIN-1736 and LIN-2619.
- **Added to "where it binds": the test harness itself** (state shared between tests, slow or flaky suites, missing seams). This was LIN-4113's biggest cost, and v0 never looked.
- **Changed "Will it split, and how many?" to "list the pieces you'd expect it to split into".** A list can be checked against what happened, and v0's count for S3 (2) was far below reality (11).
- **Removed "Roughly how long will it take?"** Effort is the weakest prediction (Theseus found the same), v0 underestimated S3 by several times, and the number invites false precision. Plan-review rounds and pieces carry the same signal more checkably.

## 2 Nov, about 22:25 UTC: Spike 2 forecasts (Survey v1, committed before the work)

Both are posted on LIN-4150 (22:16). The base is `f6a2c2158`, main at 21:54. **S4 and S5 run with their tickets unchanged**, so the forecast is tested against the drill.

**S4 (LIN-4106): the opened task and task page**
- **Binds:**
  - "Last run" words in two raw copies: server `idleRung` in `lib/task-page-loader.js:651`, and browser `renderLastLine` in `public/prompt-section.js:1018`, each with its own age formatter. Both print raw state, and an idle task page shows both.
  - Two pill tables that disagree: `TASK_PAGE_PILL_FOR_STATE` says `waiting`; Home's `PILL_FOR_TASK_STATE` says `needs you`.
  - State-line renderers shared with the guest share and the ready header; Home's empty cases pinned by LIN-4010.
  - The Change drawer is browser-only.
  - About 7 pins, plus `llms.txt`.
- **Drill leaves behind:** `idleRung`, `renderLastLine`'s words and age, both pill tables, `renderCopyState`, and the styleguide text ("at least three copies that disagree").
- **Recommends:** a small tidy first: one `lastRunWords` in the loader, and the two pill tables merged.
- **Predicts:**
  - 0 plan-review rounds, plus one course-change note on LIN-4040 (Home's empty cases).
  - Pieces: (a) the tidy and its unit test, (b) the task-page order, labels and duplicate Last, (c) Home's one line for every case, (d) the drawer in both branches, (e) llms.txt, the styleguide, the golden fixture and screenshots.
  - Will bite: the guest share changes unreviewed; a server-rendered age goes stale; the Sessions list and the box drift apart if the word table isn't shared.

**S5 (LIN-4107): type**
- **Binds:**
  - A four-size test over sheets reaches all of `style.css` (about 339 `font-size` declarations, about 48 distinct), which is LIN-4017's ground.
  - The em tokens compound.
  - The phone shrink is one `body` rule plus three copies that undo it.
  - There is no mono class; mono is inherited from containers.
  - Six pinned tests, and the styleguide hard-codes the token values.
- **Drill leaves behind:** the `body` shrink and its undoing copies, the em tokens, the styleguide copy, and about 44 stray literals.
- **Recommends:** a small tidy first (rem tokens plus a fourth, delete the shrink and its undoing copies), then consolidate the Home and task-page selectors onto the tokens. The witness should be computed sizes at 390px, not a whole-sheet count. LIN-4017 comes second.
- **Predicts:**
  - 1 plan-review round, over the scope of the count test.
  - Pieces: (a) the tokens, (b) the shrink, (c) the selectors, (d) sans for the sessions and answer box, (e) the witness, (f) screenshots.
  - Will bite: em→rem shifts sizes on pages nobody screenshots.

**What to compare afterwards:**
- whether these copies show up as friction, rework or a review send-back;
- whether a copy is left behind and later disagrees;
- plan-review rounds against the prediction;
- the pieces against the prediction;
- the builders' own 1a answers.

## 3 Nov, about 06:15 UTC: the night's gap, and the morning restart

- **The overnight run stalled after 22:25.** My "resume S4" message to the UI session needed a permission prompt that John only saw in the morning, and I had not booked a further check after it. The session's worker also restarted overnight. So S4 and S5 did not run overnight. S3e (LIN-4139) landed at 23:03 and S3 (LIN-4105) closed at 23:31. A lesson for unattended runs: book the next wake-up *before* any step that might block on a prompt.
- **06:12: the resume was delivered** after John approved it, and the UI operator is acting on it.
- **06:15: periodicals kicked off.** A general autopilot run (`86aad1ea`, maxTasks 2) has a goal limited to Seams & Tangles and Drift & Coherence. Both last ran on 23 October.
- **06:13: the UI operator confirmed** that S3e-0 merged as `f6a2c215` (PR #2249), S3e merged as `26a33145` (PR #2250), and S3 was Done at about 23:50. It is lifting the S4 and S5 hold, with the tickets unchanged. Note: the Spike 2 forecasts were taken at `f6a2c2158`, before S3e's merge, so S4 and S5 start from slightly newer code than the Survey saw.
- **Why sessions "die" after about 6 hours (John asked).** The cause is simple-dispatcher's `REAP_INACTIVITY_MS = 6h` (`config.js:584`, env-tunable), not Claude and not Harbour. `cleanupCompletedSessions` (`reapers.js:3383`) drops a finished, inactive session's record from `sessions.json` *and* its clone directory together, "a resume needs both". The transcript survives in `~/.claude/projects/`, but the dispatch→session mapping is gone, so `followUpTo` fails with "no live session" (`followup.js:55`). Two options: raise the env var (cheap, more disk), or keep the record and reap only the clone, re-creating it at the same path on resume, since Claude finds transcripts by project directory. The second would make "ask the builder" possible for days. Not changed; that's John's call.

## Follow-ups the spikes have surfaced (to file when John says)

- **simple-dispatcher: keep sessions resumable for 7+ days.** John: disk space isn't a concern. Either set `REAP_INACTIVITY_MS` on the host or raise the default in `config.js`. This makes "ask the builder" work for days.
- **Follow-up answers aren't captured from the reply.** Today a follow-up has to post its answer as a ticket comment. Capturing the session's reply text in the dispatch feedback would make asking a session cheap and clean.
- **A follow-up wakes its lineage's autopilot.** A read-only question shouldn't trigger "a child reached a terminal outcome, resume your cross-check". It needs a way to send a follow-up that wakes no one.
- **"Should this session be running?"** S3e's autopilot started 4.5 hours before its prerequisite landed, then was killed by the stall failsafe for waiting.

Filed 3 Nov 17:13 UTC as LIN-4164 to LIN-4168 (see Round 2). The fourth wasn't filed this round.

## 3 Nov, 07:00 UTC: progress

- **Periodicals.** The stack-walk autopilot minted LIN-4152 and LIN-4153 at 06:14 (the review tasks for Drift & Coherence and Seams & Tangles). Both are past research. One is in implementation (the report), the other in plan.
- **S4 (LIN-4106)** started at 06:14 as a *stepper* run, going straight to implementation beats: beat 1 "re-ground, baseline, branch", then beat 2 "task page state line + ruling first". There has been no plan-review round so far, which matches the forecast's "0 rounds". Still unknown: whether it builds the forecast's tidy (one `lastRunWords`, one pill table) or drills past the copies.
- **S5 (LIN-4107)** is still Todo and will run after S4.

## 3 Nov, about 07:55 UTC: Spike 2, first read of S4 against its forecast

S4 (LIN-4106) built in four stepper beats plus one corrective beat (beat 3, the drawer default), then went to review on PR #2254 at `850b5353`. It is not merged yet.

| Forecast (Survey v1, 22:16, before the work) | What the drill did |
|---|---|
| 0 plan-review rounds | **0.** It went straight to implementation beats. ✓ |
| "Last run" words in two raw copies (server `idleRung`, browser `renderLastLine`); an idle page shows both | **Resolved by deleting one.** The browser line now keeps only the "All N" button, and the server sentence is the one statement ("Last run: Build finished … · all N runs"). Deletion finishes. ✓ The forecast named the copies, and the builder closed them the cheap way. |
| "If the word table isn't the one shared table, the Sessions list and the box drift apart" | **Happened.** The new `plainRunState` in `task-page-loader.js` ("finished", "failed", "was cancelled") is a fresh word table beside `STAGE_STATE_WORD` in `lib/run-view.js`, which the task page's own stage list still reads ("done" and so on). A new copy of the decision, as predicted. |
| Two pill tables disagree: `TASK_PAGE_PILL_FOR_STATE` says `waiting`, Home's `PILL_FOR_TASK_STATE` says `needs you`; the drill leaves both | **Left behind, as predicted.** Both tables are still there on the branch (`render-task-page.js:111` `'needs-you' → label 'waiting'`, `:124` `→ 'needs you'`). |
| Pieces: (a) the tidy, (b) the task page, (c) Home, (d) the drawer, (e) llms.txt, styleguide, golden, screenshots | Beats: state line and ruling first (b plus part of c); opened box and drawer (d), plus a corrective; E2E, screenshots, PR (e). **No separate tidy (a)**, since it drilled, as the ticket asked. |

**Early reading.** The forecast's specific claims held on the branch: no plan-review round, two copies of the Last words, a drift risk from a new word table, and two disagreeing pill tables left behind. The builder solved the one copy it was made to face, by deletion, and created or left the others. Whether these become friction later (a send-back, a disagreement on screen, a follow-up fix) is the next thing to watch. The builder's own after-answer will be asked once S4 is Done.

**Periodicals.** Drift & Coherence (LIN-4153) is Done. Its corrective beat parented three new follow-ups under LIN-3449, the coherence loop. Its title notes that the 23 October follow-ups never landed, which is the inspectors-without-standing pattern again. Seams & Tangles (LIN-4152) is in close-out (PR #2252). Both reports will feed the map once merged.

## 3 Nov, about 08:45 UTC: the fresh map, and a first look at 1b (builders against the map)

The periodicals merged: `seams-tangles-review-2026-11-03.md` (LIN-4152) and `drift-coherence-review-2026-11-03.md` (LIN-4153, about 27k words).

**Builders' named tangles against the new census (1b, first pass):**
- **LIN-4140, "is this task-bound?" asked four ways.** The census has it: G0118, "repeated comparison disposition == 'task-bound'", **grown**, ruled *borderline*. The builder and the census agree; the builder's account is sharper ("I added two of these four").
- **"Running or queued" inline checks** (G0148, real, `home-view:59`, `render-task-page:245/283`, `task-state:143`). This is close to S4's forecast area: state words and pill tables in `render-task-page`.
- **Parent and children in three to five structures** (LIN-4139 and LIN-4145, the strongest builder signal), **ruling cards in four places** (LIN-4114), and **E2E shared state** (LIN-4113): **not found** in the D&C census or Seams & Tangles on a first grep. Seams & Tangles does show a related `parentNextOf` edge growing Providers→LLM 1→4, but that is a different seam.
- **Reading.** The census, built from repeated literals and comparisons, catches decisions that are *spelled* the same way twice. Builders find decisions that are *meant* the same way but spelled differently (five "parent" structures with different rules; four places computing the ruling count). **The two instruments see different halves.** That's a case for the Survey to read both: the map for spelled copies, and builders' after-answers for meant copies. The after-answers find things the map can't.

**D&C's own top process finding repeats the essay.** Item 7, `coherence-loop-stalled`: "No 10-23 follow-up moved. LIN-3449's cycle dispatches children only after a proposal and John's go." All six 23 October follow-ups are still Backlog with no code change. The inspectors report, and nothing with standing acts.

**S4** has been in close-out since 07:52, not yet Done.

## 3 Nov, about 09:30 UTC: S4 merged. The forecast's left-behind copies surfaced within the same run

S4 merged as `300c811f` (PR #2254). Close-out is paused at the deploy (blocked), so the ticket isn't Done yet.

**Against the forecast:**
- **The disagreeing pill tables became a ticket.** The builder's own final summary lists it as open: "Home says 'needs you' where the task page says 'waiting' for the same state. Product wording, not changed here." Close-out then **filed LIN-4159** for it. The Survey named both tables before the work and said a drill would leave them. One prediction became a follow-up ticket within hours.
- **"Home's empty cases" was the review's regression.** The forecast said the state-line renderers collide with "what LIN-4010 and LIN-4024 decided" and expected "a course-change note … Home's empty cases". Review found exactly there that removing the `wordOnly` branch brought back "No sessions yet." on Home for `backlog`, which LIN-4024 had removed, with no test covering it. It was fixed before merge (ledger 1).
- **The second Last copy needed a further fix.** Review ledger 2 changed the browser `renderLastLine` button wording, so the forecast's two copies of the Last words took two passes.
- **Plan-review rounds: 0** (as forecast). **Review send-backs: 0,** but one review with 6 ledger items, fixed in one commit before merge.
- **Not yet bitten:** the new `plainRunState` word table beside `STAGE_STATE_WORD`. To watch.

**Reading.** On a live ticket, before the work, Survey v1 named four specific things. One was solved by deletion. One became a filed follow-up (LIN-4159). One was the review's main regression. One is a new copy now on main. That's the first evidence that it's a surveyor, not just a reviewer: these were forecasts, made from the code at `f6a2c2158` before any of this happened.

**1a for S4:** waiting for its lineage to finish (the close-out is blocked at the deploy). The builder session (last beat at 07:28) stays resumable until about 13:28 (the 6-hour reap). If the close-out is still blocked at about 11:30, I'll ask the builder anyway, since it is idle.

## 3 Nov, about 11:05 UTC: S4's builder answers (1a), against the forecast

The follow-up went to the stepper session (dispatch `1758387e`, idle since 07:46) and resumed fine. The full answer is on LIN-4106 under "Survey spike 1a".

| Builder said (after) | Survey v1 said (before, 22:16) | |
|---|---|---|
| "One fact was said in three places": `idleRung`, `renderHomeStatus`, `renderLastLine`, plus their pins | Two raw copies of the Last words (`idleRung`, `renderLastLine`), and `renderHomeStatus` among the state-line renderers, with Home's empty cases pinned | **match** (all three named) |
| What it would have done first: "have the server say 'the last run' once … about a third of the test churn" | Recommended: a small tidy first, one `lastRunWords` in the loader that both use | **match**, the same tidy |
| "Ruling first" lives in two places: DOM order *and* the desktop CSS `grid-template-areas`; "only a screenshot showed it" | "Ruling first is one line" | **miss.** The Survey read the renderer, not the CSS grid |
| The phone first-screen budget (`lin-3987`, 844px) was hidden and regressed twice | not named | **miss** |
| Pinned markup regex forced a sibling element; a seeding trap (`create-dispatch-token` registers a runner) | listed pins generally, not these | **miss** (test-harness detail) |
| The ticket put the drawer in `lib/question-card.js` | "The Change drawer is browser-only: `renderChangePanel` (`prompt-section.js`) … It is not in `lib/question-card.js`" | **match.** The Survey caught the ticket's error in advance |

**Reading.** On the binding decision and the tidy that would have helped, the forecast and the after-answer agree closely. Two hands, before and after, independently gave the same shape and the same remedy. The Survey's misses are all *things you only learn by drawing or running*: CSS drawn order, a pixel budget, test seeding. A read-only surveyor that doesn't render or run will keep missing that class. A v2 candidate: ask it to name which claims it couldn't check without rendering or running.

## Railway: S4's deploy

`main` is at `300c811f`, with no commit after it. Railway's deploy waits on green CI, and a re-run of the failed job didn't trigger a new deployment. **The next green commit to `main` will deploy everything, `300c811f` included.** But nothing is merging, because the UI round waits on this deploy (S4's close-out blocks, S5 waits on S4). A small deadlock: a manual redeploy, or any other green merge to `main`, clears it.

## Survey v2: what changed and why (3 Nov, about 11:10 UTC)

- **Added question 5, "What you couldn't check".** The Survey must name its claims that depend on drawing (CSS, layout, pixel budgets), running (timing, parallel load, shared test state) or live data, and say how the builder could check each one early. **Why:** every miss in S4's after-answer was of that class (the CSS grid's drawn order, the 844px phone budget, the seeding trap). A read-only reader can't see them. It can at least say where it's blind, which turns a silent miss into an early check.
- Nothing removed this round. v1's lines all earned their keep on S4.

## 3 Nov, about 11:10 UTC: Spike 2b, a third forward test on LIN-4110 (the flaky look-alike E2E)

John's idea: fix the flake that cost this morning's deploy, and use it as a Survey test. LIN-4110 was raised to **High** and moved to Todo, with today's evidence posted on it (the failure on `main` at `300c811f` that blocked the Railway deploy, LIN-4106's "known flake", and LIN-4113's E2E shared-state cost). A flaky test is the class the Survey is weakest at, so it's a fair test of v2's question 5.
- **11:20: LIN-4110 forecast (v2, at `300c811f`), posted on LIN-4150 before the work.**
  - **Cause, read from the code:** `acceptStateRead` refreshes the run preview on every state read. `rereadUntilComplete` re-reads every 1 s, up to 15 times, so each tick sends a forbidden `GET …/dispatch/preview`. The spec settles on `networkidle` (500 ms), which is shorter than the 1 s tick.
  - **Shared state:** whether the first read is incomplete depends on the server's single task-facts holder, keyed by urlKey. Each worker reuses its urlKey across files, nothing resets the holder, and its refresh has a 60 s floor. "That is why the spec passes alone and fails in the full suite." It cites `docs/reviews/test-run-provenance-review-2026-11-02.md:189` as reaching the same diagnosis.
  - **Copies:** the exemption decision is held twice (the sibling `look-alike-dashboard-controls.spec.js` has its own `FORBIDDEN` list and a named GET exemption).
  - **Warning:** the ticket's own idea, to ignore read-only GETs, would weaken the guard (`/brief`, `/recap` and the fake PR URL are GET look-alikes the spec has to catch).
  - **Recommends:** a small tidy, a harness seam `/test/reset-task-facts?urlKey=…&warm=1` called in `beforeEach`. `FORBIDDEN` stays untouched.
  - **Predicts:** 1 plan-review round (2 if someone pushes the product-side gate). Pieces: (a) a deterministic repro, (b) the test route, (c) `beforeEach` plus an "is the first read complete" assertion, (d) optionally the sibling specs.
  - **Couldn't check (question 5):** whether the first read is really incomplete in CI; the comment's `:209` (at this commit, that line is the Flight Companion test, not the task-page one); `networkidle` against the 1 s tick under load; whether the warm holds across a 4-worker run.
- **11:27: LIN-4110 autopilot kicked off**, with the ticket unchanged.

## 3 Nov, about 12:15 UTC: LIN-4110's investigation against its v2 forecast, and S5 under way

**LIN-4110** was investigated and fixed in under 20 minutes (PR #2255, `1d497704`, not merged). Against the forecast it posted at 11:20:

| Forecast (v2, before the work) | Builder found |
|---|---|
| Cause: the single task-facts holder per urlKey is shared by every spec in a worker, never reset, with a 60 s refresh floor, so the first read is incomplete and re-reads fire the forbidden preview | **The same cause, confirmed:** "the server's held task-facts set … outlives `/test/set-local-session`. Every spec in a Playwright worker uses the same key … the refresh's 60 s attempt floor." Reproduced deterministically; the CI trace shows `task-missing`, then the re-read preview 19 ms later, inside the 500 ms wait ✓ |
| Warning: the ticket's "ignore read-only GETs" would weaken the guard (`/brief`, `/recap`, the fake PR URL) | "**Ignoring GETs is rejected:** several guards … are GET-only signals … `fake-pr-state-url`, `/brief?`, `/recap?`" ✓ |
| Fix: a harness seam that resets and warms the holder, with `FORBIDDEN` untouched | The same seam, placed better: `/test/set-local-session` now restarts the key's held set, so it fixes **the whole class** for every spec, not just this one; the spec's assertions are unchanged ✓ (the builder improved on the forecast) |
| Bites later: the 30 s issues memo (`routes/test.js:1674`) can miss the seed | Sibling noted: "`_workspaceIssuesMemo` … 30 s … the same class" ✓ |
| Consolidate option: preview only on a complete read or a changed step | Product note: "re-fires an identical preview read on each of up to 15 re-reads … previewing only when the step/choice changes" ✓ |
| Couldn't check (q5): whether the first read is really incomplete in CI | The builder checked it from the CI trace: both `/state` bodies were `task-missing`. **That is exactly the early check q5 told it to make** ✓ |
| `:209` in the comment is the wrong line at this commit | The builder used the task-page test, `lin-3975-task-run` followed by `look-alike-controls`. Consistent with it. |

**Reading.** This is the cleanest forward result yet. The flake was a "you'd only know by running it" problem, and the Survey still got the cause right from reading alone. Its question-5 list was the set of things the builder then verified. The builder improved on the fix (fixing it at the reseed, for the whole class), which is the right relationship: the Survey points, and the builder decides.

**S5 (LIN-4107, type)** started at 11:47. A stepper run, in beat 2.
- **Ruling 1** (`lin4107-floor-vs-tokens`): "LIN-4024 pins 12px literals and a phone 0.75rem … the LIN-4107 token test forbids them. Keep the 12px floor by exempting those selectors, or retarget the LIN-4024 pins?" Answered `exempt`, then `exempt-narrow`.
- **The forecast had named this collision:** "Tests pin today's sizes: `lin-4024-type-floor.test.js` (12px, 0.9em, phone 0.75rem) … The 12px-floor tests and the smallest token must agree." ✓ It predicted a plan-review round over the scope of the count test. The scope question came instead as two rulings.
- **Still to see:** whether it made the tokens rem, added a fourth token, and deleted the phone shrink with its undoing copies (the forecast's recommended tidy), or drilled past them. The beat-2 report shows `var(--font-size-sm)` 200 times and 8 distinct values left on Home and the task page, with literals exempted by name.

## 3 Nov, about 13:05 UTC: LIN-4110's builder answers (1a)

LIN-4110 is Done (fixed, reviewed, closed by 12:21). The full answer is on LIN-4110 under "Survey spike 1a (bug)".
- **Where it bound:**
  - Two readers poll the same `/state` URL at different cadences, and only the CI trace's timing told them apart.
  - The cause sat in test-harness state: the held set's 60 s floor was in a closure with no reset, and `routes/test.js` was never given the holder.
  - Wiring meant editing a 40-odd-parameter `createTestRoutes` line.
  - **"Reset this worker key" has no single home:** the remembered team is reset in `set-local-session` (LIN-4120), the issues memo has its own route, and each spec lists 6 to 8 `clear-*` calls by hand.
- **What it would have done first:** "a single 'reseed resets this worker key' seam that owns every per-urlKey server cache … LIN-4120 and this ticket would have been the same fix rather than two … saves a third to a half of this ticket."
- **What the ticket got wrong:** "rare, not reproduced, load-dependent" (it was deterministic, and depended on which spec ran just before); the "filter to non-GET" idea; "wait for the preview to settle".

**Against the forecast:**
- **Cause: a match.**
- **The GET warning: a match.**
- **The seam: a match,** and the builder generalised it (it owns every per-key cache).
- **The issues-memo sibling: a match.**
- **What the forecast didn't name:** the two pollers of one URL, and the 40-parameter wiring line.

**Convergence across hands:** LIN-4113's builder, the LIN-4110 Survey and LIN-4110's builder all name the same thing independently: per-worker-key test state with no single reset. With the census silent on it, it's now the best-attested tangle in the run. The builder's sized payoff ("a third to a half" of the ticket, and two past tickets would have been one fix) makes it a ready candidate for the first Survey-recommended tidy.

## 3 Nov, about 14:40 UTC: S5 waits on John's ruling

S5 (LIN-4107) has PR #2256 with CI green, after 5 stepper beats plus review. Review's verdict is **Needs Discussion** on one product decision, which is now an open ruling for John: "With no phone body shrink, Home's Change sheet puts Use at 1107px on an 844px phone screen (LIN-3987 required it on the first screen). Which holds?"

**Against the forecast (v1, 22:16):**
- **Partly a match.** The forecast recommended deleting the phone `body` shrink and its undoing copies. The builder did, and this is the bill: the phone layout's first-screen budget.
- The forecast's "bites later" warned that "em→rem shifts sizes … on pages nobody screenshots" and that the floor tests and the smallest token must agree. Those were the same family, but it **did not name the LIN-3987 first-screen pin**.
- **S4's builder had named exactly that pin** in its after-answer at 11:05 ("`lin-3987` keeps 'Use for this run' inside 844px with almost no headroom"). It's the kind of claim v2's question 5 now asks for (pixel budgets). S5's forecast was v1, written before either.
- **Another rule obeyed literally:** the plan's four-size test needed two scope rulings (exempt, exempt-narrow) and a third round of "rulings on 3 open items".

## 3 Nov, about 16:20 UTC: S5 done, and its builder's answer

S5 (LIN-4107) merged as `048c3319` after John's ruling, which dropped LIN-3987's first-screen fit, and is deployed. The builder's answer is on LIN-4107 under "Survey spike 1a".
- **Where it bound:**
  - "The type scale lived nowhere": about 48 literal `font-size` values, mostly `em`, in nine shared sheets.
  - Nothing maps selectors to the pages that render them, so it got the scope wrong twice.
  - `em` nesting compounded.
  - One global phone `body` shrink that "header, nav and Change-sheet layouts held only because of".
  - Pins on literal values and on phone layouts: three rulings mid-build.
  - "The static unit witness could not see the runtime cascade": CI went red on three E2E shards, then a bisect.
- **What it would have done first:** "a census on main: computed sizes on every page at 320, 390 and 1280px, with each selector tagged by the pages that render it", plus a pin inventory. Optionally, the nav chrome's own phone size. "Saved roughly half of beats 2 to 4."
- **What the ticket got wrong:** "four sizes through the existing token set" (three tokens, all `em`); the witness counted shared sheets, so "it measured the site, not Home"; "no phone shrink" was framed as body text when it is a global rule other layouts depend on.

**Against the forecast:** the diagnosis matches nearly point for point. The `em` compounding, the global shrink, the whole-sheet count measuring the site, the witness as computed sizes per page (the forecast's recommendation *is* the builder's "what I'd do first"), and three tokens, not four. The misses are, again, the draw-or-run class: what depended on the shrink, and the runtime cascade.


## Round 2 (3 Nov, from 17:10 UTC): the plumbing tickets, surveyed and acted on

John's idea: file the follow-ups the spikes surfaced, then run the Survey *on those tickets* and act on what it says. The tickets make asking a builder cheaper; the asking measures the tickets.

**What's new this round:** for the first time we act on the forecast. Where it recommends more than drilling, that option is written onto the ticket before dispatch. Where it says drill, the ticket goes as written. Each forecast is posted to LIN-4150 before dispatch and never edited. The Survey prompt stays at v2 for the whole round. There's no control; John accepted that, since periodicals review the overall state.

**Filed** (Backlog, Medium, written at the level of the idea, before any Survey):

| Ticket | Repo | What |
|---|---|---|
| LIN-4164 | simple-dispatcher | Keep finished sessions resumable for a week, not six hours |
| LIN-4165 | simple-dispatcher, plus Harbour's display | Every text reply a session writes reaches Harbour as dispatch feedback (John widened this from "capture a follow-up's reply": it lets us look inside a running session) |
| LIN-4166 | Harbour | A follow-up that only asks a question doesn't wake the ticket's autopilot |
| LIN-4167 | Harbour (and possibly Railway settings) | A green re-run of main's CI deploys without a manual redeploy |
| LIN-4168 | Harbour | One reset for all of a workspace key's test state (the best-attested tangle from round 1) |

**Order:** LIN-4164 first, because it lifts the six-hour limit that constrains asking the builders. LIN-4165 and LIN-4166 then make asking cheaper and quieter.

**Surveys sent 17:15 UTC** (v2, unchanged; Harbour at `048c3319a`, simple-dispatcher at `cf6369dfd`). The only addition to the usual prefix: where a ticket spans both repos, one line lets the Survey read the other repo at its own base, under the same rules. This is the Survey's first run on simple-dispatcher. Its line "a copy left behind is the commonest escaped defect" was learned on Harbour, so whether it holds there is itself a result.

**Things to hear about in the discussion (John, 17:05):** a builder's after-answer is a second place to find a tidy ("tidy after" as well as "tidy first"); follow-ups to *other* finished sessions, asking what was hard or what a perfect world would feel like, once LIN-4164 lands.

## 3 Nov, 17:45 UTC: round 2 forecasts in, options chosen, autopilots started

All five Surveys finished in about 3 to 4 minutes each. They're kept verbatim in `round-2/forecasts.md`.

| Ticket | Recommended | What we did | What to watch for |
|---|---|---|---|
| LIN-4164 (reap window) | Small tidy, then drill, in both repos | Wrote the tidy onto the ticket, plus "measure disk first" | The Harbour copy (`lib/unanswered-decisions.js`) and its test are found and reduced; the ordering assertion against `BLOCKED_REAP_MS` comes up (forecast: "the likely plan-review finding"); deploy order (simple-dispatcher before Harbour); **disk** (the Survey read the host as about 92% full with about 467 MB per clone, which may share blocks) |
| LIN-4165 (all text replies) | Small tidy (one gate), then drill, flag kept as rollback | Wrote it onto the ticket, plus "check whether the host already sets the flag" | The flag might already be on in prod; label and marker parity; cursor seeding (a session in flight posting its whole history); the silent `allow` path; feedback growth with no cap |
| LIN-4166 (quiet follow-up) | Just drill | Sent as written | The **forecast's "bites later"**: SD repoints a worker's feedback onto its newest follow-up row, so a quiet question to a live worker would swallow its later `[done]`. Also liveness counting a question as an answer to a `[pending]`. We didn't pass either warning on, so whether they bite is a clean test |
| LIN-4167 (deploy on green re-run) | Just drill | Sent as written (it already says "say what John would need to change") | A prerequisite only John can meet (a Railway token as an Actions secret, plus IDs); the head guard against re-running an old commit; the deploy-SHA footer |
| LIN-4168 (one test reset) | Consolidate (a per-key reset registry with a guard test) | Wrote it onto the ticket | Two plan-review rounds (scope, then enforcement); "refill, not clear" for task facts; the issues memo is keyed by workspace id, not urlKey |

**Honest note on the method.** Where the Survey said drill, we didn't pass its warnings to the builder, even good ones. That keeps the test clean: if LIN-4166's warning bites, the forecast saw it and the drill didn't. Where we acted, we passed the option and its main reason, not the whole forecast.

**First look at the Survey on simple-dispatcher:** both forecasts read as well grounded as Harbour's. LIN-4165's opening ("it mostly exists") is the sort of finding that changes the size of a ticket before it starts.
