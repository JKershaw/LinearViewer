# LIN-4493 skip: root cause

Read-only check, 19 Nov 2026. Code read at `origin/main` `079f0b6ff`. The incident itself is in `lin-4493-skip.md`. The classifier behaviour described below was run against that commit's `lib/` (a scratch copy) with the 13:37 comment's shape. It was not only read.

## 1. When it arrived

**(a) `prUrls` from every comment: `0dd3c99e3`, 5 Oct 2026, LIN-3300** ("one stage selector on main, with the plan-review facts as plain data").
- It was written as a fact for the stage selector's prompt: the `- PRs linked on the trail: …` line in `formatTrailFactsBlock`. It was display only, for a model to weigh beside the comments themselves, and it never asked whose PR a URL was.
- LIN-4437 (`185305dba`, 12 Nov) later swapped the inline regex for `prUrlsIn`. LIN-4458 (`abc1b921b`, 13 Nov) put it next to `readTrail`. Neither commit changed what it collects.

**(b) look-first's `has a PR`: `7a4446eed`, 8 Nov 2026, LIN-4370** ("code runs the look-first sequence…", LIN-4346 piece 4).
- The commit message gives the route's condition as "no size record, plan or PR". It reused `assembleTrailFacts(...).prUrls` for that, and its one test fixture is the ticket's own landing comment (`Landed: …/pull/7`).

**They were not written together.** The fact was written a month earlier for a model reader. LIN-4370 turned it into a code gate without narrowing it. A model can tell a forward note from a landing report. A non-empty array can't.

**Cross-ticket notes.** No stage template tells an agent to post a forward note citing a PR on a sibling or on the next piece.
- The nearest licences are close-out's "tidy the related tickets … close or cancel the related tickets this work settles, saying why" (`893c15d5e`, 6 Oct, LIN-3326), and breakdown bullet (e)'s "change course and say so on the parent" (`adc638b71`, 3 Oct, LIN-3291).
- The 13:37 note came from LIN-4492's close-out worker on its own initiative, or from that ticket's text. This isn't established (see `lin-4493-skip.md`, Unknown).
- Posting another ticket's work on a tracker is an existing practice: forecasts for LIN-4110 and others were posted on LIN-4150 in early November (`docs/papers/harbour/cleaner-than-it-started-evidence/…/log.at-pin.snapshot:105,158,290`).

**When both halves held.**
- The code half has held since 8 Nov (`7a4446eed`). From then on, any comment with a full PR URL that landed on a fresh leaf before its first dispatch would switch look-first off.
- The posting half has no template date. The first recorded case that triggered the bug is 19 Nov 13:37.

## 2. Readers of `prUrls` / `prUrlsIn`, and whether a foreign PR URL misleads them

`assembleTrailFacts(...).prUrls` (every URL in every comment) has two readers:

| Reader | Affected? |
|---|---|
| `lib/recommendation-look-first.js:152` `has a PR` | **Yes.** This is the bug. |
| `lib/recommendation-facts.js:554` → the selector prompt (`lib/openrouter.js:981`; eval `scripts/eval/lin-3372-selector-context/harness.mjs:141`) | **Yes.** The model is told a PR is linked on the trail. The `review` route's `when` ("a PR … on the trail", `lib/prompts/stage-kinds.js:403`) and rule 2 "Landed work" (`lib/stage-router.js:30`) both invite it to treat the ticket as having landed work. On LIN-4493 the model picked implementation, so this fact pushed the selector toward a later stage than a fresh ticket should get. |

Other readers of `prUrlsIn`:

| Reader | Affected? |
|---|---|
| `lib/run-trail.js:203` `reportsLandedWork` (any PR URL in a plain, close-out, plan-review or audit comment counts as landed work) | **Yes.** It feeds `assemblePlanReviewFacts().landed` (`recommendation-facts.js:342,351`), which lifts the review-loop bound (`:396`). It also feeds `latestPerson.actedAfter` (`:516`), and `isPersonComment` (`run-trail.js:225`, which makes the note "not a person"). |
| `lib/run-trail.js:360-397` `readTrail`: `landing` | **Yes, before a review (or with no close-out anchor).** A foreign PR joins the first landing. This is LIN-4458's "row 15, a stated limit". It reaches the blind-read prompt (`lib/prompt-template-defs.js:1014`), the blind-read write check (`routes/proxy-writes.js:781`, which refuses a read that omits the foreign PR), the close-out dispatch guard (`lib/close-out-readiness.js:87,134`), the blind-read route (`lib/recommendation-blind-read.js:57`) and the run page box (`lib/run-evidence.js:182,277`). On LIN-4493 between 13:37 and its own PR, the landing was `[#2464]` (verified). From the code, not run: the box then reads #2464's status as "merged", and `followsPerson` is `'merged'`. |
| `lib/run-trail.js:386-388` `workAfterReview` | **Yes.** A plain comment citing any PR after the review counts as work. See §3. |
| `lib/run-evidence.js:36` `extractPrUrls` → `state.prUrls` | **Yes, display.** `deriveState` picks a lone foreign PR as the page's PR ("done: PR #2464"). `lib/pr-state-store.js:108` `resolveRunPrRef` picks it too, or answers `multiple` once the ticket's own PR is there. |
| `lib/ci-wake-sweep.js:337` (a bare `#N` in a park message matched by number against the comment PRs) | Marginal. Only a park that names the foreign PR's number is affected. |
| `lib/run-trail.js:268` `latestReviewRef`, `lib/run-ledger.js:451` `checkBlindReadShape` | No. Each reads its own comment's body. Only affected if the note is first misclassified as a review (§3). |
| `scripts/stability-measures-blind.mjs:102` | No. It filters the landing by repository and number. |
| Pipeline/churn pages, `lib/dispatch-wake.js`, `routes/proxy-compute.js:153` | No. They read the run's own messages or the event's own `prUrl`, not comments. |

