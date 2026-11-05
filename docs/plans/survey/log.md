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

## 3 Nov, 18:15 UTC: half an hour in

- **John on disk (17:50):** the filesystem shares unedited files between clones, and most of the host's used space is personal data. Fine for tonight.
- **LIN-4164's research measured disk and changed the shape of the ticket.** Real disk per finished session is about 45–50 MB, not the 467 MB `du` shows (the Survey's caveat about shared blocks was right). But at 130–240 sessions a day, a week of clones is still 44–80 GB against 77 GB free, so it doesn't fit. The plan took the option the Survey priced as "large, only worth it if disk bites": **keep the record for 7 days, drop the clone at 6 h, and re-clone at the same path on resume**. It spiked `claude --resume` across a deleted and recreated cwd, and it works.
  - **Question 5 paid off twice.** The Survey's unchecked list said to measure disk first and to "time `updateState` on a 1,000-record fixture". Research did both. The second found `sessions.json` growing about 20× (57–98 ms per read, parse and write), mostly from `dispatchedPrompt`, which a resume always overwrites. It's cleared at clone reap.
  - The plan was approved in one round, as forecast ("one round, two at most"). The ordering assertion against `BLOCKED_REAP_MS` came up, as forecast. The tidy is its own first subtask (LIN-4170). Harbour's copy is the last subtask (LIN-4173), gated on simple-dispatcher's deploy: the forecast's "deploy order".
  - **Ruling for John:** the clone window (6 h recommended, or 24 h for about 8 GB more at peak).
