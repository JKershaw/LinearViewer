# Survey spikes: log

A running log of the overnight run of 2 to 3 November 2026 and after. The newest entries are at the bottom. The plan is `../survey.md`, and the prompt is `prompt.md`.

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