## 3. Similar bugs, ranked by real risk

Each item gives what the reader keys on, the example that trips it, and how likely it is today.

1. **Close-out kind is set by "close-out" anywhere in the first heading, wherever that heading sits** (`run-trail.js:136`; since LIN-3300; pinned by census row `Merged.\n\n## LIN-1 close-out`). **Real; it already fired.** The 13:37 note, "## Rule from LIN-4492 close-out: …", **is classified as a `close-out` on LIN-4493** (verified).
   - Before a review: `closeOutOnTrail` is true, #2464 joins the landing, and the run page shows the box "merged".
   - If a note like it lands after a sibling's review: the selector gets "Close-out reported after it: yes", and the foreign PR joins the landing that the blind read must name (verified: landing `[own, #2464]`, `routesRead` true).
   - Close-outs naturally put "close-out" in a forward note's heading. The parent LIN-4491 now has a close-out-kind comment too.
   - (By luck, once LIN-4493 gets a review, this "close-out" before the review becomes the landing anchor and drops #2464 from the landing.)
2. **Any PR URL in a plain comment counts as work after review, or as landing.** Keys on `work: cites-pr` / `landing: all`. **Real; medium.** The same note with a non-close-out heading ("## Heads-up from LIN-4492 … pull/2464"):
   - After a review: `workAfterReview` is true, so the selector sees "work reported after it", which pulls toward a fresh review, and the blind-read route stands aside (`routesRead` false). Verified.
   - Before a review: row 15's limit. The blind read is asked to name, and is checked against, the foreign PR.
   - This needs the sibling to be in flight when the note lands. Under strict sequential autopilot that's less common than the fresh-ticket case. Parallel pieces make it likely.
3. **`isPersonComment` reads an unheaded agent note with no PR URL as a person's comment** (`run-trail.js:221`). **Real; medium-low.** Example: "Heads-up from LIN-4492: use the run id, not the token." This is verified `person: true`.
   - Posted after a sibling's sequence starts, it holds look-first ("a person's comment holds it") until the next run.
   - The selector reads it as the latest person's word (rule 1, `openrouter.js:946`).
   - A headed note escapes this. The 13:37 note was headed.
4. **Plan comment: the first line opens with "Plan", or there's an `Implementation Plan` heading anywhere** (`run-trail.js:194`). **Low-medium.** Example: "Plan for this piece lives in LIN-4491's description; …". This is verified to give `has a plan` and so switches look-first off. A forward note quoting a plan section trips it the same way.
   - Breakdown (e) writes go to the parent, which is a node (`leaf: false`), so those are not read.
5. **Ruling: the body ends with `— Ruling recorded via Harbour`** (`run-trail.js:211`). **Low.** A note that quotes another ticket's ruling as its last line is verified `isRuling` true. It becomes this ticket's `latestRuling` and a person's comment. Nothing posts this today.
6. **Review kind: "review" in the first heading (not a plan review) plus a verdict word anywhere** (`run-trail.js:71`). **Theoretical.** Example: "## From LIN-4492's code review: … approved …". The selector is then told "Latest code review: unknown (13:37)" (verified), and `latestReviewRef` and the revision brief would read it. Plan-review headings quoted cross-ticket count as verdicts in the same way (`recommendation-facts.js:302`). No current producer.
7. **Survey `attempted` (look-first:137): the first line opens exactly with the survey heading.** **Theoretical for look-first.** The heading's `LIN-xxxx` is never checked against the ticket. Surveys of other tickets were posted on the LIN-4150 tracker, but a tracker isn't a leaf, so look-first doesn't run there.

**Not risks:**
- Size record: `readSizeRecord` reads only the description outside the As-asked block, never comments (LIN-4368).
- `DECISION:` lines: read from runs (`openDecisionLoopIds`), never from comments.
- Blind read: an exact first-line heading, then a shape check and a landing-set check.

## 4. Tests that pin current behaviour

- `tests/unit/lin-4370-look-first-route.test.js` (`has a PR` from any PR-URL comment)
- `tests/unit/stage-selector-input.test.js` (`facts.prUrls` collects every comment's URLs, including a foreign `a/b/pull/1`)
- `tests/unit/lin-4438-blind-read-gate.test.js` (row 15: a foreign PR stays in the first landing)
- `tests/unit/lin-4458-trail-characterization.test.js` (row 15; `state.prUrls` order)
- `tests/unit/lin-4458-comment-kind-census.test.js` (close-out from the first heading anywhere)
- `tests/fixtures/stage-router-prompts/router.*.txt` and `scripts/eval/meta-prompt.baseline.txt` (the "PRs linked on the trail" line)
- Downstream of `extractPrUrls`: `tests/unit/pr-state-store.test.js`, `tests/unit/ci-wake-sweep.test.js`, `tests/unit/lin-3285-installation-pr-read.test.js`, `tests/unit/lin-4432-audit-notes-pr.test.js`

## Right behaviour (one sentence)

A trail fact that gates a code route should count only what this ticket's own comments report as their own: a PR this ticket opened or landed, or a heading that opens a comment of that kind. A comment that only mentions or quotes another ticket's PR, close-out, plan, review or ruling shouldn't count.