- **LIN-4165** already has a PR (simple-dispatcher #302).
- **LIN-4166 and LIN-4168** have plan-review verdicts.
- **LIN-4167's ruling** offers only the Actions-secret route (A: a re-run deploy job; B: CI owns every deploy; or no). It found a prior record ("no CI workflow uses a Railway token", the 22 Oct incident) that this would reverse. The host-side route, where the agent's Railway CLI deploys when it sees a green re-run that didn't ship, wasn't offered: the builders don't know the CLI is there.

## 3 Nov, 19:05 UTC: two tickets Done, and the first quiet questions

**John's rulings (18:20 to 18:40):** LIN-4164's clone window is **24 h** (John then cleared space: 180 GB free). LIN-4167 is **"No: keep the manual redeploy after green re-runs"**. John: "it is a sign of grit in the gears, so warrants human attention." That's an outcome the menu doesn't have. Sometimes the difficulty is useful and should stay visible.

**LIN-4166 (quiet follow-up): Done, deployed 18:48** (PR #2258, `7797c306`). Against its forecast:
- **The forecast advised against the design that shipped.** It said "Not `subscription`: adding `'none'` would overload the enum." The builder extended `subscription` with `'none'` anyway, and plan review approved it. The forecast's worry was leaking into kickoff/recommend validation; the build refuses `'none'` without `followUpTo` and pins the recommend lane with a test. It's a judgement call rather than a miss, and the builder's answer may say why.
- **The forecast's "bites later" was seen by review and documented, not guarded.** The close-out's design note: "a `none` follow-up to a worker its autopilot is still parked on silences that worker's real terminal; the docs say so." The forecast suggested refusing the flag unless the target row is terminal. We didn't pass the warning on; the pipeline found it by itself, and chose docs over a guard.
- **The forecast's named follow-on was filed:** "the other follow-up producers can't set the flag (the reply box, chat-tools `send_follow_up`)" became LIN-4174.
- One plan-review round, as forecast.
- The close-out left the live check "not run: the close-out token has no dispatch grant".

**LIN-4168 (one test reset): Done** (PR #2259, `42fcf5d1`), about an hour end to end. It was built as the Survey's consolidate: holders register a reset, a census scan fails on an unregistered holder, and the database-backed stores were kept out, as advised. Review found three more holders the census couldn't see, and all three were fixed with the census widened. The forecast said two plan-review rounds; it took one.

**The after-questions, sent 19:03 as LIN-4166's first live use.** Both 1a questions went with `subscription:'none'`, which makes them LIN-4166's live witness. The dispatch read view shows `subscription: null` on both rows. The proxy lane does list the field (`lib/dispatch-entrance.js:415`), so this is probably the read view not showing it. The proof is whether a `kind:'wake'` row appears on the lineage after each answer lands.

**Open ruling for John:** LIN-4165's close-out was stopped by a safety classifier ("probably because I printed other tickets' oplog text"). It asks to finish reading only counts and cursors.

## 3 Nov, about 19:15 UTC: LIN-4166 works live, and the two builders' answers

**The quiet follow-up works on real traffic.** Both 1a questions (sent 19:01 with `subscription:'none'`) finished by 19:03 and posted their answers. Neither lineage has a `kind:'wake'` row after them; in round 1 a wake followed every follow-up within seconds. That's the live check LIN-4166's close-out left "not run", done by the first thing that needed it. (The dispatch read view still shows `subscription: null`, so the read view doesn't expose the field. That's minor and not filed.)

**LIN-4166's builder, against the forecast.**
- *Difficulty:* "It wasn't, much." The forecast said "Difficult? No." It matches.
- *Where it bound:* kickoff spreads `body`, so a stray `followUpTo` would have passed the new rule. The plan missed it, plan review caught it, and the forecast didn't name it. The builder also found two pinned message tests and a test using `'none'` as its *invalid* example; the forecast named the pinned shape tests but not that one. Then there's the enum repeated in prose (about seven places).
- *What it would have done first:* a small tidy, making one "has `followUpTo`" predicate in place of four inline copies: "perhaps ten minutes and one way to drift". The forecast named a different hand-written copy (`ROW_KEYS.proxy`) and recommended drilling. Same kind of thing (a copy the drill leaves), different instance.
- It doesn't say why it chose `subscription` over a new field; research and plan review settled that before the build.

**LIN-4168's builder, against the forecast.**
- *Difficulty:* "Nothing had a per-key interface": six different key shapes, hidden instances (router default-deps, a module const), and "the census was most of the work" (97 containers classified). The forecast's three hard questions were scope, refill-not-clear and enforcement ("a list, even a central one, is still a list"). The last of these is the one that cost the most. The forecast also flagged the issues memo's key, which the builder moved into a module.
- *What it would have done first:* "give every in-memory cache one shape, `clear(urlKey)` plus `countFor(urlKey)`, over one key-prefix convention … roughly a third of this diff". That's a *smaller* tidy than the Survey's recommendation, and a different one from the Survey's own "small tidy" (merge the three inline resets). The forecast saw the varied shapes but didn't offer "make them one shape" as the tidy.
- *What the plan got wrong:* a seam the plan and review both said doesn't save a session does. The census's blind spots (plain objects, `let` caches). Holders missing from the table. "Probe is 0 after reset" contradicts the refill, which is the tension the forecast named.

**Reading across both.** The forecasts got the difficulty level right on both. On LIN-4168 they had the right hard part, enforcement. In both cases the builder's "what I'd have done first" is a uniform-interface tidy: *one predicate* (LIN-4166), *one shape* (LIN-4168). The Survey's menu tends to frame a tidy as gathering copies, and doesn't offer "give these things one interface". It's worth raising in the discussion, not as a prompt change mid-round.

## 3 Nov, 19:30 UTC: a side arm, the open Survey (open-0)

**Why.** Both builders' "what I'd have done first" was a uniform-interface tidy (one predicate, one shape). v2's menu frames a tidy as gathering copies, and its v2 line "name every copy … the commonest escaped defect" pushes further that way. John: "perhaps our prompt is too guiding?"

**What.** open-0 (in `prompt.md`) keeps the read-only, where-to-stand and no-future rules, and asks one thing: *why will this be difficult, and what, if anything, would you do first?* It has no menu, no checklist and no Harbour specifics, and it's under 500 words. It ran on the same five tickets at the same bases, with the original ticket text (without the "How to go about it" sections added after v2). Sent 19:28 UTC. v2 stays the round's prompt; this is a comparison only.

**What we'll compare.** Does open-0 find the one-shape tidies the builders named? Does it lose what v2's guidance bought: the copy-hunting (the pill tables, Harbour's reap-window copy), the "couldn't check" list (disk, `updateState` timing)? My guess beforehand: each finds things the other misses.

**For the discussion (John, 19:25):** "We want a pretty free form answer, and the temptation will be to specialise for Harbour as that's the shape of the code we're working with." v2 has already drifted that way: its examples are Harbour's (CSS and pixel budgets, browser and server). A Survey that works everywhere would ask the open question and let the codebase answer.

**Also for the discussion:** follow-ups are now cheap and quiet, so the builder question could gain a couple of equally open questions: *tidy after* ("now that it's done, what would you tidy, and why?") and *a perfect world* ("if this area were how you'd want it, what would this ticket have been?"). We should stop well short of a questionnaire.

## 3 Nov, 19:45 UTC: open-0 against v2 (and against what happened)

All five open-0 runs were posted to LIN-4150 at 432–517 words and are kept in the scratchpad. A short reading per ticket:

| Ticket | What open-0 saw that v2 didn't | What v2 saw that open-0 didn't | Its "what I'd do first" | Against what happened |
|---|---|---|---|---|
| LIN-4164 | It made **disk the deciding question**: measure one clone's real cost with `df`, and "that number picks the path", small (raise the constant) or large (the split, which needs re-clone first) | The test-constant tidy (which became LIN-4170) | Measure | It's what happened. Research measured, and the number picked the split with re-clone first. v2 had priced the split as "only if disk bites" |
| LIN-4165 | It **read the live `.env`** (the flag is off; v2 listed this as "couldn't check"); Harbour's **100/min per-IP feedback rate limit**, which non-terminal posts don't retry, so a burst could starve `[done]`; text arrives only at Stop boundaries, not "as it goes" | The one-gate tidy | An experiment: turn the flag on for one workspace and run one real follow-up | Still in review. Watch for the rate limit |
| LIN-4166 | A follow-up chained *through* a muted row must still wake; mute all four outcomes; a distinct `nullWakeReason`; who sets the flag | The parked-worker swallow warning; `ROW_KEYS.proxy` | Write the failing store test first | The builder muted all four, tested the chained case, added reason `unsubscribed-follow-up`, and the producers became LIN-4174. Both forecasts advised against `subscription`; the builder used it |
| LIN-4167 | The **22 Oct record** that CI holds no secrets (the supply-chain review and incident), which the research then also found and the ruling cited | (similar ground) | **Ask John one question: (A) change nothing, or (B) move the deploy into Actions** | **John chose (A).** v2 recommended adding the token step |
| LIN-4168 | **`taskDoneCache` hidden inside `createDashboardRoutes`**, which the builder named; "there is no single workspace key yet" | The trio-merge tidy | Inventory before code, then a registry pinned by a test | The builder: "nothing had a per-key interface", "the census was most of the work", the dashboard done cache pulled out |

**Reading it.** On these five, the open question did at least as well as v2, and on three it did better: LIN-4164's deciding measurement, LIN-4167's ruling, LIN-4168's hidden holder. It lost v2's tidy recommendations and one sharp warning (LIN-4166's parked worker).

The bigger difference is **what "do first" means.** Asked openly, it never chose a tidy. It chose a *preparation*: measure, experiment, write the failing test, take the inventory, ask John. That's "forecast, then prepare" (the TDD switch), arriving unprompted. v2's menu turns "first" into "which size of tidy".

It also didn't find the builders' one-shape tidies, though LIN-4168's "no single workspace key yet" is close to the builder's "nothing had a per-key interface". So the "make these one shape" gap isn't only the menu's doing.

**Caveats.** Five tickets, one run each, the same model. open-0 ran 70 minutes after v2. Its rules put LIN-4150 and anything after the base off limits, but the v2 forecasts were sitting there. I didn't check whether any run looked; nothing in the answers suggests it.

**For the discussion.** A shorter, open Survey with no Harbour specifics may be the better default. The question is whether to keep anything from v2: perhaps the "what couldn't you check, and how could the builder check it early" line, which earned its place on LIN-4110 and LIN-4164. On LIN-4165, though, open-0 simply went and checked.

## 3 Nov, about 19:55 UTC: LIN-4165 done, and its builder's answer comes back as feedback

**LIN-4165 is Done** (simple-dispatcher PR #302, then #304, `c3b9ca8`, deployed 18:49). Its own post-deploy live check found a duplicate-post bug: a self-check's text posted again after the flush. A bug cycle in the same lineage fixed it. The close-out's live tally since the restart was 94 assistant-text posts across 14 items, with 0 repeats and 0 failed posts. So **open-0's rate-limit risk hasn't bitten at today's volume.**

**Our tail, eaten twice.** The 1a question to LIN-4165's builder (19:48, `subscription:'none'`) is the first after-question whose words came back *as dispatch feedback*. The `assistant-text` entries carry the session's own replies, including the `[onboarding]` label (the parity v2 asked for). No wake followed. So LIN-4165 and LIN-4166 both work together on their first real use.

**The builder, against both forecasts.**
- *Difficulty:* "moderately hard, and harder than 'flip a default' suggests". v2 said "Low"; open-0 said "the difficult part is turning it on safely". The worst part was a cursor position collision: the delta path's synthetic append recorded the turn at a position that matched the next real block, so that block would have been dropped by the dedupe. The builder's no-replay test caught it. v2 had named the cursor, but as "starts at 0, replays history", which was a different problem in the same place.
- *Tests pinning the old shape:* v2 named `assistant-text-relay.test.js` and the ordering pins. That's a hit.
- *"The plan didn't flag the last-entry readers":* **open-0 named exactly this** ("check every reader that treats the last entry as the status"). v2 named the related Harbour readers.
- *What it would have done first:* "a single 'post this text with label/marker' helper shared by `postTurnText` and the delta path … roughly a third of the reasoning and diff." Of the one-gate tidy v2 recommended, the builder said "cheap and fine".

**The pattern is now three for three.** All three builders asked so far (LIN-4166, LIN-4168, LIN-4165) named a *one-interface* tidy as what they'd have done first: one predicate, one cache shape, one posting helper. Each saved, by their estimate, between "ten minutes" and "a third of the diff". Neither Survey version offered one. v2 offered "gather copies of a decision", open-0 offered "prepare". The question "which things here do the same job through different interfaces?" is the one nobody asks before the work.

**A loose end, as data.** LIN-4167 is still In Progress. John ruled "no: keep it manual", the ruling was recorded as a comment, and its autopilot had already ended at 18:18. So nothing closed the ticket. A "no" leaves a ticket with no owner. That's a small piece of grit in the gears.

## Round 3 (3 Nov, from 21:00 UTC, overnight): Costs, closing the loop

**John's goal:** "closing the loop on tracking costs and tokens", run overnight through this process.

**The ground.** LIN-3936 is the Costs record (goal: every model call's tokens and cost tracked simply and reliably, in easy-to-maintain code). `docs/plans/costs.md` is the design. The LIN-4126 review maps it. Tidies 1 to 5 gave the pieces one owner each. The review's path from here:
1. **one cost read that every surface asks** (consolidate the readers);
2. **the per-request usage ledger** (producers post one record per model request; this prices Haiku 5.5, counts subagents, and lets each call carry its issue, which the product choices after tidy 5 point to).

The "Rebuild 1" drafted on 2 Nov wasn't filed and couldn't be found, so it was rewritten from `costs.md` and the tidy-5 note, against the bar for a Costs ticket (goal, context, this step and why, done when, no how, permission, report-back headings).

**Filed:** **LIN-4176**, "Costs rebuild 1: one cost read that every surface asks" (under LIN-3936). Alongside it, the existing **LIN-4127** (the runner relays worker usage by default; simple-dispatcher).

**How round 3 runs.**
- **The Survey is open-0, unchanged,** for a second sample before any tuning. Tuning on five tickets would be fitting noise.
- **Acting on it:** open-0's "do first" is usually a preparation (measure, experiment, inventory, the failing test, ask John). That preparation is written onto the ticket.
- **The after-question gains John's two,** kept as open as the rest (template below): *what would you tidy now*, and *if this area were how you'd want it, what would this ticket have been?*
- **The Costs stream's own rhythm continues:** after each step, a note on LIN-3936 (what changed; is the code better; what the ticket got wrong; what still differs), and the bar is revised from evidence.
- **Next steps come from each report-back:** Rebuild 2 (the ledger) gets written after Rebuild 1 reports.

The round-3 after-question:

```
A short, read-only follow-up for research (the Survey; see docs/plans/survey.md on branch claude/cool-rubin-6acj5j of LinearViewer). Your build work on {TICKET} is finished ({MERGED}). Please do NOT change any code, branches, pull requests, ticket fields or state. The ONLY thing to write is one new comment on {TICKET}, starting with the heading "## Survey 1a (round 3)". Don't read LIN-4150 or other tickets' Survey comments first.

Looking back from where you stood while doing this work, answer in that comment:

1. Why was this difficult? Where did the change bind, and what did it have to push through or work around to land? If it wasn't difficult, say so plainly.
2. Before you started, what would you have done first, if anything?
3. Now that it's done, what would you tidy, and why?
4. If this area of code were how you'd want it, what would this ticket have been?
5. What did the ticket (or the plan you were given) get wrong, if anything?

Answer from your own experience of the work, in your own way. Under 450 words.
```

## 3 Nov, 21:18 UTC: round 3 forecasts, acted on, autopilots started

Both open-0 runs (kept in `round-3/forecasts.md`) chose a **preparation** for "do first", as in round 2.

- **LIN-4176 (rebuild 1):** "'One read' has to answer different questions over different populations": per issue, per job over 30 days, the newest N rows with no time bound, by lineage start day, by `[done]` lineage, per loop group. "That is the real design work." It also named:
  - three input shapes (formatted rows, the KPI Mongo projection, loops);
  - the call log's second attribution rule;
  - `summarize` still folding null to 0;
  - before/after proof that drifts to live data without captured fixtures (tidy 3's lesson);
  - the tidy-5 baseline (114 of 198 issues with no lineage);
  - LIN-4148 surviving any shared read that keeps a row cap;
  - about 15 readers, "unlikely to review in one sitting as one PR".

  *Do first:* a reader table plus each surface's output captured on one fixed set of rows as the "before". Then settle "in period", LIN-4148 and the `/kpis` label up front.
- **LIN-4127 (usage relay default on):** it *ran the unit suite* with and without the change (46 host-caused failures either way; +1, the test the ticket rewrites). It named:
  - the parse idiom flipping `''` and garbage to *on*, against a test that says *off*;
  - OpenCode gated by the same flag;
  - a **witness ordering trap**: the host's `.env` already sets the stopgap `=1`, so the witness means removing a line that keeps usage flowing. Merge, pull, *then* remove it, or usage goes dark again.

  *Do first:* settle the polarity in a test, and plan the witness as a procedure.

**What we wrote onto the tickets:** each one's preparation, as advised. One judgement of mine: for LIN-4176, the `/kpis` label question was closed up front ("`/kpis` keeps what it counts today", already out of scope in `costs.md`), rather than left as a ruling that would hold the ticket overnight. Kicked off 21:18.

## 3 Nov, about 21:30 UTC: LIN-4164 done, and its two core builders' answers

**LIN-4164 is Done** (SD `6060e4f`, `0c2bdd4`, `5379817`; Harbour `9e397e6b`). Records are kept 7 days; clone and TMPDIR are pruned at 24 h (John's ruling); a resume re-clones at the same path. The close-out's live checks are "NOT RUN" until a record passes the 24 h clone window, the earliest **about 20:10 UTC on 4 Nov**. *A follow-up sent after that to a session that finished before 20:10 on 3 Nov would be the live re-clone check.* That's the next bit of tail to eat.

**LIN-4171's builder (re-clone on resume).**
- "The code change itself was not hard." The real bind was elsewhere: whether a failed launch ends visibly FAILED isn't decided in the guard, but by the terminal driver reporting success on the window write. That became LIN-4175.
- The witness only runs on macOS (`cp -c`), and CI is Linux, so "CI green says nothing about the failure path". That's the draw-or-run class, in a new form.
- *First:* "read how a launch failure surfaces … about ten minutes of reading". A preparation, like open-0's.
- Neither forecast named the launch-visibility gap. Both named the split as needing re-clone first.

**LIN-4172's builder (split reap).**
- "Record and clone die together" lived in one selector loop shared by several invariants (LIN-459, LIN-3585, the clone-root bound, opencode). The cheap skip had to be re-derived.
- Pins: `blocked-reap`'s strict `>` (**both forecasts named this**). The prompt trim's safety "isn't local" (v2 and open-0 both said to time and think about `sessions.json`). It also found records with no `templateDir` (plan review had flagged that `templateDir` isn't passed on resume).
- *First:* "extract cleanup eligibility … into a pure selector returning the record and clone candidate sets … roughly a third off the work". **Another one-interface tidy:** four of the five round-2 builders asked named one.

**Friction that recurs across builders, noticed and not required.** Three things came up in more than one answer tonight:
- **simple-dispatcher's `main` isn't green on the host:** a pre-existing `git-launch-probe` failure, so every result needs a diff against the failing names on base (LIN-4165, LIN-4171, LIN-4172, and the LIN-4127 Survey counted 46 host-caused failures).
- **`test:system` defaults `HARBOUR_DIR` to `/home/user/LinearViewer`,** and fails with `spawn node ENOENT` on the host (LIN-4165, LIN-4172).
- **CI is Linux, and the macOS-only witnesses can't run there** (LIN-4171).

These are exactly the essay's "noticed, not required": each builder paid for them, worked around them and moved on. They aren't filed. They're for John.

## 3 Nov, about 22:20 UTC: LIN-4127 done, the first round-3 answer, and LIN-4176 under way

**LIN-4127 is Done** (simple-dispatcher PR #307, `600f1be`). **Its live witness followed the Survey's ordering exactly**: `git pull` on the host, back up `.env`, remove the stopgap line, then show the flag absent and quote the first `[usage]` `feedback.post` after the removal. That's the trap open-0 named ("in the other order usage goes dark again"), avoided by writing the preparation onto the ticket. It is the cleanest case yet of acting on a forecast.

**Its builder, with the round-3 questions** (answered in about 3 minutes):
- *Difficult?* "It wasn't, as a change … the work went into proving it." There was no reusable way to drive the hook's `main()` in a test (about 100 lines copied), ambient env, and a noisy system suite (4 failures on the branch against 16 on `main`, with different counts).
- *First:* run both suites on untouched `main` under the same conditions.
- *Tidy now* (John's new question): a shared `main()`-driving test helper; **one `envFlag(name, defaultOn)` helper**, because "the 'what counts as off' decision only existed because default-on and default-off flags parse differently"; and make the `HARBOUR_DIR` default fail clearly. **That's the third builder to name `HARBOUR_DIR`.**
- *If the area were how you'd want it* (John's other new question): "a one-word default change plus a roughly 20-line witness test. No parse decision, no copied harness, a short PR." This is the sharpest statement yet of what the mess costs a small ticket: the gap between that sentence and what the ticket became.
- *What the ticket got wrong:* "Done when" asked an implementation session for a post-merge live witness. "The done criterion and the implementer's remit don't line up", so it should be its own step with a named owner. Close-out did it here, but the builder's point stands.

**Against the forecast:** the polarity decision (named: hit), OpenCode gated by the same flag (named; waived at close-out, with a named monitor), and the witness ordering (named, and followed). Not named: the missing hook test harness, which was the actual cost. The one-interface pattern shows again, this time as the polarity question: open-0 named the *symptom* ("the parse idiom changes what counts as off"), and the builder named the *shape* (one flag helper).

**LIN-4176 (rebuild 1):** research, **two plan-review rounds**, then a breakdown into three subtasks (LIN-4177 in progress, LIN-4178 and LIN-4179 Todo). open-0 suggested "consider two PRs"; it became three. It gave no round count.

## 3 Nov, 22:26 UTC: quality-of-life tickets from the builders' friction

**John (22:20):** "Happy for you to file and dispatch a few small tickets to address these quality of life issues as we go … we can continue to use the survey."

Each ticket is a friction that more than one builder paid for and moved past ("noticed, not required"). Two of them are the one-interface tidies the builders named, done on their own:

| Ticket | Friction | Named by |
|---|---|---|
| LIN-4180 | `test:system` defaults `HARBOUR_DIR` to a missing path and fails as `spawn node ENOENT` | LIN-4165, LIN-4172 and LIN-4127's builders |
| LIN-4181 | untouched `main` isn't green on the runner host (46 failures from the host, per the LIN-4127 Survey), so every builder diffs a baseline by hand | LIN-4165, LIN-4171 and LIN-4172's builders |
| LIN-4182 | each on/off setting parses its env var its own way ("one `envFlag` helper") | LIN-4127's builder (LIN-4165 hit it too) |
| LIN-4183 | no shared way to drive the Stop hook's `main()` in a test (about 100 lines copied) | LIN-4127's builder |

They were filed at the level of the idea, in simple-dispatcher. Surveyed with open-0 at SD `600f1be1c` (22:26), then acted on as usual. This closes the loop the essay describes: the builders' after-answers become the next tickets.

## 3 Nov, 22:40 UTC: the quality-of-life forecasts, acted on

All four open-0 runs are in `round-3/forecasts.md`. Two of them ran the suite themselves. All four "do first" steps were preparations again: a resolver with a unit test, a baseline table, a characterisation table, a pass-count baseline.

- **LIN-4180 (system suite can't find Harbour):**
  - It reproduced the `spawn node ENOENT`. The default is copied in the mutation runner and two docs. "Found but can't run" waits 45 s. The message would print about 24 times, because the files run in parallel.
  - On finding a checkout automatically: worktrees, the leak trap, and the **mutation runner**, which edits Harbour's source and reverts it, so it must stay on an explicit `HARBOUR_DIR` and never touch a live sibling.
  - *First:* a pure `resolveHarbourDir` with a unit test.
- **LIN-4181 (clean main on the host):**
  - **It corrected the ticket.** At one commit, in one hour, the failure count was 1 (workspace clone), 4 (`/tmp` worktree) or 119 (`TMPDIR` inside `state/`, which is where this host puts session temp). "None is 46, so the 3 Nov baseline came from an unrecorded location." I took the 46 from the LIN-4127 Survey and put it on the ticket. The Survey on that very ticket showed the number depends on where you stand.
  - Causes: the test isolation doesn't pin the workspace clone root, the run root can sit inside `state/`, and one test asserts that the host's git fault *still exists*.
  - *First:* the baseline table, posted on the ticket.
- **LIN-4182 (one on/off parser):**
  - 16 parsers, some outside `config.js`. "The two idioms already follow one rule", so a plain `parseFlag(raw, default)` keeps today's behaviour exactly.
  - Two traps. A "smarter" helper would change garbage for default-on flags. And importing the helper from `config.js` would make modules that deliberately avoid it start loading `.env`, an unnamed behaviour change.
  - *First:* a characterisation table across all 16 sites.
- **LIN-4183 (one Stop-hook test driver):**
  - "It isn't one copy; it's 17 copies that have drifted." About two thirds match, and the rest need seams (an un-awaited start, a fetch override).
  - Require-time ordering matters. The helper has to restore every patch under two preloaded traps. It's "easy to break without noticing" (a refire exemption, a seeded tool line).
  - *First:* a baseline of names and pass counts, then migrate the close copies first.

**What we did:** wrote each preparation onto its ticket. **Staggered:** LIN-4180 and LIN-4181 kicked off at 22:38. LIN-4182 and LIN-4183 stay in Backlog until LIN-4181 lands, because both lean on the test isolation it fixes, and a clean baseline makes their own before/after comparisons honest.

**On the forecasts' size:** LIN-4182 and LIN-4183 each found the ticket's "copies" to be several times more numerous than the ticket implied (16 parsers, not "each flag in `config.js`"; 17 drifting copies, not "each test copies"). That's the census the builders said they'd have wanted first, done before the work.

## 3 Nov, about 23:10 UTC: LIN-4180 done, and its builder's answer; LIN-4176's own calls

**LIN-4180 is Done** (SD PR #308, `0992f39`). The Survey's warning was kept: the mutation runner is explicit-only. Close-out exercised it against a *throwaway copy* of Harbour, so no live checkout was edited.

**Its builder (round-3 questions):**
- *Difficult?* "Mostly it wasn't … the plan was accurate." It bound at module-load ordering in the mutation runner and at the leak-trap contract. "The real cost was something else": once Harbour was found, 4 of 117 system tests failed against the sibling, and proving they fail on `main` too "took longer than the change itself".
- *First:* run the system suite on `main` before touching anything. **That's the third builder tonight whose "first" is "take the baseline"** (LIN-4127, LIN-4180, and LIN-4181's Survey made it the whole first step).
- *Tidy now:* an unused export, splitting the pure resolver from the fs probe, a matching commit line, and a docs sentence on relative paths. All small.
- *If the area were how you'd want it:* "the system suite would have one entry point that owns its environment from the start: where Harbour is, and which Harbour. Then this ticket would have been one line." And: "the suite should declare which Harbour it needs, so 'found' and 'the right version' aren't two different things."
- *What the ticket got wrong:* "'it runs' was true, but running isn't passing."

**Against the forecast:** the Survey said to "print the resolved path and its `HEAD` so each result can be traced to a commit". The builder: "the plan printed the commit because nothing defines the right version. That turned out to matter at once." That's a hit, and it opened the next question (which Harbour?). The Survey's "say it once, not 24 times", the explicit-only mutation runner, and the unit-tested pure resolver all landed as advised.

**LIN-4176 (rebuild 1):** piece 1 (LIN-4177, PR #2261) is in re-review. The builder made two calls the plan hadn't, measured them on the replay, and recorded them on LIN-4176 rather than raising a ruling:
- a straddling session's time stays the earliest fetched member's, because the founder's time would have turned a 68 s mean duration into about 24 h;
- `durationMs` stays on the read, because the S1 wire must not change.

The replay's change list carries both. That's the "capture each surface's output as the before" preparation earning its keep: a measured comparison settled a design choice overnight without waiting for John.

## 3 Nov, 23:50 UTC: progress

- **LIN-4177 (rebuild 1, piece 1) is Done**: merged and deployed as `10b2c82f` (PR #2261). Goldens are recorded for surfaces S1–S13.
- **LIN-4178 (piece 2)** is in review (PR #2262). Its course corrections show the golden replay at work:
  - S11's golden had been recorded on unfiltered rows when production reads only the 30-day horizon, so it was re-recorded on production's input.
  - An incomplete opencode straddler is no longer priced.
  - S12 keeps today's population. Moving its window would need John's ruling, so it's **noted for the morning, not raised as a ruling**.
  - The founder lookup was timed on a real mongod at 20k, 80k and 200k lineages, with a narrowed fallback ready.
  - Four old reducers were deleted, and an all-unpriced `$0.00` now shows as `-`.
- **LIN-4181** posted its baseline table: A, a workspace clone (1 failure, the git-probe precondition); B, `/tmp` (4 failures plus 704 leaks); C, `TMPDIR` in `state/` (119 failures). This **confirms the Survey's table almost exactly** (1 / 4 / 119). The "46" can't be traced: no location gives it. In the system suite, the 4 failures are the same ones LIN-4180's builder saw. A PR revision is in progress (#309).

## 4 Nov, about 00:45 UTC: LIN-4181 done, clean main on the host, and its builder's answer

**LIN-4181 is Done** (SD PR #309, `11a1279`). **On the runner host, `npm test` on merged `main` gives 3859 tests, 0 fail, 5 skipped (each with its reason, the git-probe one included), 0 leaks.** The system suite now gives 119 tests / 4 fail / 0 leaks in all three locations (before: 117/4, 129/16, and C unmeasured). The four remaining system failures fail identically on clean `main` and at three Harbour commits, so they aren't noise. Their cause is unknown, and they were filed as a follow-up.

The fix followed the Survey's reading: pin the clone root into the run root, keep the run root out of `state/`, and gate the git probe on its precondition. One real defect came from it: **pinning `WORKSPACE_CLONE_ROOT` in the shared preload silently disabled the LIN-558 guard** (which returned early on that variable). Review found it by mutation. Neither the Survey nor the plan saw it.

**The builder (third pass; "I mostly saw the end state"):**
- *Where it bound:* "The shared test preload. Any env var it pins reaches every test." The system suite depends on host state: fixed ports colliding with orphaned servers, and the Harbour checkout moving three times during the ticket, so "same Harbour" was never held fixed. That's LIN-4180's builder's point again: "which Harbour?".
- *First:* check `mergeable` on the PR. A conflicting PR starts no CI run, and the pass before read that as slow CI.
- *Tidy now:* script the A/B/C baseline (by hand it "got it slightly wrong"), give the system suite ephemeral ports, and ticket the four failures. It also **corrected its own comment**: two claims there were inherited from the previous pass, not re-run.
- *If the area were how you'd want it:* "If config exposed defaults apart from env-resolved values, the harness derived every path root from the run root in one place, and the system harness owned its ports and children, this ticket would have been 'add the clone root to the run-root list', or nothing." **Another one-owner answer.**
- *What the plan got wrong:* "fits one session" (it took three passes plus a conflict). It missed that an env pin can make a guard vacuous. And it named a Harbour commit without pinning it.

**LIN-4182 and LIN-4183 kicked off 00:34**, now that the baseline is clean. Their before/after comparisons start from 0 failures.

**Costs:** LIN-4178 (piece 2) is Done and deployed (`0dc1620e`). S11–S13 now read from `lib/cost-read.js`. LIN-4179 (piece 3) is in progress. The builders of pieces 1 and 2 will be asked once LIN-4176's lineage ends. With records now kept 7 days (LIN-4164), there's no hurry, and waiting keeps to the rule (never follow up inside a running lineage; LIN-4166's parked-worker caveat).

## 4 Nov, about 01:30 UTC: rebuild 1 done, five builders' answers, rebuild 2 surveyed and started

### Rebuild 1 (LIN-4176) is Done

Three pieces: LIN-4177 (#2261, `10b2c82f`), LIN-4178 (#2262, `0dc1620e`), LIN-4179 (#2263, `72305215`).
- **What it built:** one cost read (`lib/cost-read.js`) with a founder lookup (which settles LIN-4148); one figure rule ("priced sum plus coverage, never $0 for unknown"); one USD formatter; census, agreement and parity tests.
- **What it deleted:** six engines and folds.
- **Live after deploy:** `/cost` returns `null` plus `unpriced: ["claude-haiku-5-5"]` and a partial priced sum where it used to say $0. The re-sweep read 227 of 227 issues, losing no figure and putting no lineage under two issues.
- **Not run:** three checks need an operator (a production-store tally, cold `/kpis` timing, a signed-in browser check). They're on the PR.
- The **note after rebuild 1** is posted on LIN-3936, in the stream's format.

**Against its Survey.** "'One read' has to answer different questions over different populations … that is the real design work." That held: the plan's W4 ("every surface agrees") was dropped because the surfaces count different populations by design, and the run page still windows differently (LIN-4191). "Capture each surface's output … as the 'before'" became the goldens for S1–S13, which every builder relied on. Two plan-review rounds, three PRs; the Survey had said "consider two PRs".

**The bar's "follow-ups listed, not filed" was ignored again.** Close-out filed LIN-4191 to LIN-4194, as tidy 5's did. A bar line hasn't reached the close-out stage in two tickets running. The note on LIN-3936 asks whether the line belongs at all, rather than adding a stronger one.

### Five builders' answers (round-3 questions, all sent with `subscription:'none'` at 01:22, all answered within about 4 minutes)

- **LIN-4177 (piece 1):** "The core read was not the hard part. The hard part was proving it." Goldens at the base, seven surface shapes (it wrote a Mongo-style matcher), stubs that couldn't express a founder outside the window. *If the area were how you'd want it:* "One cost module with a store adapter and thin surface callers, plus a replay harness already in the tree … add the founder lookup to the adapter and show the replay diff."
- **LIN-4178 (piece 2):** "the work was making tests that could actually fail." **The replay's change list only *allowed* differences and never *required* them, so a reverted fix still passed.** A witness's corpus lacked the case it depended on. *First:* run the reviewer's mutations against the new tests before writing more, and check that the corpus holds each case. *If:* "the change list would be a two-way spec with after-values."
- **LIN-4179 (piece 3):** "The cost arithmetic was the easy part … the change got stuck in the plumbing around it." The browser scripts have no module graph, so "one formatter" became a copy plus a parity test, touching six pages and a byte golden. "'One formatter' forced a visible choice nobody had made" (`$0.00` against `$0.0000`). *If:* "An hour's work: the formatter would already be one importable module."
- **LIN-4182 (one flag parser):** "It mostly wasn't [difficult]. The plan had already done the hard part: it established that both idioms follow one rule, so the helper could be dumb." **That's the Survey's finding, credited by the builder.** The real bind: four `watch-restart` fixtures copy `instance-guard.js` alone, so adding a require broke them, found by a full-suite failure. *If:* "The helper should have appeared when the second boolean flag was written. Every 'same idiom as X, copied verbatim' comment was a note that it hadn't."
- **LIN-4183 (one Stop-hook driver):** proving the migration kept every check; the builder wrote a wire comparator, which caught one real drift. "The change bound on `hook.js` having no seams." *If:* **"Give `main()` a seam: `main({ input, fetch, tokenFor, exit, stateFile })`. The test driver would then be ten lines."** The Survey's warnings about load-bearing defaults were "exactly right and worth the warning". It got wrong which file was the divergent one.

**Reading across the five.**
- **Proving costs more than changing.** Every Costs builder said so. The Survey's "capture the before first" was the right preparation, and the builders' lessons sharpen it: the before must be a *two-way* spec, and the corpus must *contain* each case.
- **"If the area were how you'd want it" always names one owner or one seam:** one cost module plus adapter, a two-way change list, one importable formatter, a helper at the second flag, a seam on `main()`. That's now ten of ten builders asked, across both repos. The new question gives the clearest view yet of what the mess costs: each answer sizes the ticket at a fraction of what it became.
- **Forecasts that did the census before the work were credited** (LIN-4182's "the plan had already done the hard part", LIN-4183's warnings "exactly right").

### One ruling for John

LIN-4182 asked: run `npm run test:mutation` against the LinearViewer checkout? It edits that checkout's source. This is the hazard LIN-4180's Survey named, and the builder rightly asked rather than ran it. LIN-4182 is already Done; the ruling only decides whether that witness gets run. LIN-4180's close-out ran it safely against a throwaway copy, and LIN-4182's builder said it "isn't a routine check". The friction is clear, and a likely next small ticket would have the mutation runner make its own throwaway copy of Harbour.

### Rebuild 2 (LIN-4195): one record per model request, summed

Written against the bar, with rebuild 1's lesson folded in: "Done when" now says the change list is two-way, and that the recorded inputs hold each case a witness depends on.

**Its Survey (open-0, at Harbour `723052153` and runner `cc2650a6d`)** named eight binds:
1. "last entry" lives in storage and in three fetch paths, not only the fold;
2. **the feedback channel can't carry records** (2000-character cap, one try, unknown kinds dropped silently; one Haiku session made 486 requests);
3. **the runner chose snapshots on purpose**, because a delta on a fire-and-forget post under-reports forever, so this needs upsert-by-max on request id plus re-send;
4. **pricing keys on harness, not record kind**, so Haiku would still price to null;
5. cutover double-counting;
6. a session killed before its first Stop has no transcript path;
7. the call log is read as "Harbour's calls" at about 42 sites;
8. the witness needs a *transcript* corpus, not the snapshot replay.

*Do first:* decide where records live and what Harbour accepts, and ship it accepted but unread; then the transcript corpus with the hard cases; then the runner; then the read, last.

**Acted on:** all of that went onto the ticket, plus "park a piece rather than guess; John answers rulings in the morning". Kicked off 01:27.

## 4 Nov, about 01:30 UTC: one more quality-of-life ticket, LIN-4196 (the mutation runner gets its own Harbour)

The mutation runner edits a Harbour checkout's source. That has now cost a Survey warning (LIN-4180), a by-hand throwaway copy (LIN-4180's close-out), a ruling for John and "not a routine check" (LIN-4182). Filed at the level of the idea: *any builder can run it at any time without risk to any checkout*.

**Its Survey (open-0; told not to run the mutation runner):**
- **The natural place for the copy gives false kills:** killers and the Harbour they boot run under the leak trap, so a copy in shared temp could make every killer "kill" for reasons unrelated to the mutant.
- Killers inherit the operator's `HARBOUR_DIR`.
- About 58 of 60 mutants edit the *dispatcher* checkout in place too, reverted only in a `finally` with no SIGINT handler.
- Copy the working tree, not `HEAD`.
- The runner does everything at require time, so it can't be unit-tested.
- *First:* **a baseline pass.** Run each killer once against the unmutated copy and require a pass, "or any failure from the environment counts as a kill … a fake 100%". Done means: baseline green, score unchanged, and the original tree's checksum identical before and after a run, Ctrl-C included.

**Acted on:** all of that went onto the ticket, with "decide early, and say which" on the dispatcher-checkout scope. Kicked off 01:31.

**A note on the Survey's reach:** this is the fourth ticket where open-0 found that the thing being protected (a guard, a score, a baseline) could be *silently* wrong. LIN-4181's guard was made vacuous by an env pin. LIN-4178's change list allowed and never required. LIN-4180's "it runs" wasn't "it passes". Here, a mutation score could be fake. A pattern for the discussion: *does the check you're relying on actually fail when it should?*

## 4 Nov, 02:10 UTC: rebuild 2's plan follows the Survey's order

LIN-4195's plan was **approved in one plan-review round** and split into seven pieces, one PR each:

| Piece | Ticket | Repo | Blocked by |
|---|---|---|---|
| 0 · corpus and baseline goldens | LIN-4197 (in progress) | both | — |
| 1 · Harbour intake, store, per-record pricing | LIN-4198 | Harbour | 0 |
| 2 · runner posts claude-code records; Stop/reap/cancel flush; subagents | LIN-4199 | runner | 1 (deployed) |
| 3 · live measurement gate (records against snapshots, volume) | LIN-4200 | Harbour | 2 |
| 4 · the read sums records; cutover | LIN-4201 | Harbour | 3 |
| 5 · opencode and runner-kit post records | LIN-4202 | both | 1 |
| 6 · stop posting snapshots; re-measure; final report-back | LIN-4203 | both | 4, 5 |

**Against the Survey:** the plan's chain *is* the Survey's "do first" order, with two refinements. The Survey's step 2 (the transcript corpus) moved to the front as piece 0. And a **live measurement gate** (piece 3) sits between the runner switch and the read switch. Pieces 0 to 2 "move no figure". Plan review confirmed the pricing premise the Survey named ("`isRunningTotal` keys on the reported harness … D5 targets the actual cause"). Its eleven review notes include several the Survey raised: the reap flush at the terminal transition, lines without `message.id`, mixed harness. Note 10, "the label change is John's call", is named in pieces 4 and 6, as asked ("park a piece rather than guess").

Seven pieces in a strict chain is a long night's work. Piece 2 needs piece 1 *deployed*, and piece 3 needs live traffic. The morning may find it part-way, which is fine: each piece is verified before the next starts.

**LIN-4196** (mutation runner copy): plan review done, building.

## 4 Nov, 03:00 UTC: the mutation runner's baseline finds the fake score the Survey predicted

**LIN-4196** (PR #313, head `ffc7493`, CI green; `npm test` 3923 pass, 0 fail): `npm run test:mutation` now copies both working trees into a private root and mutates only the copies. Killers are pinned to the Harbour copy, and Ctrl-C cleans up: the interrupt witness at about 4 s exited 130 with both source trees unchanged by content hash.

**The baseline pass the Survey asked for found a real problem straight away.** The real gate stops at its baseline: `test/system/harbour-halt.test.js` ("a follow-up to a session the stop cancelled is not relaunched") fails on the *unmutated* copy, as it does on `main`. The builder: "The old runner on `main` would have counted that red killer as a kill for every mutant." **That's the Survey's "fake 100%", confirmed:** the mutation score the suite has been reporting was, at least for that killer, measuring a broken test rather than the suite's strength.

**Ruling for John (LIN-4196), blocking the merge:** merge with a recorded waiver and re-run the gate for a score once LIN-2995's halt test is green (recommended), or hold the PR until then. My read: merge-waive. The new runner is strictly more honest than the old one, and holding it keeps the old, fake-scoring runner on `main`.

**Rebuild 2:** piece 0 (LIN-4197, the corpus and baseline goldens, runner PR #312 plus a Harbour PR) is Done. Piece 1 (LIN-4198, Harbour intake, store and per-record pricing) has started.

## 4 Nov, 04:55 UTC: rebuild 2, piece 1 done

- **LIN-4198 (piece 1: Harbour intake, store, per-record pricing) is Done** and deployed, accepted but not yet read, as the Survey advised.
- **Piece 2 (LIN-4199, the runner posts claude-code records, flushes at Stop, reap and cancel, and counts subagents)** is past its implementation arc.
- **Piece 5 (LIN-4202, opencode and runner-kit post records)** is building in parallel, as the breakdown allowed.
- Piece 3 (the live measurement gate) waits on piece 2.
- **LIN-4196** still waits on John's ruling.

## 4 Nov, about 06:00 UTC: rebuild 2 reaches its gate; four piece builders answer

**State.** Pieces 0, 1, 2 and 5 are Done: LIN-4197 (corpus and baseline), LIN-4198 (Harbour intake, store, per-record pricing, `9cc5ff9c`), LIN-4199 (the runner posts records, flushes at terminal transitions, counts subagents, `9478e1c5`) and LIN-4202 (opencode and runner-kit post records, `765289d4`). **Per-request records have been arriving live since about 05:00Z.** Snapshots keep posting alongside them, so no figure has moved yet.

**Blocked on John: piece 3, the live measurement gate (LIN-4200).** It needs read access to production `request-usage` and dispatch rows, which the runner machine doesn't have, and about 3 days of records. That means pieces 4 (the read switches) and 6 (stop snapshots) wait. Three rulings ask the same question (two on LIN-4200, one on LIN-4195). The Survey named this ("the live measure needs the runner host's transcripts as its denominator"), but not the access gap.

**One deliberate break from my own rule:** I asked these four builders while LIN-4195's lineage is still open, because it is blocked on John for about 3 days. The four workers are finished, the questions are `subscription:'none'`, and none goes to the parked LIN-4200 worker (LIN-4166's caveat is about a worker the autopilot is parked on).

**The four answers.**
- **LIN-4197 (corpus):** "The logic was easy. Getting a baseline I could trust was not."
  - The goldens were LIN-4177's *before*, so re-recording them at HEAD, as the plan said, would have erased the change list.
  - The replay wasn't re-entrant: a rate limit plus a frozen clock meant "my first sibling recording was silently made of 429s. A green test proved nothing until I ran it twice."
  - The killed and reap cases' goldens "match the oracle, which could read as covered when it isn't". Nothing posts at a kill or a reap in production.
  - *If:* "composable cases, each with its own figure … this ticket would be 'add seven cases'."
- **LIN-4198 (Harbour intake):** "The logic was small." It bound on registers (five pinned route-census files, the erasure count, the proxy inventory, the fault guard) and on auth (feedback's token is single-use; batches aren't).
  - *First:* read the census tests and the auth middleware before designing; "all three changed the design, and I found each one through a failure."
  - *If:* "Routes would declare which credentials they accept … registration would be one entry that every census reads … about a third of the work."
- **LIN-4199 (runner posting):** "The hard part was the flush points." **Terminal phases are written inline in about six places**, though `phases.js` is meant to own the phase rules. "I wired the obvious one first and had to be pushed to enumerate the rest."
  - *Tidy:* "one `transitionToTerminal(sid, phase, reason)` … with the flush hooked there, in place of six call sites that each have to remember it."
  - The plan steered it to the wrong route and credential.
  - It owns its misses: "I claimed red-first witnesses before I had run them red."
- **LIN-4202 (opencode, runner-kit):** "The dependency moved under me." The breakdown said piece 5 was independent of piece 2, while asking it to reuse piece 2's ledger. `opencode-runner.js` (about 1900 lines, five end paths) is where it bound.
  - *If:* "a harness-neutral usage-records module … 'add the opencode adapter (pure) and register it at session end': about 60 lines and a fixture."

**Reading across.**
- **The one-owner answer is now 14 of 14.** Every builder asked "if the area were how you'd want it" has named one owner or one seam: here a route manifest, one terminal transition, composable corpus cases, and a harness-neutral records module.
- **The fifth "check that passes but can't fail".** Rebuild 2's corpus had goldens that match the oracle for cases production never posts, and a recording made silently of 429s. The same shape appeared earlier on LIN-4181, LIN-4178, LIN-4180 and LIN-4196.
- **A new recurring friction: checks no one can run.** "NOT RUN: needs production access" now appears on LIN-4176 (two checks), LIN-4198 (indexes), LIN-4199 (counts, abort), LIN-4202 (three live checks), and blocks LIN-4200 outright. `docs/plans/costs.md` decision 10 already plans `GET /api/proxy/costs` for agents. A read-only aggregate route would let these checks, and the gate, run through the proxy with no database access handed out.

## Morning summary (4 Nov, 06:00 UTC), for John

### What landed overnight

| Ticket | What | State |
|---|---|---|
| LIN-4176 | **Costs rebuild 1:** one cost read for every surface; unknown shows as unknown, never $0; six engines deleted | Done, deployed |
| LIN-4127 | the runner relays usage by default (its live check followed the Survey's ordering exactly) | Done |
| LIN-4195 | **Costs rebuild 2:** one record per model request. Pieces 0, 1, 2 and 5 Done; records live since about 05:00Z | **At its gate, waiting on you** |
| LIN-4180 | the system suite finds Harbour, or says plainly why not | Done |
| LIN-4181 | clean `main` gives 0 failures and 0 leaks on the runner host (from 1, 4 or 119 depending on where you ran it) | Done |
| LIN-4182 | one on/off parser for 16 sites | Done |
| LIN-4183 | one Stop-hook test driver for 17 drifting copies | Done |
| LIN-4196 | the mutation runner edits only its own copies, baseline first | PR green, **waiting on you** |
| LIN-4164 (round 2, last evening) | sessions resumable for 7 days, clones for 24 h, re-clone on resume | Done |

### Rulings waiting

1. **LIN-4196:** merge with a recorded waiver, or hold until LIN-2995's halt test is green? *My read: merge-waive.* The baseline proved the old runner scored a red killer as a kill for every mutant, so keeping the old one is keeping a fake score.
2. **Rebuild 2's gate (LIN-4200 twice, and LIN-4195):** how does the measurement read production records, and is about 3 days the right window? *My read:* let the worker write and fixture-test the measurement script now, and run it on the Harbour host after about 3 days. Then, separately, consider a read-only aggregate route (`GET /api/proxy/costs`, already decision 10 in `costs.md`). "NOT RUN: needs production access" is now on five tickets, and a route would let all of them run through the proxy.
3. **LIN-4182's mutation question** is moot now that LIN-4196 exists. Dismiss.
4. **Noted, not blocking:** LIN-4178 kept S12's population as today's (moving its window is your call). The mixed-model label change is named on LIN-4201 and LIN-4203.

### What we learned (detail above, from 21:00)

- **Acting on the forecast works.** Every "do first" was a preparation, not a tidy: a baseline, an inventory, a characterisation table, a corpus, a witness order. Writing it onto the ticket changed what happened. LIN-4127's witness avoided the trap the Survey named. Rebuild 2's plan follows the Survey's order exactly. LIN-4196's baseline found the fake score the Survey predicted. LIN-4182's builder: "the plan had already done the hard part."
- **Your two new questions earned their place.** "If the area were how you'd want it" got a one-owner or one-seam answer from **14 of 14** builders, each sizing its ticket at a fraction of what it became ("a one-word default change", "add seven cases", "about 60 lines and a fixture"). That's the clearest view yet of what the mess costs.
- **Proving costs more than changing.** Every Costs builder said so. The sharpest lesson: a change list that allows differences but never requires them passes a reverted fix. It's in rebuild 2's "Done when".
- **The commonest quiet failure is a check that can't fail:** a guard made vacuous by an env pin, a one-way change list, "it runs" read as "it passes", a mutation score counting a broken test, goldens covering a case production never posts. Five times tonight, across both repos.
- **Builders' friction became tickets, and the tickets fixed it.** Six quality-of-life tickets came straight from after-answers. The loop the essay describes ran end to end.
- **Open questions for the discussion:**
  - Should the bar's "follow-ups listed, not filed" stay? Close-out ignored it twice.
  - Should the Survey stay open-0 (it's done well on 13 tickets)?
  - Does "does the check you rely on actually fail when it should?" belong in the Survey or the builder question?

### Today

- **About 20:10 UTC:** the first finished session passes the 24 h clone window. A follow-up then is LIN-4164's live re-clone check.
- **About 7 Nov:** rebuild 2's gate has its 3 days of records, if you choose to wait.

## 4 Nov, about 07:15 UTC: John's rulings

- **LIN-4196: hold the PR until the `harbour-halt` test is green, then get the score.** That test is LIN-4186 (High), with LIN-4185 (`halt-mechanism`, High, possibly the same cause), both filed by LIN-4181's close-out. Fixing them is what unblocks an honest mutation score.
- **Rebuild 2's gate (LIN-4195/LIN-4200): "Accept a shorter window size, and you can use the railway cli to access mongo."** The builders didn't know the Railway CLI reaches the production database. That's the same gap as LIN-4167 (builders don't know the CLI is there). The gate can now run, on a shorter window.
- LIN-4182's mutation question: handled.

## 4 Nov, about 07:45 UTC: is the Survey a drill by other means?

**John's question.** We've measured whether the Survey makes a task land well. We haven't measured whether the work is cleaning the codebase, or only preparing the drill's target area. Agents lean towards the drill, so the Survey may be the drill by other means. If it is, a small nudge might be enough to make it look at the bigger picture, and the "range of options" idea (not yet explored) comes into play once it sees both the local and the global. John approved letting the Periodicals file follow-ups: that's the top-down "push" beside the Survey's bottom-up "pull", and the gap between them is what the Survey should close in its own way.

**The evidence so far leans his way.**
- Every acted-on "do first" was a preparation for *this* change (a baseline, an inventory, a corpus, a witness order). Apart from the odd test, a preparation leaves the material as it found it.
- The cleaning that happened came from tickets that were themselves cleanups, from the builders' after-answers: six cost engines deleted, 16 flag sites down to one, one Stop-hook driver, one test reset. No Survey on a feature ticket has yet caused a tidy.
- The precedent (`experiments/periodicals-before-after/`): the first half of October's rebuild round (rebuilds 1A–4) rebuilt five files and left every area-level number unchanged.

**Baseline.** The Periodicals already measured the codebase just before round 2: Seams & Tangles (LIN-4152) and Drift & Coherence (LIN-4153), both at LinearViewer `015aa4c6` and simple-dispatcher `cf6369d` (3 Nov, morning). Round 2 was filed that afternoon. So a fresh run of the same Periodicals is a before-and-after of everything since, ours and other people's.

**Three things, run in parallel.**
1. **Periodicals, top down.** Seams & Tangles, Drift & Coherence, Code Quality and Stability, each run as its template says, filing follow-ups.
2. **Scripted before-and-after.** `seams.mjs` at `015aa4c6` and at today's `main` under one guide. Every moved link is traced to its file pairs, then to a ticket: ours or someone else's.
3. **The step-back spike.** A follow-up to each of the 13 open-0 Survey sessions, still read-only and still standing at its own base. It asks the session to look at the wider area and then lay out options from narrowest to broadest, each with its cost and what it leaves for the next task. Same session, same base, with the nudge as the only change. The question is whether the nudge changes the choice, not just the description.

**Prediction, written before any of it runs.**
- **Seams (area map):** about flat. Our tickets were mostly in simple-dispatcher, and the LinearViewer ones (costs) were within-area. Any movement on the map will be someone else's.
- **Drift (decisions in several places):** down a little where our tickets consolidated: the cost figure, simple-dispatcher's env flags, its Stop-hook driving and its test resets. Nothing else moves because of us.
- **Code Quality (big functions):** the same or bigger. None of our tickets touched the big units it promoted (`runStallFailsafe`, `createDispatchItem`, the POST dispatch handler).
- **The Periodicals' follow-ups** will name things no Survey named, because no Survey was asked about those areas.
- **The step-back answers** will describe the area well (where the change sits in a knot or a scattered decision) and lay out a real range. For most tickets the chosen option will still be the narrow one, plus a preparation, and the session will say the broad option isn't pulled by this task. Two or three will choose a medium option (consolidate the thing this task touches) that their first forecast didn't name. If so, the nudge reaches altitude without becoming a mandate, and the range of options is where it pays.

### 07:40–08:00 UTC: sent, and the first reading (scripted, LinearViewer)

**Sent.**
- **13 step-back follow-ups**, one to each open-0 Survey session, quiet (`subscription:'none'`), each standing at its own base. The ids are in the scratchpad (`alt/stepback.tsv`), and the template is below.
- **The four Periodicals:** autopilot `8b6aeda3` (maxTasks 4), whose goal is limited to Seams & Tangles, Drift & Coherence, Code Quality and Stability, with follow-ups allowed.

**The step-back question** (sent verbatim, with `{TICKET}` and `{BASE}` filled in):

> Your forecast looked at this task up close. Now step back, and look at the part of the codebase it sits in and the codebase around that.
> 1. What is that wider area like, and how much of this task's difficulty comes from the area rather than from the task itself?
> 2. Set out the ways you could go about this task, from the narrowest (just do the task) to the broadest (change the area so that tasks like this one become easy). For each, say roughly what it would cost, what it would leave behind for the next task here, and what could go wrong.
> 3. Which would you choose for this task? Is that different from what you said first, and why?

**Scripted before-and-after: LinearViewer `015aa4c6` → `5334c81a7`.**
- The window is **15 commits**. Eleven are ours (Costs rebuild 1 and its pieces LIN-4177/78/79, rebuild 2's pieces 0, 1 and 5, LIN-4173, LIN-4168, LIN-4166) or the Periodicals' reports. Four are the UI operator's (LIN-4106, LIN-4107, LIN-4110, LIN-4040). So this side of the window is nearly all our own work.
- The tool is `scripts/code-shape/seams.mjs` from `main`, with `main`'s guide at both commits.

| | Base | Main |
|---|--:|--:|
| Files in scope | 528 | 536 |
| Cross-area imports | 1227 | **1262** (+35) |
| Two-way pairs / knot group | 12 / one of 9 | 12 / one of 9 |
| "Other features" (the catch-all) | 12 files | **17 files** |

**Prediction 1 was wrong.** I said the area map would stay about flat and that any movement would be someone else's. It moved, and the movement is ours. All 8 new production files came from our tickets:
- `cost-read`, `cost-format`, `request-usage-intake`/`-store` and `founder-lookup` (Costs);
- `key-state`, `key-state-holders` and `workspace-issues-memo` (LIN-4168).

No pattern in the guide names any of them, so all of them fell into the catch-all. The grown knots are their imports:
- **Pages ↔ Other: 2/6 → 8/6.** Six render files now import the one formatter.
- **Other ↔ Runs: 6/12 → 9/15.** `cost-read` reads `dispatch-terminal` and `session-telemetry`, and `run-view`, `weekly-budget` and `terminal-marked-task-cost` read `cost-read` back.
- **LLM ↔ Other: 1/1 → 4/2.**

**The guide experiment.** I gave the costs code a named area: `^lib/(cost-*|request-usage-*|task-cost)\.js$`.
- The old owner, `task-cost.js`, had 3 importers from 3 areas.
- The new owners have **19 importers** from 5 areas (`cost-read` 9, `cost-format` 7, `request-usage-intake` 3).
- The new owner also reads from Runs, LLM and Platform, and Runs and LLM read it back. So **Costs ↔ Runs went 2/1 → 2/5**, and a new **Costs ↔ LLM 2/2** knot appeared.

The consolidation did what it said: one read instead of six engines, and the old `task-cost.js` deleted. Seen from the map, it made a new hub, filed under no named area, with two-way knots to the two areas it sits between.

**Lines.** These are production lines (`lib`, `routes`, `public`, `server.js`) per commit; *net* is added minus deleted.

| Ticket | What it says it does | Prod + / − | Net |
|---|---|--:|--:|
| LIN-4177/78/79 | one cost read, six engines deleted | +1023 / −646 | **+377** |
| LIN-4168 | one reset for a key's test state | +520 / −48 | **+472** |
| LIN-4198, LIN-4202 | new capability (per-request records) | +724 / −24 | +700 |
| UI operator's four | | +411 / −314 | +97 |

- Every consolidation in the window added more production code than it removed.
- The preparations left large fixtures: LIN-4197's corpus is +54k test lines, and LIN-4177's is +44k.
- Lines aren't cleanliness. Drift's places-per-decision is the measure for that, and it's still to come. But "delete the copies in the same change" happened, and the one owner came out bigger than the copies it replaced.

**What this says about the drill question (first reading).** Our consolidations were locally right: one owner, copies deleted, every builder pleased. Globally, the place got a new hub with no named home and two new two-way couplings. Neither the Surveys nor the builders mentioned the map, because nobody asked them about it. That's John's worry exactly: the tidy pulled by the task cleaned the task's own area and tangled the wider one. The step-back answers will show whether a nudge would have seen it.

### 07:38 UTC: the step-back answers (13 of 13, all posted on LIN-4150)

Each session went back to a fresh worktree at its own base and read nothing later. Each did the work: 31+ tool calls, 3,400–4,200 characters, several redrafted to fit the word limit.

**At altitude: yes, every time.** Every answer described the area in facts, and put "most" or "about two-thirds" of the difficulty on the area rather than the task. They named:
- a file's size and the history that grew it;
- orderings that live only in prose;
- state nobody owns;
- copies across repos;
- three idioms for one thing.

**The range of options: yes, every time.** Each laid out three to five options, from narrowest to broadest, with cost, what it leaves behind, and risk. The broad options were real ones: an outbox, a settings registry, a per-workspace state container, a typed telemetry channel, a shared sandbox-checkout primitive.

| Ticket | First answer (forecast) | Step-back choice | Changed? |
|---|---|---|---|
| LIN-4127 | settle the parse rule; witness by careful manual procedure | **B:** also record where the flag's value came from, so the witness is one oplog row | yes |
| LIN-4164 | measure disk, raise the constant, mirror Harbour | **B + cheap half of D:** a startup check for the timer ordering; file the cross-repo "how long is resumable" contract on its own | a little |
| LIN-4165 | default on, check every exit path | **A + B's Harbour half:** Harbour readers key on `kind`, not position; chatter yields to `[done]` | a little |
| LIN-4166 | test first, read the flag from `doc` | **A, named for what the row *is*,** so the "aside" concept can grow without a rename | a little |
| LIN-4167 | A vs B (token in CI), John to choose | **a + d:** answer plainly, and add a **no-secret "did it go live" check** that goes red on any stall | **yes: a new option** |
| LIN-4168 | registry plus a test comparing it to the inventory | **B, with structural registration** (`keyedHolder` registers itself; a guard flags unregistered maps) | yes |
| LIN-4176 | inventory and golden capture, then one read | **B, with the read's input shaped like the coming ledger,** behind an adapter, so rebuild 2 swaps the adapter and not the readers | yes |
| LIN-4180 | one resolver plus a pre-flight | **B, built so C can grow:** use production's sibling rule; delete the bad default; **fail, never skip** | a little |
| LIN-4181 | baseline table, one canonical place to run | **A + a census test:** the acceptance becomes "location stops mattering" | **yes** |
| LIN-4182 | table test of today's behaviour, then the parser | **B:** the module's home is the main decision; file numbers separately | a little |
| LIN-4183 | B (helper plus ~11 copies) | **D:** B, plus remove two of the five global patches that the area had already outgrown | **yes** |
| LIN-4195 | decide the home and intake first | **B + an outbox:** an acknowledged sender, its own collection | sharpened |
| LIN-4196 | baseline; copy "outside the shared temp roots" | **B:** the copy goes *inside* a run root the runner owns, under its siblings' rules | **yes** |

**Against my prediction.** I said most would still choose the narrow option and two or three a medium one. That was too pessimistic. **Twelve of 13 chose a middle option that leaves something for the next task**, and 6 of those changed their choice in substance. The pattern is consistent: the broad option is "the right direction, but its own ticket". So stepping back produces both a better-placed local choice and a named top-down follow-up.

**The place-level finding was in sight.** LIN-4176's step-back opens with "Cost has no home of its own. It is a passenger on dispatch", which is exactly what the seams map shows today (the new owner is in the catch-all, with two-way knots to Runs and LLM). It offered C, "give cost its own area first", and declined it as too broad. LIN-4164's step-back names Harbour's hard-coded copy of the 6 h number; LIN-4173 later made it one exported copy.

**The range brings choices to the floor.** LIN-4167 is the clearest case. John's choice was between a token in CI and keeping it manual. The step-back found a third option he wasn't offered: a check with no secret that turns any stall red. That fits his ruling ("grit in the gears warrants human attention"), since it makes the grit visible without removing the human.

**Caveats.**
- This is a second pass in the same session, with its own forecast in view, so question 3 invites revision.
- The answers are hypothetical: the tickets are done. Whether the middle option pays has to be tested forward.
- Cost: each answer took about 18k output tokens and re-read about 2M cached tokens.

## 4 Nov, about 08:00 UTC: closing the gap, and a backtest of the global offshoot

**John's question:** what would it take, using the pieces we have, for tasks to finish with a cleaner codebase than they started with? He suggested another offshoot from the Survey offshoot, looking at the global picture.

**The proposed loop:**
1. open-0 (local).
2. A **global offshoot**: a second agent that looks at the codebase as a place, not at the task. Agents drill, so each view gets its own voice.
3. The step-back, fed by both, sets out the range and chooses. The choice, and what it should leave behind, go onto the ticket.
4. The build.
5. A **per-task place change** at merge (map and census at base vs merge; it reports, never gates). If the place got worse, the tidy-after is pulled in the same lineage.
6. A tally of the broad options by area. When a second task names the same one, it's pulled.
7. The Costs meter shows the payback.

"Cleaner" is read at the level of the whole codebase, not in lines:
- no new module without a home on the map;
- no unnamed new two-way area link;
- fewer places per decision;
- copies deleted;
- big units no bigger.

**Backtest first.** We know the place outcome for three tickets. The global offshoot (v0, `docs/plans/survey/global-offshoot-prompt.md`) runs at each ticket's own base, with the future off limits.

**What counts as a hit, written before dispatch:**
- **LIN-4176 @ `9e397e6be`:** it says the consolidated cost read will be a new owner with no home on the area map, imported from many areas. Or it says the read will sit between Runs and LLM and be read back by them, the two-way risk. Naming either is a hit. Saying "cost has no home" without saying what the task will do about it is half.
- **LIN-4168 @ `048c3319a`:** it says the registry will be a new holder with no home, or that the composition root (`server.js`) or the test router grows. A hit is naming what the obvious way adds and where it lands, not just that the state has no owner.
- **LIN-4195 @ `723052153`:** it says the per-request store and intake add another module beside `dispatch-store` and the cost read, with Runs ↔ Costs crossings, or that the snapshot path will run alongside it. A hit is a prediction about the place, not about the figure.

**A miss** is an answer that only restates the task's local difficulty, which would make it the drill by other means again.

**The per-task place change works** (`experiments/place-change/place-change.mjs <repo> <base> <head> <areas guide>`, wrapping `seams.mjs`). Run per commit over the window:

| Commit | Place change |
|---|---|
| LIN-4168 | +5 cross-area imports; **2 new files with no home** (`key-state`, `key-state-holders`) |
| LIN-4177 | +7; **2 with no home** (`cost-read`, `cost-format`); LLM↔Other and Other↔Runs grew; Agent↔Runs and LLM↔Runs shrank by one each |
| LIN-4178 | +11; **1 with no home** (`founder-lookup`); Pages↔Other 2/6→5/6, Other↔Runs grew |
| LIN-4179 | +7; Pages↔Other →8/6, LLM↔Other grew; Other↔Runs shrank by 2 |
| LIN-4198 | +5; new files with a home (Runs); three Runs knots grew by one |
| The other ten | no change |

A builder or reviewer could read this table in seconds. It would have shown LIN-4177's homeless hub on the day it merged.

### 07:57 UTC: the global offshoot backtest, scored against the criteria logged before dispatch

| Ticket @ base | What the global offshoot said about the place | Score |
|---|---|---|
| LIN-4176 @ `9e397e6be` | "**No home in the map.** Cost files are split between Runs and LLM; `row-usage` and `lineage-membership` sit in the catch-all." Done the obvious way, "one more file lands in the catch-all". Better at this task's cost: "**A Costs area in `areas.json`**", and the read owns fetch, window and population | **Hit** on the homeless hub. **Miss** on the read-back: it didn't predict that Runs and LLM would import the new owner back |
| LIN-4168 @ `048c3319a` | Where it lands (`routes/test.js`, the `server.js` wiring, a 45-name factory destructure) and what the obvious way adds (a 46th dependency, a second hand-kept list, three seams untouched). Better: holders register at construction, **the registry in `lib/` not `routes/`, created before the router mount**, plus a guard test over module-level Maps | **Hit** on placement and on what the obvious way adds. It didn't mention the map's catch-all |
| LIN-4195 @ `723052153` | "**None of the new cost modules has an area** in `areas.json`, so they all fall under Other features." "This task is largely a deletion." Extending `llm-call-log` with no new shape is wrong; its own collection; pricing should read the record's unit, not the harness name | **Hit** |

**What we learn.**
- **From the base, the global view sees the place-level consequence the local and step-back views mostly didn't.** All three proposed a home for the costs code on the map, cheaply and inside the task. No Survey suggested it, and no builder did it, so the hub went to the catch-all three tickets running.
- **It does not see second-order coupling.** It didn't predict that consumers in Runs and LLM would import the new owner back. That shows up only when you run the map at merge, which is exactly the place change's job. So the two cover each other: forecast from the base, measure at merge.
- **It stays out of the drill.** Each answer was about the place, with the task as context. Every one split "this task can carry" from "not this task's", unprompted by anything but question 3.
- **A caution.** "Give it a home in `areas.json`" is a guide edit. It's legitimate when the area is real, but it's also the cheapest way to move the numbers. The Seams periodical counts guide effects separately, and we should too.

## 4 Nov, about 08:00 UTC: forward trial 1, rebuild 2's pieces 4 and 6 through the full loop

John: "we're at the try-anything-and-see-if-it-works stage… only once we have a reliable system should we finalise it."

**The tickets.**
- **LIN-4201** (piece 4: the cost read sums request records) and **LIN-4203** (piece 6: stop posting snapshots; remove the runner's snapshot path). Both are Todo and wait on the gate (LIN-4200).
- They are real, upcoming, in the area where the backtest found the hub, and largely deletions. So the place change at merge should be measurable.

**The loop, v0.**
1. open-0 and the global offshoot, as separate fresh agents, at today's `main`.
2. The step-back, as a follow-up to the open-0 session, with the global answer pasted in as "what another agent, looking at the place, said".
3. The step-back's choice is written onto the ticket: what to do, what it should leave behind, and what the map should look like after.
4. The build, as usual, when the gate allows.
5. The place change at merge, sent to the builder. If the place got worse, ask for the tidy-after in the same lineage.

### 08:01 UTC: forward trial 1, open-0 and global answers (all four on LIN-4150)

**LIN-4201 (records-first read).**
- **open-0** found the proving traps:
  - the replay drops `records`, so most of the change list can't differ yet;
  - fixture records carry no `harness`;
  - `/kpis` has no `urlKey`;
  - async loaders reach sync readers;
  - the census is narrower than asked.

  Its "do first": make the replay serve records, and write the expected diff as a failing test before any production code.
- **global** found the place-level points:
  - the read **still has no area** (catch-all), and its loader sits in Runs;
  - the obvious way gives **two folds**, the shape last week removed;
  - **seven callers opening the store would hollow out the LIN-4198 census** (four allowed files become eleven).

  Better, at this task's cost: **one async loader beside the pure read**, passed in the way `lineageIdentity` reaches `collectKpiStats`. That keeps the census at one new file, puts the cross-workspace `/kpis` case in one place, and gives the cost read an area. Not this task's: retiring the snapshot fold ("the real payoff").

**LIN-4203 (stop the snapshots).**
- **open-0** found:
  - the preconditions belong to other tickets (piece 4's records path; piece 3's script);
  - snapshots also feed the `/kpis` harness share, the effort read-out and `parkedWait`;
  - runner-kit's "harness known, unpriced" post means something;
  - some pinned tests are witnesses to keep, not delete;
  - the flag outlives the snapshot.

  Its "do first": check piece 4 landed and moved `harnessReadingOf`; get a ruling on runner-kit's case.
- **global:** "the area is at its largest now, and this piece is where it shrinks."
  - **What is left with no home or the wrong name:** `WORKER_USAGE_RELAY` gates only the records but is documented as the snapshot flag; `runner-prompt.md` still lists `[usage]`.
  - **Better:** rename or re-document the flag in the same PR, keep the `walkUsage` goldens as a frozen "before" fixture, and mark the marker as "read for old rows only".
  - **Not this task's:** `hook.js`'s 7 copies of the post-at-Stop sequence, and the opencode runner's size.

**First observation.** The two views barely overlap, and they agree where they do (`harnessReadingOf`, `buildSessionTelemetry` left alone, goldens as witnesses). open-0 is about *proving* the change; global is about *where it leaves things*. That's the split we hoped for: two voices, not one view said twice.

### 08:10 UTC: forward trial 1, the step-backs with the place view, and the tickets written

Both step-back sessions got the global agent's answer pasted in, with "evidence to weigh, not instructions; check what you rely on".
- **They checked it.** LIN-4201's step-back confirmed the census already reserves "its own file" for piece 4, and **found a third entry path** to `buildRunView` the global agent missed (`run-paragraph-hook.js:66`). LIN-4203's step-back **corrected one line reference** (`lane` is added at flush, `:144`, not `:74`). So the place view was weighed, not swallowed.
- **Both chose the middle option, and absorbed the place view's cheap moves into it.**
  - **LIN-4201: B**, one loader and one decision. Its merge checks include "the cost code has a home: `cost-read`, `row-usage` and the loader go into Runs & dispatch".
  - **LIN-4203: B plus an intake counter.** "The deletion is only safe if its boundary can be checked." It lists exactly what's gone, what has one owner, and a legacy-marked census of snapshot readers.
- **The new question 3 ("say plainly what the place should look like once it's done… so someone can check it at merge") worked.** Both gave a checkable list of files gone, single owners, where new code lives, and which tests flip. That list is the contract the place change can be judged against at merge.
- **Question 4 gave a short, concrete list of what is "not this task's"**, mostly agreeing with the global agent's "better still". It's written onto the tickets as "list in the close-out, don't file", ready for the tally of broad options.

**Written onto LIN-4201 and LIN-4203** as "How to go about it (from a Survey before work began)", with the "at merge" checks. Their state was not changed: LIN-4195's autopilot runs them after the gate. One ruling is named for John on LIN-4203 (runner-kit's no-transcript case; the Survey recommends `no-usage`).

**What to check at merge**, with `experiments/place-change/place-change.mjs` and by reading:
- **LIN-4201:**
  - the catch-all loses `cost-read`/`row-usage` (or the guide gains a home for them);
  - exactly one new file names the store;
  - no new two-way area link;
  - one decision function.
- **LIN-4203:**
  - the runner's snapshot functions are gone;
  - the flag is re-documented;
  - the census lists the legacy readers;
  - net production lines **down**: the first piece in the window that should shrink the place.

**Running cost of the loop for one ticket:** three Survey agents before the build (open-0, global, step-back). I haven't measured their cost against a build beat yet. The meter will give the real figure once records-first reading lands, which is this very ticket.

### 08:10 UTC: how we handle rulings from now on

John: "add recommendations to rulings, then I can approve." Harbour has a route for this: `POST /api/proxy/rulings/{decisionId}/suggest-answer` (`optionId`, a reason of at most 500 characters, `decisionLoopId`). It records a proposal only. John discharges it by pressing "answer as proposed".

From now on, each check reads `GET /rulings` and posts a proposed answer, with its reason, on every open ruling where I have a recommendation. Free-text rulings, which have no options, get the recommendation in the update to John instead.

When he asked, nothing was open: he had already answered the rulings above, including the gate's to-the-cent rule (08:05) and the Mongo credential rotation raised on LIN-4195 (07:42).

### 08:15 UTC: the tally of broad options (`docs/plans/survey/broad-options.md`)

I collected every "right direction, not this task's" from the 15 step-backs, plus the global offshoot's "better still" lists, grouped by what each would change.

- **8 broad options were named by more than one task.** One of them (a home on the map for the cost code) is already **pulled**: it's in LIN-4201's at-merge checks.
- **The strongest recurrences:**
  - one Stop tail in `hook.js` (LIN-4165, LIN-4203, LIN-4183);
  - settings as one described list, re-readable rather than fixed at require time (LIN-4127, LIN-4182, LIN-4183);
  - a shared harness for the heavy test tier (LIN-4180, LIN-4196, LIN-4181).

  Each came from tasks that, at the time, each looked like a one-off.
- **This is the push/pull meeting point John described.** No Periodical proposed these: they came bottom-up, from tasks paying for their absence. The rows give the Periodicals' top-down findings something to be checked against.

**Next test:** give the global offshoot the tally rows for the area its task lands in, and see whether the task carries part of one.

### 08:20 UTC: check-in

- **LIN-4196 is Done** (simple-dispatcher `502901c`). The mutation runner now copies both the dispatcher and Harbour into a private `sd-mutation-*` root and edits only the copies. It runs a baseline first and cleans up on a signal.
  - **The real gate:** baseline 25/25, 67/67, exit 0, live-tree hashes identical before and after. That's the honest score John's ruling waited for, unblocked by LIN-4186/LIN-4185 (the halt tests, `67ff5c3`).
  - **What was built** copies the dispatcher too, which is the step-back's option B. The step-back was hypothetical, asked after the plan was set, so this is agreement, not influence.
- **LIN-4196's builder was asked the round-3 questions** (`69e051b5`, quiet), with **a new question 6**: "What did your change leave behind in the wider codebase, beyond this ticket: anything new without an obvious home, anything that now lives in two places, anything that got simpler?" The aim is to see whether builders notice the place without being shown the map.
- **The Periodicals:** Seams & Tangles (LIN-4208) is in close-out; the other three are writing their reports.
- **LIN-4200** is re-measuring under the to-the-cent ruling. LIN-4201 and LIN-4203 are Todo.
- **Rulings:** none open.

## 4 Nov, about 09:50 UTC: the Periodicals are in, scored against the 07:45 prediction

All four merged between 08:24 and 08:40: Seams & Tangles (LIN-4208), Code Quality (LIN-4207), Stability (LIN-4206) and Drift & Coherence (LIN-4209). Seams and Drift share our window exactly (`015aa4c6..5334c81a`). Code Quality and Stability measured from late October.

| Predicted | What the Periodicals found | Verdict |
|---|---|---|
| **Seams: about flat; any movement someone else's** | "**Placement hiding growth.**" The catch-all went 12 → 17 files, all five new ones ours. "**The window's largest item is a new hub, `lib/cost-read.js`**: 9 cross-area importers from 5 areas, and bidirectional reach into Runs and LLM." Watched, not ticketed, because LIN-4195/LIN-4201 are in flight | **Wrong**, as my scripted run already showed. The Periodical and `place-change.mjs` agree to the file and the count |
| **Drift: down a little where we consolidated; nothing else moves because of us** | USD formatting improved: 12 → 5 → one home plus a pinned browser twin. Census flat (106 `mustRule`; the guide edit moved zero groups). But **new rows created by our own window:** `lineage-identity-read-twins` (`founder-lookup.js` repeats a `dispatch-store` query without its guard; LIN-4178), `cost-fold-partition-restated` (`cost-read` restates `row-usage`'s partition), `usage-record-vocabulary-two-readers`, `key-state-residue`, and `usage-relay-flag-partial` (five record-flush seams ignore the relay flag; LIN-4195 says it's closed) | **Half right.** The consolidation we aimed for held, and in doing it we made several new small copies |
| **Code Quality: the same or bigger** | "Did simplification keep up with feature growth? **No.**" +4,172 decision points over 163 production commits; retirements −430. The top units worsened: `prompt-section.js init` (1,994 lines), SD `runStallFailsafe`, and new, `dispatch-store addFeedback` (448 lines, 67 DP). Their owner tickets are all **Backlog, unstarted**. Mints: zero | **Right** |
| **The Periodicals' follow-ups will name things no Survey named** | **One** follow-up was minted across all four (LIN-4210, the halt poll cold-cache fail-open, needing John's ruling). The rest were "watch", a comment, or "for John". Drift: "every Drift follow-up is still unmoved" (`coherence-loop-stalled`) | **Right, but thin.** The top-down channel mostly doesn't produce work, and what it does produce sits |

**Stability (advisory):** "Not yet settled. Nothing is spiralling, but the rate of change has not settled." CI wall time has risen in every window since September (4.9 → 8.23 min), mostly from suite growth (runtime tests +17% since 23 Oct).

### What this tells us about closing the gap

1. **Push alone doesn't land.** The Periodicals see the place accurately, and the measures agree across instruments, but their findings go nowhere. Follow-ups sit in Backlog. Owner tickets for the worst units are never started. Findings in in-flight areas are "watched" or left "for John". Drift says so of its own loop.
2. **Our consolidations were locally right, and still added small copies and a hub.** Neither the Survey nor the builders saw that until it merged. The global offshoot saw the hub from the base. Nobody saw the twins.
3. **The missing wire is routing.** Four of Drift's new rows, plus Seams' hub, sit exactly in the ground LIN-4201 and LIN-4203 are about to rewire. Code Quality's `addFeedback` finding sits in LIN-4166's area, and `runStallFailsafe` in LIN-4164's. Tasks went through those areas and didn't carry them, because nothing told them.

### Experiment: route the Periodicals' findings into the in-flight tasks (09:50)

Added to LIN-4201 and LIN-4203, under their Survey section, as "From the Periodicals (top-down, 4 Nov), in this task's ground":
- **LIN-4201:** the founder-lookup twin, the `lane` vocabulary split, the restated partition, and the catch-all hub. Each carries its natural home in this piece's shape: the one loader, the one decision function, the one vocabulary.
- **LIN-4203:** the relay-flag finding. **It changes one of its own at-merge checks.** "Re-document the flag as the records flag" is wrong if five flush seams ignore it, so the task must decide first: gate the flush everywhere, or retire the flag.

The rule for these: carry what you cheaply can, and name in the close-out what you don't. **What we'll look at:** whether the builder carries them, and whether the place change and the next Drift reading show the twins gone.

**Also open, with my proposals posted (suggest-answer):**
- **LIN-4212** (record lineage): read by posting row, F. No migration; it keeps D14 open.
- **The gate's pass criterion:** "explained is enough", on condition the explanation check is shown failing on a planted mismatch.

### 09:55 UTC: LIN-4196's builder answers, with the new place question

- **Q6 works without a map.** Asked "what did your change leave behind in the wider codebase", the builder named:
  - one new file with no obvious home (`test/helpers/tree-hash.js`);
  - **a new copy** (process-group termination, now in `run-mutations.js` beside `reapers.js` and several tests);
  - one thing simpler (one way to find Harbour again);
  - the residue: mid-run environment failures still count as kills, and fixed ports clash between parallel runs.

  Builders do notice the place when asked. Nobody had asked before.
- **Q4 ("if the area were how you'd want it")** was "one 'run this test command against a private copy of the trees' primitive, shared by the system suite and the mutation gate". That is the tally's shared-harness row, **now named four times** (LIN-4180, LIN-4181, LIN-4196 step-back, LIN-4196 builder). By the tally's own rule, it's a candidate to file with the evidence.
- **Q2 matches the forecast's "do first"** (a baseline first). The builder's version: "that would have shown the `harbour-halt` red and the preload interaction at the start".

## 4 Nov, about 10:35 UTC: can the global offshoot see the small copies? (backtest on LIN-4178)

**Gap noted first.** LIN-4212 (record lineage) was filed by the gate's worker and started by its autopilot within minutes, so it ran with no Survey. A ticket filed mid-lineage skips the loop. A real Survey stage would need to sit where tickets are *started*, not where we file them.

**The blind spot.** The global offshoot saw the hub from the base, but not the small copies Drift found afterwards. The clearest of these: `lib/founder-lookup.js` (LIN-4178) repeats `dispatch-store.lineageIdentityRows` (LIN-4177, already on `main` at LIN-4178's base `10b2c82fb`), and the copy skips the bounded-read guard and fault mapping. LIN-4178's ticket asked for "the raw-collection adapter for the founder lookup", which is how the copy was invited.

**The test.** Run v0 (unchanged) and v1 at `10b2c82fb` on LIN-4178's ticket text. v1 adds one clause to question 2: "…or leave in two places (a second copy of something the codebase already has)?"

**Hit criterion, written before dispatch:** the answer names `lineageIdentityRows` (or "the founder lookup already in `dispatch-store`") as the existing home, and warns that a raw-collection adapter would be a second copy, or loses the bounded-read guard. A general "watch for duplication" is a miss.

**Caveat:** LIN-4178's description is read as it is now, and it may have been edited after work began.

### 10:50 UTC: the twin backtest, scored. Both versions hit, so the blind spot was the level, not the prompt

| Version | What it said about the founder lookup, from `10b2c82fb` | Score |
|---|---|---|
| **v0** (unchanged) | "**A second founder lookup.** The KPI path has raw collections, not `DispatchQueueStore`. The easy move is to copy `lineageIdentityRows`' query, projection and dedupe into kpi-stats, which leaves two lookups free to drift." Better: "One identity query over raw collections, with the store method delegating to it." | **Hit** |
| **v1** (+ "leave in two places") | "*A second copy of the founder lookup.* `lineageIdentityRows` lives on `DispatchQueueStore` (`dispatch-store.js:1935`)… the 'raw-collection adapter' restates that query." Same fix: one function over the two collections; the store delegates | **Hit**, with more line references |

Both also predicted a second copy, "`joinCostLineages` reborn twice" (S11 and S12 each inlining the outcome × cost join), and the shape traps the replay is blind to: KPI rows carry `usageEntry`, not `feedback`, and run-page loops have no `status`/`rootItemId`.

**What this tells us.** The global offshoot missed the twin earlier because it ran on **LIN-4176, the parent**, whose ticket talked about "one read". The copy was invited by **LIN-4178, the piece**: "add the raw-collection adapter for the founder lookup". Run on the piece's own text, even v0 sees it. So the place view has to run where the specifics are, **per piece, at the moment the piece starts**. That's the same gap LIN-4212 showed this morning: rebuild 1's three pieces and LIN-4212 all started without their own Survey.

**Consequence for the design (to test, not settled):** the Survey belongs at the start of every ticket that will change code, including breakdown children and tickets filed mid-lineage, not just the tickets we file. Until there's a real stage, I Survey the next pieces by hand before they start (as with LIN-4201 and LIN-4203). v1's extra clause stays: it cost nothing and added line references.

## 4 Nov, about 11:00 UTC: the tipping point, and the place ledger

John: "there's a point… where the ratio tips: when a task truly does (on average) leave the codebase in a better place once finished, even a little, we're in a really strong place. Even if we rely on things like periodicals when we want to improve not tied to a ticket."

That makes the goal a per-task balance we can measure. I started `docs/plans/survey/place-ledger.md`: one row per merged ticket, with map change, copies, what it carried, and a balance with its reason. **Baseline (the window before the place view), by row: 1 better, 3 neutral, 4 worse, 1 mixed.** Every forward ticket through the loop gets a row at merge. The tipping point is when the running average turns positive.

## 4 Nov, about 11:05 UTC: more work for the task, less for the future (the pricing question)

John: "we're fighting a natural urge to just land the work. The best path may be a big chunk of refactoring then the small change. More work for the task, less work in future for the global."

**The reading.** The step-backs resolved this the same way 12 of 13 times: a middle option, with the broad one deferred as "the right direction, but not this task's". That's the land-the-work urge again, this time as scope caution. It's a pricing question, not a scope question. Refactor first when it costs less than what its absence keeps costing. Both prices are now within reach:
- the tally gives how many tasks paid for the absence;
- the builders' "if this area were how you'd want it" says how much smaller each task would have been;
- the meter, once it reads records, gives tokens.

Following Beck, and our own lesson that proving costs more than changing, the refactor should be **its own piece, sequenced first**, with its own witness, not folded into the task.

**First test: LIN-4203 and the seven Stop sites.** LIN-4203 removes the snapshot post from all seven Stop sites in `hook.js`. Its Survey deferred "one Stop sequence". The tally has three tasks paying for that absence (LIN-4165, LIN-4183, LIN-4203). I sent LIN-4203's Survey session a read-only pricing follow-up (`20e955b2`) with the other tasks' evidence. It asks what the absence has cost, what one sequence would cost done first as its own piece (and what that piece would prove), and whether it would do it first, fold it in, or leave it.

**What would count:** a reasoned price on both sides, and a choice that follows from them. If it says "do it first", that's a proposal for John (a new piece 0 before LIN-4203), not something I file on my own.

## 4 Nov, about 11:10 UTC: how much to tidy is John's call

John: "It's *my* call. Eventually a task is chosen, surveyed, and the user decides how much to tidy up. Agents can recommend, but we can see they're not quite the right shape. We're breaking the 'natural' flow of tasks. But, don't need to worry about how this actually lands. If we can show the process works, everything else is pretty straightforward."

**What changes.**
- The Survey's last step is now **a ruling for John**: the range of options (narrowest to broadest, each with cost and what it leaves behind), a refactor-first piece where the pricing supports one, and the agent's recommendation.
- **John chooses the scope.** His choice, not the agent's, goes onto the ticket as "How to go about it".
- This is where the range of options earns its place: it's the menu the person decides from.

**Correction to forward trial 1.** I wrote the step-back's choice straight onto LIN-4201 and LIN-4203, which let the agent make John's call. Those sections now count as recommendations. Their scope goes to John as rulings once the pricing answer is in.

**Mechanism to try:** the Survey session ends with a `DECISION:` block, which Harbour turns into a ruling, and I post a suggested answer on it. If that doesn't work for a custom dispatch, the options go to John in my update instead.

**Focus:** show the process works. How it lands in Harbour as a real stage comes after that.

## 4 Nov, about 11:20 UTC: Claude plays the human, and chooses large

John: "I'm happy, for the sake of this process, for you to play the role of the human. If you can choose a large enough option, we may get the improvements we're looking for (even if it takes a big piece of work to land it)."

**The pricing answer (LIN-4203, `20e955b2`).** It set a real price on the missing Stop sequence:
- one shipped miss (LIN-1293 wired 3 of 6 outcomes; LIN-1312 fixed it);
- a copy tax: LIN-1700, LIN-4165 (8 sites), LIN-2423 and LIN-1425 each touched every case;
- avoidance: LIN-4199 put its flush before the switch "because the switch was too costly to enter".

It came to "about half a session of hand-checking per relay ticket, about five times in four months". Done first, the refactor would buy LIN-4203 almost nothing, since the seven snapshot lines are identical. Folded in, it mixes a refactor with a behaviour change, so a moved post couldn't be traced. Its choice was **leave it: not first, not folded in; do it as its own ticket, golden first.** It also said what would change its mind.

**My calls as the human, choosing the larger option where the price supports it:**
- **LIN-4201: larger than the step-back's B.** Loading becomes part of the read: callers pass a cost source once, pulled in because the task pays for the seven caller edits anyway. The routed copies are removed, not named: the founder-lookup twin, the restated partition, and one `lane`/token vocabulary. The cost code gets a real area. Proving still comes first, and the work may split into pieces if proving needs it. The snapshot fold stays, since pre-deploy lineages still need it.
- **LIN-4203:** the recommended shape plus the intake counter. **The flag must mean one thing:** gate every flush, or be retired.
- **The one Stop sequence: filed as LIN-4218** (Backlog), sequenced after LIN-4203, with a characterization golden first that must be shown to fail when one post moves. It's the first tally row to be priced and filed. It goes through the full loop when LIN-4203 lands.

**LIN-4212 merged (`eb44eff9`) without a Survey.** Place change: none (1262 → 1262, no new files, no pair moved); production +167 / −26. Ledger: 0.

**A pattern worth keeping:** the pricing follow-up is the step that turns "not this task's" into a decision. It can come out as "do it first", "fold it in", or "its own ticket, now queued". Each is better than "someday".

## 4 Nov, about 11:25 UTC: the second pricing (the shared heavy-test harness), and forward trial 2

**The pricing answer** (`21451574`, a fresh agent at simple-dispatcher `502901c`), the tally row named four times:
- **The absence has cost about 1.5–2 builder sessions and about 1,500 lines of single-caller infrastructure.** LIN-4180, LIN-4181 and LIN-4196 each built a piece. The hidden costs:
  - by-hand clean-`main` baselines (three times, once wrong);
  - a guard made vacuous by an env pin;
  - `NODE_OPTIONS` leaking into nested runs;
  - LIN-4186 drifting red unnoticed "because nobody ran the tier";
  - process-group stop now three ways.
- **Building it now costs about half a session** (~300 lines plus tests). Every claim gets a check that can fail: a sentinel file proves "couldn't run" never starts a test; a grandchild-pid check; a census forbidding ad-hoc group kills.
- **Its choice: build it now, small**, before the six tier tickets in Backlog. "Folding it into the next task has been tried three times; each time it was 'not this task's'."
- **Its own rule for changing its mind:** if no tier task is scheduled for a fortnight, leave it. If the next triage starts with a by-hand clean-`main` diff, add a scripted `--baseline` mode.

**My call as the human:** build it now, the smallest version **plus the scripted baseline**. LIN-4187 and LIN-4188 are clean-`main` system-test reds, and their triage starts exactly with that by-hand diff. Then **run LIN-4187 on the new harness**, with LIN-4186 (the same kind of ticket, before the harness) as the comparison. Filed as **LIN-4219** (Backlog, High). This is the first time a tally row became its own task on price.

**Forward trial 2: LIN-4219 through the whole loop, with two arms.**
- Two independent open-0 agents (arms A and B) and one global v1, all at `502901c`.
- **Arm A** gets the step-back with the global view; **arm B** the same step-back without it.
- Same ticket, same base, so the difference in choice is the global voice's contribution. Docket item 3.
- It's also the first simple-dispatcher-only ticket through the global voice. Simple-dispatcher has no area map, so we see whether the place view works from the code and docs alone. Docket item 4.

**Prediction, before the answers:**
- Both arms choose about the same middle option (the ticket is already a consolidation).
- The global view adds placement points arm B lacks: where the harness lives, and which existing copies it must delete in the same change.
- The global answer is thinner on "how the place is now" than on Harbour, because simple-dispatcher keeps no area map and no Periodicals record of its own shape.

### 11:45 UTC: forward trial 2, the A/B result, my scope call, and the kickoff

**The three Surveys at `502901c`** agreed on where LIN-4219 binds:
- the nested environment's preloads, which clear one way here and stay another way there;
- the pre-flight missing the killers if it sits only in `run-system.js`;
- four mismatched process-group stops;
- about 25 unowned ports;
- the baseline brushing the out-of-scope sandbox.

open-0 A and B differed in emphasis. A wanted the env policy table first; B wanted `nestedRunEnv` first. Both are the same first step.

**The A/B on the global voice** (same ticket, same base, two independent open-0 sessions; A's step-back had the place view, B's didn't):

| | Arm A (with the place view) | Arm B (without) |
|---|---|---|
| Option chosen | **B:** one harness, an owner per policy | **B:** one tier module, plus C's env sites in the unit tier |
| Checked the place view? | Yes: confirmed four stop paths and the hand-built `NODE_OPTIONS`; the view **corrected its forecast** (killers bypass `run-system.js`). Ran its own probe: `node --test` turns `exit(78)` into 1, so "couldn't run" needs a side channel | n/a |
| Distinct contributions | a port registry; the pre-flight placed in `systemSuite`/`startHarbour`; an exit-code table; witnesses moved into `npm test` | three env intents (descendant, probe, run); **corrected the ticket** (the vacuous guard is already patched); sorted-JSON baseline with `--against`; a sync group stop for `reap.js` |
| At-merge list | Specific and checkable | Specific and checkable |
| "Not this task's" | `run-mutations.js` split, test-infra map, CI second checkout, per-killer env classification | scheduled or Mac runs of the tier, pinned Harbour, OS-assigned ports, `e2e-smoke.js` |

**Against my prediction.**
- *Both choose about the same middle option:* right.
- *The global view adds placement points:* right, but small: the port owner and where the pre-flight sits.
- *The global answer thinner without a map:* **wrong.** On simple-dispatcher, with no area map, the global agent read the code and docs and gave a full place picture (four stop paths, five env sites, 25 ports, three entry points, and two skip rules that contradict each other). **The place view doesn't depend on Harbour's map.**

**What we learn (one ticket, so tentative).** The global voice changed the **contents** of the choice, not the **option**. Its effect was about the size of the run-to-run difference between two independent open-0 sessions. Arm B, without the place view, found things arm A didn't. So the step-back with good questions (what the place looks like at merge, and what's not this task's) does most of the work. The place view's value is in specific placement and in **correcting the forecast**. That cost one agent and paid for itself here. Whether that holds on a ticket where the obvious way tangles the place (LIN-4176's hub) is the open question: there, the backtest says the global view mattered.

**My scope call as the human: the union of both arms, large, in five pieces**, each proven with its own run of the tier:
1. env first;
2. exit codes and a pre-flight with a side channel;
3. ports with one owner, preferring OS-assigned (B's broad option, pulled in because the 25 files are touched anyway);
4. one group stop, with a sync variant;
5. the scripted baseline.

Written onto LIN-4219 with its at-merge checks, moved to **Todo**, autopilot kicked off (`e3934b14`). LIN-4187 follows on the new harness.

## 4 Nov, about 11:50 UTC: pace for the rest of the run

John: "No rush… we may hit a token limit, but it resets tomorrow morning."

**Plan to "settled":**
- Two chains, in parallel:
  - Costs: LIN-4201, then LIN-4203, then LIN-4218 (with its full loop when LIN-4203 lands);
  - the harness: LIN-4219's five pieces, then LIN-4187 on the harness, with LIN-4186 as the comparison.
- Each merge gets its place change, a ledger row and the builder's answers (q1–q6).
- Then a fresh Seams and Drift reading over the new window.
- **The discussion is tomorrow morning**, with a partial read possible from LIN-4201 alone.

**To save tokens:** check-ins every ~75 minutes, lean (rulings, merges, at-merge readings). Surveys, pricing and the Periodicals rerun happen only when a merge calls for them. If the limit hits, scheduled check-ins resume from this log.

### 13:15 UTC: the first two forward pieces merge, and both are positive

LIN-4219's pieces 1 (`childEnv`, LIN-4220, `52d2c3d`) and 4 (group stop, LIN-4223, `54febbf`) merged in simple-dispatcher. Read against the at-merge checks:
- **Env:** the hand-built sites are gone outside the owner, and a census guards it. ✓
- **Group stop:** gone from `run-mutations.js`; one owner with a sync variant; a census guards it. ✓ **Partial:** two unit tests' own group kills are allowlisted (frozen) rather than removed. That's arm B's call ("the unit tests' group-kill copies stay"), not my scope decision. Worth asking the builder why at the end.
- **Ledger: the first two `+` rows**, both from a tally row that was priced and then given its own ticket. The change is test infrastructure only (+2,353 / −107 lines, mostly characterization and census tests), so the place gained guards and owners, and the files grew.

LIN-4201 is still in progress. LIN-4221 (exit codes and pre-flight) is in progress; LIN-4222 (ports) and LIN-4224 (baseline) are Todo.

### 14:35 UTC: harness pieces 2 and 3 merged (both `+`); a ruling on LIN-4201's production gate

- **LIN-4221** (`90bbf82`): one exit-code table imported by both runners and the harness, a pre-flight, and a gap report. **LIN-4222** (`3330526`): **zero literal ports left** across 35 system-test files; ports are OS-assigned through `ports.js`. That's the broad option the scope pulled in, and it landed. Ledger: four `+` rows from LIN-4219 so far, with only the baseline piece (LIN-4224) to go.
- **LIN-4201's PR is approved and green, and held at the production gate.** The worker says "no session here has" production access. But LIN-4200's own session ran the same script on production through the Railway CLI after John registered the SSH key. That's the **third time a builder didn't know a tool it has** (after LIN-4167 and LIN-4200). The same path leaked the Mongo root password this morning, so I proposed `operator-runs-gate`. My reason gives John the choice: an agent session on that path (never printing the URI), or he runs it.

### 15:45 UTC: the harness is all in; the costs chain waits on John

- **LIN-4224** (`86bde97`) merged: `npm run test:baseline`, plus a docs table of which skip rule applies to which tier. **All five harness pieces have now merged, all `+`.** The parent LIN-4219 is in final review. Then LIN-4187, on the harness.
- **LIN-4201 waits on John to run the production gate himself.** He chose `operator-runs-gate`. The answer was delivered to the agent session, which has no `MONGODB_URI`, so the steps are on LIN-4201 for him. **A gap in the rulings loop:** an answer naming a *person* gets dispatched to an *agent*. The ruling should say where its answer goes.

### 15:55 UTC: the production gate goes back to an agent

John asked whether he's actually needed. He isn't. LIN-4200's session ran the same script on production this morning: the Railway CLI was logged in, an SSH key was registered after his ruling, and `MONGODB_URI` was derived at run time through the tunnel. LIN-4201's session is on the same machine and didn't know. That path is also how the root password reached a transcript. The cleaner fix is a read-only Mongo user, or a read-only proxy route (costs decision 10). John: "whatever is going to be easiest to land is best."

So I sent LIN-4201's close-out session (`795899f6`, follow-up `41c42f3b`) the LIN-4200 path, with strict credential handling: the URI goes into the environment inside one command and is never echoed, written or posted; stop if it can't be done without it appearing. Then the gate per John's criterion, the IXSCAN check, GO or NO-GO on the ticket, and on GO, close-out merges pinned to `a878966c`.

**Correction (John, 16:00 and 16:05): not a fault, and not a design either.** Railway (and hosting generally) isn't integrated through Harbour yet, so agents aren't told about it. That's just the current state. John is relaxed about it: an agent finding it on its own is fine, and an agent pausing to ask is fine too. So the "builders don't know their tools" notes (LIN-4167, LIN-4200, LIN-4201) describe the current setup, not a lesson to act on. How hosting services fit into Harbour is for later.

### 17:10 UTC: LIN-4201 merged, the first costs-chain ticket through the whole loop; LIN-4219 Done; LIN-4187 surveyed

- **LIN-4201** (`2ee4e600`) merged after the agent ran the production gate. Read with the merge's own guide on both sides (a lesson: `place-change.mjs` must take the guide from the commits it compares, not from my branch):
  - **the twin is gone** (`founder-lookup.js` deleted);
  - one loader, the only new importer of the store;
  - one vocabulary module; one fold;
  - **the cost read has a real home** in Runs, beside its store;
  - no new knot, and Other↔Runs shrank;
  - but **LLM↔Runs grew by two edges**: the hub's reach into LLM now sits inside that existing knot.

  Ledger: **+ (mixed).** It's the first costs ticket on the positive side. The baseline window's equivalents (LIN-4177, LIN-4178) were − and −/+. The builder has been asked q1–q6 plus **q7: did the larger scope pay for itself**, and which parts landed as asked (`77d4be68`).
- **LIN-4219 Done** (`7d515d3`). LIN-4187 is surveyed at `7d515d3` (open-0 and global, then a step-back). **Protocol change:** this Survey may run `npm run test:baseline` or the one named system test, because the harness makes running cheap and safe. Before, forecasts ran nothing. We'll see whether running changes what the forecast can see.

### 17:30 UTC: LIN-4187 on the new harness, surveyed by running, ruled and kicked off

- **Both Surveys found the cause by running the one test alone on the new harness** (the protocol change): Harbour LIN-3983 (`d3f67854`) deliberately moved the Sessions view to the 24-hour recency rule, so the test guards a retired contract. **"Cause unknown" became "cause known" before work began.** The harness paid for itself on its first task. For comparison, LIN-4186 (before the harness) spent most of its time finding its cause.
- **Global added two things:** LIN-4188 is probably the same cause, and no scenario records which Harbour contract it pins.
- **I skipped the step-back.** The two voices agreed, the range was clear, and tokens are short today. Noted as a deviation.
- **My calls as the human.** Ruled drift (LIN-3983 was deliberate). Scope large, on price: three of LIN-4181's four "cause unknown" reds turned out to be contract drift. So:
  - re-state the assertion as the new contract;
  - one session-finding helper for both scenarios;
  - LIN-4188 in scope if the same change greens it;
  - move all the leftovers together;
  - **a contract note on every system scenario, with a census.**

  Written onto LIN-4187, moved to Todo, autopilot `db707eb2`.

### 17:40 UTC: LIN-4164's re-clone path, witnessed live

I sent a quiet follow-up (`8e46e5fc`) to LIN-4167's round-2 v2 Survey session (`3039732b`). It finished at 17:18 on 3 Nov and hadn't been touched since, so it was past the 24 h clone window but inside the 7-day record window.
- **It resumed.** "Resuming session 8b624508… Session resumed", with 1,457 minutes idle.
- **The folder was re-created at the same path**, one second after dispatch: `…/simple-dispatcher-workspaces/8b624508-…`, with its `LinearViewer/` clone created at 17:36:06. "Yesterday's checkout" was gone.
- **The fresh clone is at today's `main`** (`d7ceb373`), not the session's original commit. That's as designed, and it's Drift's 11-04 inference (`reap-window-constant-cross-repo`) confirmed: after 24 h, "Reply & continue" carries on in a fresh clone. Uncommitted work from before would be lost.

This is the runtime witness LIN-4164 deferred. **Asking a builder days later works.**

## 4 Nov, about 17:50 UTC: how we carry on

John: "I feel like our process of refining, trying it on real work, and measuring from time to time, is pretty good. The risk is the prompts becoming lists, rules added, but that's something fairly easy to mitigate… I'd be happy to just keep running as we have, until we're confident." He's not too concerned about the test-line growth ("tests are a whole other topic"). He's happy for the Periodicals to run to help track. He agreed the next real test is an ordinary feature ticket through the loop.

**The guard against prompts becoming lists** (John, 17:55: "Happy for prompts to expand, I'm just adding a counterbalance to the temptation to make it a big list of rules, which end up over specialising on Harbour's shape"). The risk is specificity, not length: lessons from Harbour hardening into rules ("check `areas.json`", "add a census", "watch the relay flag"), until the prompt is a checklist shaped like Harbour. That would over-guide, as v2's menu did, and fail on a differently built codebase. **The test for any new sentence: would it make sense on a codebase that isn't Harbour?** If yes, it's a question at the level of the idea, and it can go in ("what would now exist in two places?", "does the check you rely on actually fail?"). If no, it belongs in the codebase's own records (docs, map, reviews, the ticket), which the prompts already read as evidence. The prompt stays general; the place supplies the specifics. Today's simple-dispatcher trial (no map, same prompts, the place still found) is a small sign this holds. Today's word counts, for reference only: open-0 134, global v1 272, step-back 273, after-questions 179, pricing 329.

**Next:**
- Seams and Drift over today's window, after LIN-4203 and LIN-4187 land (late evening at the latest).
- Tomorrow: an ordinary feature ticket through the loop, and q6 to the five baseline-window builders to calibrate builder self-reports against the Periodicals.

### 18:25 UTC: LIN-4203 and LIN-4187 merged (both `+`); LIN-4201's builder on the larger scope

- **LIN-4203:** **simple-dispatcher shrank about 930 lines net.** Every snapshot function is gone, and the flag now gates every record flush (Drift's finding, carried). On the Harbour side, one new homeless file: the intake counter, in the catch-all. **The first ticket in the ledger to make the place smaller.**
- **LIN-4187** (LIN-4188 folded in): all 27 system scenarios carry a Harbour-contract note, enforced by a census. Two reds closed.
- **LIN-4201's builder on q7, "did the larger scope pay?": partly.** Removing the twin paid ("real drift caught cheaply"), and the map placement landed. **"Loading part of the read" didn't land.** I'd priced it as "nearly free, since the seven callers are touched anyway"; the builder: "touching a caller to pass an array is not the same change as making the read async and moving batching into it." It cost a review round trip and was split off as LIN-4226. **Lesson for the human role: price a larger extra like any other piece, and give it its own piece from the start** (as the LIN-4203 pricing did). The builder also flagged: "a production re-measure in an implementation ticket's acceptance… the task was certain to end with the gate open."

**Ledger, forward rows so far:** 8 `+` (the six harness rows, LIN-4203, LIN-4187), 1 `+ (mixed)` (LIN-4201), and 1 neutral (LIN-4212, not surveyed). Baseline: 1 better, 3 neutral, 4 worse, 1 mixed.

### 18:45 UTC: LIN-4218 surveyed, scoped and kicked off; the Periodicals are running

- **Seams and Drift over today's window** are running (autopilot `62fd32d1`, hand-minted as before).
- **LIN-4218 (one Stop sequence)**, surveyed at `d8d186c` with open-0 and global, both of which ran the unit tests.
  - **Both independently found a latent bug, by running it:** with tool activity relayed, defer, blocked and failed post tool activity *after* the status that's meant to be last, so Harbour's `parseParkedWait` would miss the park. The flag is off by default, so it's not live today.
  - **My calls as the human:**
    - preserve the bug in the refactor, named as an exception, and **file the fix separately as LIN-4233** (the pricing lesson: don't mix a refactor with a behaviour change);
    - **go larger**, as both voices recommended: decision/withdraw becomes a slot (three copies and `betweenTextAndStatus` deleted), and the usage flush becomes slot 0;
    - **pieces, golden first**, with a sensitivity proof.

    Step-back skipped again (the voices converged). Moved to Todo; autopilot `ee2a8571`.
  - **Note:** this is the second time today the Survey found a real defect before work began (after LIN-4187's cause). Being allowed to run tests makes the forecast see more.

### 19:35 UTC: LIN-4218 and LIN-4226 merged (both `+`); Seams run 6 agrees

- **LIN-4218** (`bf499a4`): one `STOP_OUTCOMES` table and one `runStopOutcome` for every Stop relay; `betweenTextAndStatus` gone; non-test lines flat; a large characterization golden. It **landed as one PR, not the pieces** the scope asked for. To ask the builder why.
- **LIN-4226** (`c55f0fb3`): the pulled-too-early extra from LIN-4201, now as its own piece. The read loads through a `requestSource` passed in once. F1 +1 edge.
- **Seams run 6** (LIN-4231) **independently agrees** with my LIN-4201 and LIN-4203 rows, and adds the honest caution: "most of what moved on the map is the guide, not the code". The cost read's home was a guide edit; the code growth was two F1 edges, +0/+1 by runtime dependency. Drift is still running.
- **Forward ledger now:** 10 `+` (six harness rows, LIN-4203, LIN-4187, LIN-4218, LIN-4226 small), 1 `+ (mixed)` (LIN-4201), 1 neutral (LIN-4212, not surveyed). Baseline: 1 / 3 neutral / 4 worse / 1 mixed.

### 20:55 UTC: Drift run 2 confirms the routing; rebuild 2 Done; one ruling proposed

- **LIN-4195 (Costs rebuild 2) is Done.** One ruling is open on it (how to label a lineage that ran several models). I proposed `cost-dominant`: it answers where the money went, and it's what's live now.
- **Drift run 2 (LIN-4232)** checked the copies column independently:
  - **All four findings we routed into LIN-4201 and LIN-4203 were resolved or improved.** The 17 earlier Drift follow-ups, pushed as Backlog tickets, are all unmoved. **Pull worked where push sat**, in one window.
  - **The routed fix also orphaned a ticket:** LIN-4214 (the relay-flag residual, filed by an audit) went stale behind the fix LIN-4203 made. Drift: "the loop's tickets are not where owners look."
  - **New defects our tickets left:** the erasure gap from LIN-4203 (LIN-4234), stale snapshot prose, and a second cache copy from LIN-4201. The task-level view and the place change didn't catch these, which is why the Periodical is still needed as the film.

## Summary for the morning (4 Nov, 21:00 UTC), for John

### What we were testing
Whether tasks can finish with the codebase **cleaner than they started**. The loop:
1. **Two Survey voices before work:** local (open-0) and the place (global).
2. **A step-back** that sets out a range of options with prices.
3. **The human's scope call** (Claude in that role today, choosing large where the price supports it).
4. **The build.**
5. **A place reading at merge**, into a ledger.
6. **The Periodicals as independent checks.**

### The ledger (`place-ledger.md`)

| | Better | Mixed | Neutral | Worse |
|---|--:|--:|--:|--:|
| **Baseline** (3–4 Nov, before the place view) | 1 | 1 | 3 | 4 |
| **Through the loop** (4 Nov) | 10 | 1 | 1 (LIN-4212, not surveyed) | 0 |

- **The better rows:** the six harness rows (LIN-4219 and its pieces), LIN-4203 (the first to make the codebase smaller), LIN-4187 (two reds closed; all 27 scenarios carry a contract note), LIN-4218 (one outcome table for every Stop relay) and LIN-4226.
- **The mixed row:** LIN-4201. Its fair comparison is rebuild 1's pieces from the day before, which scored − and −/+.
- **Independent checks:**
  - **Seams run 6 agrees with the map column**, with the caution that LIN-4201's map gain was largely its guide edit.
  - **Drift run 2 confirms the copies column:** all four findings routed into in-flight tasks were resolved or improved, while all 17 pushed follow-ups sit.
  - **Both also found new small gaps our tickets left:** an erasure inventory gap (LIN-4234), stale prose, and a second cache copy.

### What we learned
1. **The place view sees what the task view doesn't**, at the right level. On backtests it named the homeless hub and the founder-lookup twin from the base, but only when run on the piece, not the parent. On simple-dispatcher it worked without any area map.
2. **The step-back with good questions does most of the work.** In the A/B, the place view changed what went into the choice, not which option was chosen. Its effect was about the size of the difference between two separate runs.
3. **Pricing turns "not this task's" into a decision:** do it first, fold it in, or its own ticket now. Two tally rows were priced, filed and landed on the same day (the harness; the Stop sequence).
4. **Routing the Periodicals' findings into in-flight tasks works; pushing them as tickets doesn't.** 4 of 4 routed were resolved; 17 of 17 pushed are unmoved.
5. **Letting the Survey run tests makes it see more.** Two real defects were found before work began: LIN-4187's cause, and LIN-4218's latent park bug (LIN-4233).
6. **Choosing large pays when the extra is priced as its own piece.** LIN-4201's builder: removing the twin paid; "loading part of the read" was mispriced as free and split off (it then landed as LIN-4226).
7. **The Periodical is still needed as the film.** The task-level view missed the erasure gap and the stale prose; Drift caught them.
8. **The guard for the prompts is generality, not length:** would the sentence make sense on a codebase that isn't Harbour?

### Caveats
- Every forward ticket was a consolidation or a rebuild. **No ordinary feature ticket has been through the loop yet.**
- I scored the rows, against criteria logged in advance.
- It's one day.

### Next (with your nod)
1. **An ordinary feature ticket through the loop.** That's the tipping-point test on the work that matters.
2. **q6 to the five baseline-window builders,** to see whether a builder's own account of the place matches what the Periodicals measured (if it does, the ledger gets cheap).
3. **LIN-4233** (the park-status fix) and **LIN-4234** (the erasure gap), through the loop.
4. **Open for you:** the mixed-model label ruling on LIN-4195 (proposed: `cost-dominant`); LIN-4210 (the halt poll); LIN-4214 (stale behind LIN-4203's fix, probably closeable).

## 4 Nov, about 21:10 UTC: overnight, until the token cap or John's morning

John: "happy to continue until either I'm awake in the morning, or we hit the token cap… we generated a fair number of follow ups which we could use."

**Improvements to try, from today's lessons:**
1. **Global v2 adds one general question:** "What else in the codebase would have to learn about what it adds or removes (lists, registries, inventories, docs), and would anything notice if it didn't?" Three of Drift run 2's gaps are exactly this (the erasure inventory, the stale snapshot prose, hand-kept script lists), and the earlier global view missed them. It passes the generality test.
   - **Backtest:** v2 at LIN-4203's forward-trial base (`5334c81a7` / SD `67ff5c3b1`), same ticket text.
   - **Hit criterion, before dispatch:** it names the account-erasure inventory (or "the wipe/erasure list") as something the new intake collection must join. Bonus: it names the user-visible or agent-catalog text describing `[usage]`.
2. **Use the tidy-after:** LIN-4234 (the erasure gap) becomes LIN-4203's tidy-after, with the larger option.
3. **Survey every ticket we start**, follow-ups included. Skip the step-back when the voices converge.
4. **My scope rule:** a larger extra gets its own piece and its own price.
5. **In the morning:** a fresh agent scores the ledger rows blind, as a second scorer.

**Docket:** the v2 backtest; LIN-4234 and LIN-4233 through the loop; then an ordinary feature ticket if tokens allow.

## 4 Nov, about 21:20 UTC: John's steer for overnight (before compaction)

- **Try without routing the Periodicals**, "as if in a repo where they can't be assumed".
  - From now on: don't add Periodicals findings to tickets.
  - The global offshoot runs on **the code alone**: a variant of v2 that drops "whatever records this codebase keeps about its own shape" and says not to read review or periodical reports.
  - Compare the place outcomes with today's routed tickets.
  - LIN-4234 and LIN-4233's Surveys, already in flight, used v2 with records. Their scope calls tonight add no routed findings. New Surveys from here use the code-only variant.
- **Err on the side of larger tidies** in my scope calls, still pricing each larger extra as its own piece.
- **He agrees with the other recommendations:**
  - global v2's "who else must learn about it";
  - LIN-4234 as LIN-4203's tidy-after, large;
  - Survey every ticket we start;
  - skip the step-back when the voices converge;
  - a blind second scorer in the morning;
  - an ordinary feature ticket through the loop.
- He'll compact this session for headroom. **Everything needed to carry on is in this log, `place-ledger.md`, `broad-options.md`, `prompt.md` and the `global-offshoot-prompt*.md` files.** Scratchpad: `check.sh`, and `ft5/` for LIN-4234/4233. The proxy token is `.tok3` (valid to 5 Nov 17:11 UTC).

## 4 Nov, about 21:50 UTC: overnight, first moves

### The global v2 backtest (LIN-4203 @ `5334c81a7`), scored against the criterion logged at 21:10
- **Main criterion: missed.** It doesn't name the account-erasure inventory.
- **Bonus: hit.** It names the `[usage]` wording in `runner-prompt.md` and `runner.mjs` (Drift's `usage-snapshot-prose-residue`, which v1 missed). It also names other docs and comments that describe the snapshot, and a real risk the earlier views didn't: the realised harness/model/effort labels come only from `[usage]`, so moving only the money would silently drift `captureRateShare` and `unknownHarness`.
- **Why the miss isn't the question's fault:** the intake counter was not in the ticket. It came from the step-back (see 08:00, "B plus an intake counter"), after the global view ran. The question never saw the thing that had to join the inventory.
- **The lesson, general enough for any codebase:** *ask "who else must learn about it" of the scope that was chosen, not only of the ticket.* The step-back and the human's call add things; nobody looks at what they add. Tonight I ask it myself, as the human, in each scope's "at merge" list. If it earns its keep, it becomes one line in the step-back or the scope.

### LIN-4234 and LIN-4233: scope calls (larger, no routed findings)
Both pairs of voices converged, so no step-back.
- **LIN-4234 (erasure gap, LIN-4203's tidy-after):** "collection names come from one source for every guard". Three pieces:
  1. the row, plus the universe derived from `lib/` constants (57 → 59, `shares` included);
  2. one shared helper for both the erasure guard and the urlkey-holders guard (open-0 found the second guard misses `request-usage` too), plus a census on `db.collection(<identifier>)`;
  3. `INVENTORY` imports each store's constant (stop after 2 if it doesn't pay).

  open-0 proposed filing piece 2 as a sibling. **I folded it in (larger).**
  **Not added:** the stale `[usage]` prose. It's a Drift finding, and the steer says not to route those.
- **LIN-4233 (park status last):** the hook-side fix as a table rule (every posting row that isn't status-first ends in `S`), with a scheduled-wakeup defer row added to the golden, proved with Harbour's own reader. **Plus, larger, its own piece in Harbour:** `parseParkedWait` scans back past non-status entries, the way `findWakeEvent` does. That way a park read no longer depends on cross-process ordering, and Harbour has one way of reading a park instead of two. The global view had named this as "not this task's, its own ticket".
- Both moved to Todo; autopilot started (`7d4d8c32`, `8b60e611`).

### The code-only global variant
`global-offshoot-prompt-v2-code.md`: v2, with "what to read" changed to the code, its tests and its how-to docs, and no reviews, audits, reports or maps of its shape. This is "as if in a repo where they can't be assumed". Its first use is the ordinary feature ticket below.

### The ordinary feature ticket: LIN-4144 (Home's "Waiting on you" follows open rulings without a reload)
It's new behaviour, not a consolidation. It lands beside an existing 5s badge poll (`public/common.js`) and the typed-answer keeper (`public/prompt-section.js`), so "leave in two places" (a second poll) is the obvious risk. Surveys at `476d9ad47`: open-0 `52c957eb`, global code-only `4a1904d5`.

**What would count as the place view earning its keep here, written before reading:**
- it names the existing poll as the thing to reuse or extend (not a second timer);
- it names the stale-card / double-answer risk, and the settled-ruling guard (LIN-4142) as its partner;
- at merge, the place-change reading shows no new homeless file and no second poll.

### q6 to the five baseline-window builders
Sent to LIN-4168, 4177, 4178, 4179 and 4198, in their own sessions. The question is blind: what did your change leave behind; better, worse or the same?

**Calibration, written before reading:** a builder's account "matches" if it names the same thing the ledger and Drift put against the ticket:
- LIN-4168: the holder registry with no home;
- LIN-4177: the cost hub with no home;
- LIN-4178: the founder-lookup twin;
- LIN-4179: neutral, USD to one home;
- LIN-4198: two readers of the record vocabulary.

If 4 or more of 5 match, a builder's q6 is a cheap stand-in for the place reading. If 2 or fewer match, the Periodical stays the only film.

### 22:05 UTC: the runner stopped claiming work at 21:01:39
Every dispatch since 21:03 is still `queued`: the LIN-4234 and LIN-4233 autopilots, the LIN-4144 Surveys and the five q6s. Harbour flags each one: "No consumer has polled this workspace since 2026-11-04T21:01:39Z". That was just after the 20:55 batch finished. Nothing on Harbour's side is wrong. The dispatcher host stopped polling, and `watch-restart.sh` doesn't relaunch a dead dispatcher (by design, LIN-2446). I can't reach the host from this session. The queue will drain when a runner polls again. Checks continue; nothing else is dispatched until it does.

### 22:30 UTC: the runner is back (John restarted it at about 22:20); LIN-4144 surveyed and scoped; q6 scored

**LIN-4144's Surveys, against the criteria logged at 21:50** (global was code only):
- **Reuse the existing poll, not a second timer: hit** (global: "drive it from the badge's tick instead of starting a second interval").
- **Stale-card double answer and the settled-ruling guard: hit**, from both voices. open-0 found no guard exists at all.
- **Beyond the criteria:**
  - **Both** found the tangle I hadn't predicted. A ruling also moves its task out of Running, so a section-only repaint leaves a task shown twice or nowhere, and no test would notice.
  - **The code-only global** found two copies the obvious way would make: a third card renderer, and a third keep-if-typing reconcile.
  - **It also applied "who else must learn" unprompted:** `llms.txt` and the LIN-4114 E2E both describe a section fixed after load.
  - **Without reports or maps it still saw the place.** That is the second sign (after simple-dispatcher) that the records aren't what make it work.

**Scope (the voices converged; no step-back), larger:**
1. the settled-ruling guard first (LIN-4142 folded in);
2. a narrow server fragment from Home's own reduction;
3. one shared keyed card merge in `question-cards.js`;
4. ride the badge's tick;
5. Home stays consistent when the Waiting set changes (one full read on change);
6. optional: Observation's reconcile onto the shared merge.

Each is its own piece, with a stop-and-say rule on 5 and 6. Autopilot `84fa12ad`.

**q6 from the five baseline-window builders, against the 21:50 calibration: 3 of 5 match.**
- **Matched:** LIN-4178 names the founder-lookup twin; LIN-4179 the lib/public `formatUsd` pair held by a parity test; LIN-4198 two checks of native `costUsd` precedence (the vocabulary's two readers).
- **Missed:** LIN-4168 and LIN-4177. Both ledger items were *no home on the area map*. The builders saw the same files as "one clear owner". A builder doesn't see the map.
- **Balance:**
  - The builders say better 4 times and about the same once. The ledger says − three times, −/+ once and 0 once.
  - **Builders judge against the ticket's own before-state, and are systematically kinder than the place reading.**
- **What q6 is good for:** copies. It found more small second copies than Drift did:
  - three in-memory collection fakes (named by both LIN-4177 and LIN-4178);
  - a copied `bulkWriteWithRetry`;
  - three test-only exports;
  - hand-pinned counts and allow-lists in three tickets.
- **Verdict:** 3 is between the thresholds (4+ = stand-in; 2 or fewer = film only). **q6 is a cheap, good source for the copies column and the tally, not a stand-in for the balance.** It is blind to the map, and kind to its own work. Keep asking it at merge; keep the Periodical as the film.

### 23:05 UTC: LIN-4234 merged, and LIN-4233's first piece (LIN-4239); both `+`, with no routed findings
- **LIN-4234** (`950113b1`), pieces 1 and 2 as scoped:
  - one helper is the single source of collection names for both guards; four hand-added names are deleted;
  - both guards now see `request-usage` and `usage-snapshot-intake`;
  - a census catches `db.collection(<non-constant>)`;
  - the map didn't move, and there are no new production files.
  - **"Who else must learn" was applied by the builder from the scope's at-merge list:** `source-map.md` and the class-guard header updated, the runbook checked and rightly left.
  - **One small debit:** the LIN-4198 single-reader census's allow-list grew by two entries, which is the hand-kept-list pattern from the q6 answers.
  - Piece 3 (`INVENTORY` imports constants) isn't in the merge. The close-out is running; I'll ask why.
- **LIN-4239** (`796bc9d`, simple-dispatcher), LIN-4233's first piece, exactly as scoped:
  - the exception is deleted and the rule stated once, so F1 uses it rather than a third copy;
  - a scheduled-wakeup row is added to the golden;
  - the proof imports Harbour's own `parseParkedWait`, red before the swap and green after;
  - the comments say what still holds.
  - The Harbour reader is the sibling LIN-4240.
- **The first two rows with no Periodicals routing are both `+`.** Both came from their own Surveys, the larger scope and the at-merge list. Too few to call, but no sign yet that routing was what made the difference.

### 23:15 UTC: LIN-4234 Done; the stop rule worked
- **Piece 3 was skipped under the scope's own stop rule.** The builder's reason: "the derived universe already makes a renamed constant red, and the imports would add module coupling". That's a fair price, given without a review round trip. **The scope rule pays: a larger extra as its own piece, with a "stop and say so if it doesn't pay", gets an honest price from the builder instead of a forced landing** (compare LIN-4201's "loading part of the read", 18:25).
- **The review earned its keep:**
  - it ran five mutation checks, including a real planted `lib/` file;
  - it found the new mutation test vacuous;
  - it found an `.mjs` blind spot, fixed at close-out.
- **For John (operator checks the close-out couldn't run, no production access):** were any Full wipes executed between LIN-4203's deploy (17:18 UTC) and this one (23:03)? If so, delete the `usage-snapshot-intake` documents for the wiped keys. Also a dry run of `erase-account.mjs` and `dry-run-urlkey-duplicates.mjs` on the real database, to confirm the new row shows up.
- After-questions q1–q7 sent to its builder (`f0228592`).

### 23:30 UTC: LIN-4240 merged (`+`); LIN-4234's builder on the larger scope
- **LIN-4240** (`279dcb0a`, Harbour, LIN-4233's larger extra):
  - `parseParkedWait` now decides on the newest *state-bearing* entry, skipping tool, usage and resources entries, `[ticket]` markers and stamps, through one predicate;
  - the stale "latest entry decides" wording is rewritten in four places;
  - the cross-process residual that LIN-4239 named is closed;
  - not shared with `findWakeEvent`'s scan (the scope said "if they can").

  The larger extra the global view had called "its own ticket" landed cleanly as its own piece in 20 minutes. After-questions sent to both piece builders.
- **LIN-4234's builder, q7 (did the larger scope pay?):** mostly.
  - The shared helper paid. So did the census, as cheap insurance.
  - Piece 3 was rightly stopped.
  - **The cost was classifying the two collections in the urlkey guard.** It collided with a guard on a different axis: LIN-4198's single-reader census string-matches `'request-usage'`. That forced a judgement call (two allow-list entries) the row-only fix would never have touched. "It should have gone as its own small ticket that settled the LIN-4198 question on purpose."
  - **open-0 had said exactly this:** "file the urlkey-holders gap as a sibling, rather than letting it change the counts inside this ticket." I overrode it to go larger. **Lesson for the human role: when a voice says "separate", it is usually pricing a coupling you can't see. Err larger in *pieces*, not by folding in what a voice said to keep apart.**
- **Two general lessons from its q2 and q4:**
  - **Guards on different axes collide.** Before adding a name anywhere new, find every check that keys on that name. That's a question for the Survey ("what checks would see this change?"), not a Harbour rule.
  - **The broad option behind the "derived census" row:** each collection declared once, with all its facts, and opening an undeclared name fails. Today the facts sit in four tables. Added to the tally.

### 23:55 UTC: a deploy-gate ruling on LIN-4233; both piece builders on the larger scope
- **The ruling:** `lin4233-deploy-gate`. Close-out holds Done until simple-dispatcher's deploy lands; the host is still at `bf499a4`, `main` at `07c88f7`.
  - **Proposed: `close-now`.** The fix only acts with `SD_TOOL_ACTIVITY_RELAY` on, which defaults off, so deploying changes nothing live.
  - **Flagged for John:** the host hasn't followed `main` since tonight's restart. The deploy follower may not have come back.
- **Both builders say the larger scope paid** (LIN-4239: the proof through Harbour's real reader caught a fixture trap and a retry-budget exposure; LIN-4240: the extra skip cases were "nearly free" and closed the race).
- **Both name the same cost:** prose about the joint state written before the sibling landed, then rewritten after. That's two follow-up PRs on simple-dispatcher (#327, #328) of comment churn. **Lesson for splitting across pieces (general): let the prose that describes the joint state land once, with the last piece. Earlier pieces say only what they change.**
- **The same broad option named twice in one night, in two different vocabularies:**
  - LIN-4234's builder: each collection declared once with its facts;
  - LIN-4240's builder: each feedback kind declared once with its role.

  Both are *a vocabulary whose facts are scattered across the readers and guards that each keep a copy*. That's the pattern behind tonight's three tickets (erasure, urlkey classes, park reading). Added to the tally as its own row, beside the collection row.

### 01:20 UTC (5 Nov): LIN-4144's first piece merged; a scoping ruling proposed
- **LIN-4241** (`94195271`, merged 00:01): the settled-ruling guard. **One refusal code for all four routes that can settle a ruling**, on the existing CAS pattern, and the client reuses the existing "gone" event. One small homeless file (the shared constant). Ledger `+ (small)`. **The first row for the ordinary feature ticket is positive.**
- **LIN-4242 (piece B, the live section) in review:**
  - **The review was very good.** It ran nine mutations and found four that stayed green. The builder answered with a merge witness over real markup (8 mutations, each caught), byte-for-byte conformance between the page and the fragment, a de-flaked badge read and cost measured (5 ms median).
  - **It also extracted the keep check as one shared function**, as scoped.
  - **The ruling `lin4242-keep-witness-scope`:** build a repaint witness for the opened task's `keepTypedQuestion` call site, or accept? **Proposed: accept, and make the witness its own follow-up.** The gap predates the ticket (LIN-4024), and it needs a full state fixture, a different-sized piece.
- (A container restart at about 00:00 stopped my watcher; nothing was lost.)

### 01:40 UTC: LIN-4242 merged, the feature's core; scored against the 21:50 criteria
- **No second poll: met.** The `setInterval` count in `public/` is unchanged; the refresh rides the badge's tick.
- **No new homeless file: missed.** `lib/waiting-section.js` (the one renderer, moved out of `render.js`) lands in the map's catch-all, and Pages↔Other grew by one each way.
- **Every copy both voices predicted was avoided:** one renderer for page and fragment, one keep-if-typing check, Home's own reduction.
- **Ledger:** `+ (mixed)`.
- **A pattern worth watching (not yet a finding):** tonight's code-only rows LIN-4241 and LIN-4242 each left one new file without a map home; LIN-4234 and LIN-4240 left none. With no map in the Survey, "home" is judged from the code, and the map lags. That's what you'd expect in a repo with no map, and the honest cost of the steer: **the copies stay down, but nobody tends the homes.** Two rows isn't a trend; LIN-4203 (routed) left one too.
- After-questions sent to LIN-4241's builder. LIN-4242's are held until its ruling is discharged, because its build session *is* the ruling's loop.

### 03:00 UTC: LIN-4144, the ordinary feature, has all three pieces merged
- **LIN-4243** (`172f644a`, piece C, the larger extra): when the Waiting set changes, Home reads its document once and swaps Running, Up next and the count line.
  - The swap waits while the reader has something open.
  - The policy is a pure, unit-tested module with a map home; the DOM swap is in `app.js`.
  - The map is unchanged. Ledger `+`.
- **The feature ticket's three rows: `+ (small)`, `+ (mixed)`, `+`.** On ordinary work, through the loop with the code-only global and no routed findings, the place came out better. The likely obvious way, by both Surveys, would have left a second poll, a third renderer, a third keep check, and a Home that shows a task twice or nowhere. None of those landed.
- **The 21:50 criteria, final:**
  - reuse the poll: **met**;
  - the guard as partner: **met** (it was built first);
  - no second poll at merge: **met**;
  - no new homeless file: **missed by one** (`lib/waiting-section.js`).
- **A gap in the rulings loop:** `lin4242-keep-witness-scope` was **withdrawn automatically when LIN-4242 closed** ("ticket-closed"). The close-out filed no follow-up ("no outside item is unowned"), so the opened-task repaint witness had silently lost its owner. I filed it as **LIN-4246** (Backlog), as the proposed answer said. Worth a look at how Harbour handles an open scope question when its ticket finishes. Today, closing the ticket withdraws the question.
- After-questions sent to the LIN-4242 and LIN-4243 builders.

### 03:05 UTC: the second ordinary ticket, LIN-4151 (`/backlog`'s per-project "Up next" isn't ranked like Home's)
Surveys at `172f644a1`: open-0 `ca6d61ac`, global code-only `c2dd09c1`.

**What would count as the place view earning its keep, written before reading:**
- it names Home's ranking (`upNextOf`) as the one to share, not a second comparator beside it;
- it names that the "show more" fold and `/api/home-rows` must page the *same* order (or there are two orders for one list);
- it says something about the two lists sharing a name but not a rule (rename vs rank), as a place question, not only a UX one.

**At merge:** one ranking function used by both Home and `/backlog`; no second comparator; no new homeless file.

### 03:10 UTC: LIN-4151's Surveys scored (3 of 3), scoped and started
- **All three criteria hit, from both voices** (code-only global):
  - share `upNextOf`'s ranking (both: export one comparator, no copy);
  - page and fold in one order (both: one derivation, because `homeRowsFor` re-splits on its own);
  - name vs rule (both: the page never shows "Up next", so the order is the decision).
- **Beyond the criteria:**
  - "ready only" must sort, not filter, or blocked roots vanish from `/backlog` and break the reachability property;
  - "one per epic" means nothing for roots;
  - the pinned fixtures tie on every key, so a green suite proves nothing;
  - the global: the ticket's acceptance is wrong about dedupe.

  **Again, the forecast corrected the ticket before work began.**
- **Scope:** rank, not rename. Piece 1: one exported ranking, one derivation for page and fold, header and `llms.txt`. Piece 2: the names that now describe `/backlog`, with a stop rule.
  - **Honouring the voice:** the global's "not this task's" (separate eligibility from ranking; split `home-view.js`) stays out and goes to the tally.
  - Autopilot `0949c9f3`.

### 03:45 UTC: LIN-4151 merged (`+`), every at-merge criterion met; LIN-4144 Done
- **LIN-4151** (`13fe24a0`, 27 minutes from kickoff to merge):
  - one exported ranking, used by both lists;
  - one derivation for page and fold; the re-split path is gone (`splitProjectRoots` is no longer exported);
  - readiness sorts, never filters, with five witnesses red before the change;
  - docs updated; map unchanged, no new file.
  - Piece 2 (names): the constant was renamed; the wire and DOM names were deliberately left as they were, within the stop rule.
- **Two ordinary tickets through the loop tonight, four rows, all `+`** (one `+ (mixed)`), with the code-only global and no routed findings.
- After-questions sent to LIN-4151's builder.

### 03:50 UTC: the third ordinary ticket, LIN-4048 (the task page offers "Run to PR" on a finished task)
I skipped LIN-4026: its own text says the write-side option is "a contract change John should hear about first".

**What would count as the place view earning its keep, written before reading:**
- it names LIN-4042's Home fix (`row.finished` in the browser) as a copy this task would duplicate, and the server's `mainActionOf` as the one place the rule could live;
- it says whether Home's browser-side check can go once the server decides (one rule, not two).

**At merge:** "finished means no main run action" is decided in one place, and both surfaces read it. No new homeless file.
