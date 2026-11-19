# LIN-4493 skip: what look-first's checks were for, and has it happened before

Read-only check, 19 Nov 2026. Code read at `origin/main` `079f0b6ff`. Live data comes from proxy GETs only (issues, dispatch lists, `/cost`) and PR bodies from the GitHub REST API. Replays ran `lookFirstOff`, `lookFirstStep`, `CODE_ROUTES` and `blindReadStep` from scratch copies of `lib/` (origin/main, and the newest main commit before each dispatch; deploys may lag those commits). Incident detail is in `lin-4493-skip.md`, root cause in `lin-4493-rca.md`.

## 1. Intent

The source for LIN-4370's checks is LIN-4346's plan, its two plan reviews (22:33 and 22:42, 7 Nov), LIN-4370's description and comments, PR #2370's body and the module comment. LIN-4346's plan text itself is gone from its description (pruned at close-out), so its reasons come from the reviews and the PR. LIN-4465 only moved the route into `CODE_ROUTES` and says outright "Route outputs are unchanged". It changed no check.

**What the route is for.** The module comment says: "A fresh ticket with no size of the move yet goes survey-task, then survey-place, then scoping". It also says: "It never overrides a person's word on work already under way, never runs on blocked work, and never sends the same step twice."

**`has a plan` and `has a PR`: leave tickets that are already in flight alone.**
- Plan review 9e68fbc1, note 3, raised tickets in flight: "decide on purpose what happens to tickets with Surveys and a hand size comment but no plan (LIN-4348, LIN-4358): after merge the route would send them to scoping."
- The approved answer, carried into LIN-4370's description: "any ticket with a plan is untouched". Verdict d71c7085, note 5: 'Your rule "any ticket with a plan is untouched" already handles it if it has a plan by the time you merge.'
- The PR clause was applied the same way. From LIN-4370's build note (0e384424): "LIN-4358 has PRs on its trail, so the route leaves it alone."
- A plan that lives in the parent doesn't count. From review 2aa0d2f6: "a breakdown child still gets the sequence matches LIN-4346's plan".
- **Why the PR check reads every URL.** PR #2370, engineering choice 4: "'No PR' reuses the facts' `prUrls` (any PR URL on the trail), so the route has the same notion of a PR as the facts line. Residual risk: a filing comment that links an unrelated PR turns the route off. The ticket then goes to the selector, which is today's behaviour."
  - So the over-match was seen and accepted. It was pictured as a rare filing comment, with the selector as a safe fallback.
  - The fallback isn't safe. The selector can never offer the Surveys (`route: null`), so a fresh ticket that falls to it skips look-first for good.
  - The 19 Nov comment wasn't a filing comment. It was a forward note from a sibling's close-out.

**The other stand-aside checks, with their stated reasons:**
- **Open blocker, and newest run waiting on a person.** Plan review 9e68fbc1: "The eligibility list also leaves out what rule 3 would stop: an open blocker relation, or an unanswered ruling on the ticket." Verdict d71c7085, note 1: an unanswered ruling stands the route aside "only while its run is parked".
- **A person's comment holds it.** Plan review 9e68fbc1: "say what the exclusion is protecting (a person's word that holds the work or redirects it) and define it so filing context feeds the sequence instead of switching it off."
- **Runs unknown.** PR #2370, choice 2: "If the read fails, the route cannot see which steps were attempted, and re-sending a step is the one failure it must not have."
- **Size recorded.** The route exists to produce the size record (LIN-4346's Done-when: "That ticket is looked at and sized with no one writing its scope by hand"). Once a size is recorded, the job is done.
- **No As-asked block, not a leaf, completed or canceled.** These are listed in LIN-4370's eligibility clause. I found no reason written beside them beyond the "fresh ticket" framing.

## 2. Has it fired before?

**How I sampled.** I read the per-ticket dispatch list (`GET /dispatch?issueIdentifier=`) for LIN-4250 to LIN-4505. Each list was complete, not truncated. A ticket's first stage dispatch is its first row that isn't `wake`, `custom`, `autopilot` or `abort`.
- 80 tickets had their first stage dispatch after PR #2370 merged (8 Nov 14:30).
- I didn't check tickets outside that range. The unfiltered list returns only the newest 100 rows, which reach back to 14 Nov. Every ticket in it is inside the range.

| First stage | Count | Why |
|---|---|---|
| survey-task | 64 | Look-first applied. |
| scoping | 10 | All gate-marked Periodical reviews (`isPeriodicalReview` true): LIN-4411, 4412, 4413, 4418, 4442, 4443, 4444, 4481, 4482, 4483. Look-first applied. |
| survey-place | 2 | LIN-4461 and LIN-4462. survey-task was run by hand as a `custom` row, and its Survey comment was on the ticket, so it counted as attempted. Look-first applied. |
| close-out | 1 | LIN-4458. Every step was a hand `custom` beat, including the Surveys and scoping. Look-first was bypassed by hand. It didn't stand aside. |
| **implementation** | **3** | **LIN-4439, LIN-4469, LIN-4493. All three are `has a PR`, caused by a sibling's PR in a comment.** |

**The three cases.** All three are fresh breakdown leaves: an As-asked block, no runs, and blockers Done before the dispatch. `promptName` is `implementation`, which is the descent arm's signature. A kind override stores `implement`.

**LIN-4439, 12 Nov 21:17** (dispatch `219d9800`).
- At 21:16 a comment said "**Unblocked: LIN-4438 is Done.** The close-out gate is live: …/pull/2413". PR #2413 is LIN-4438's.
- The blocker LIN-4438 completed at 21:15:33.
- `/cost` shows 3 `recommend` calls, matching the three selector-chosen stages: implementation, review and close-out. Its blind-read was code-routed.

**LIN-4469, 13 Nov 22:39** (dispatch `b86c4a78`).
- At 21:49 a comment said "## Condition on LIN-4467's budget raise, for piece 5 … (PR …/pull/2444)". PR #2444 is LIN-4467's.
- The blockers LIN-4467 (22:04:57) and LIN-4468 (22:38:02) were Done before the dispatch.
- The skip was seen at the time but not explained. Autopilot note on LIN-4448, 22:39: "recommend-and-dispatch on LIN-4469 (piece 5) sent `implementation` directly … with no size record, plan, PR or earlier run, so the look-first sequence … did not run. I did not override or abort … Recorded as raw material for the look-first rule." It missed the PR URL in the comment.

**LIN-4493, 19 Nov 13:52** (dispatch `8385df16`).
- The case in `lin-4493-skip.md`. PR #2464 is LIN-4492's.
- The bad row was aborted. survey-task, survey-place and scoping were then sent at 14:28, 14:32 and 14:37, and implementation again at 14:41.

**Replay.** For each ticket I rebuilt its state at dispatch time: the As-asked block as it reads now (it is sealed), the comments posted before the dispatch, `allRuns: []`, and no open blocker.
- With the comment, `lookFirstOff` gives `'has a PR'` and every `CODE_ROUTES` entry returns null.
- Without the comment, the route gives `survey-task`.
- This holds both at origin/main and at the main commit live before each dispatch (`88eff897c` and `b937237a4`).

**Unknown.**
- For LIN-4439 and LIN-4469, what sat below the As-asked block at dispatch time. LIN-4469's autopilot note says "`## As asked` and `## Current`" with no plan or size record.
- Whether each recommend call was the dispatching one. The `/cost` ledger has no timestamps.

So the count is 3 of 80. The same shape caused all three: a sibling's close-out or unblock note quoting that sibling's PR.

## 3. The RCA's other leads: real cases only

I classified all 887 comments on the 90 tickets that had any dispatch since 8 Nov with origin/main's `lib/run-trail.js`. Then I checked what was routed next.

- **Lead 2 ("any PR URL in a plain comment is work after review"): one real case, LIN-4399 (a parent node).**
  - The review (22:47, 12 Nov) approved. At 01:06 on 13 Nov a plain comment reported "Stability Review run 6 (LIN-4442) … …/pull/2417". PR #2417 is LIN-4442's.
  - Replay of `blindReadStep` at `e2d4659c4` and at origin/main: with that comment it stands aside. Without it, it sends `blind-read`.
  - Close-out `b215bef3` went at 01:07 with no blind read. The close-out wrote: "There was no PR left to merge, so no blind read was due."
  - Unknown: whether that close-out came from the selector or a kind override (`promptName` `close-out` is the same for both). Also unknown: whether skipping the read did any harm. Every child PR had already merged.
  - LIN-4448 had foreign-PR notes after its review too, but the replay shows no difference there.
- **Lead 1 (close-out kind from "close-out" anywhere in the first heading): none shown.**
  - The only cross-ticket instance in the sample is the 13:37 note itself, on LIN-4493 and on LIN-4491.
  - LIN-4493's skip came from `has a PR`. LIN-4493 has no review yet, so the facts this kind would feed haven't been reached.
- **Lead 3 (an unheaded agent note read as a person's comment, holding look-first): none shown.** Every non-Periodical ticket that got survey-task went survey-task, then survey-place, then scoping with nothing between them.
- **Lead 4 (plan from a first line opening "Plan"): none shown.** No first dispatch stood aside for `has a plan` (the only non-Survey first stages are the three above), and no sequence was interrupted.
- **Lead 5 (ruling suffix): none shown.** The 36 ruling-marked comments in the sample read as rulings on their own ticket.
- **Leads 6 and 7 (review or Survey headings for another ticket): none shown.** No review, Survey, plan-review or blind-read comment names another ticket in its first line.

## 4. The smallest fix

Look-first's `has a PR` check should count only a PR that belongs to this ticket, so a comment that mentions or quotes another ticket's PR leaves a fresh ticket fresh. A PR this ticket opened or landed still turns the route off, as it did for LIN-4358.

**What it retires:** PR #2370's choice 4, that the gate shares the facts line's notion of a PR (any URL on the trail), and the residual risk accepted there.

**Out of scope:** the selector's "PRs linked on the trail" fact and the other `prUrlsIn` readers. None is shown here to have changed a decision, except lead 2's single node case above.

**Tests that pin current behaviour (names only):**
- `tests/unit/lin-4370-look-first-route.test.js`: "a plan, a PR, a size record, children, no As-asked block, completed or canceled, an open blocker, a waiting run, unknown runs". Its PR fixture, `Landed: https://github.com/o/r/pull/7`, carries no ticket identity.
- `tests/unit/stage-selector-input.test.js`: "PR links and the latest ruling are read from every comment, in time order". It pins a foreign `a/b/pull/1` in `facts.prUrls`. It is affected only if the fix narrows the shared fact rather than the gate.
- `tests/unit/lin-4432-audit-notes-pr.test.js`: "after the notes PR's review and close-out, the trail fact says an audit already ran on this landing…". It asserts that the notes PR is in `prUrls`. Same condition as above.
