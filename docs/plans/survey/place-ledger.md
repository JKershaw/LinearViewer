# The place ledger: does a finished task leave the codebase better?

John's tipping point (4 Nov): when a task, on average, leaves the codebase even a little better once it's finished, we're in a strong place. Bigger improvements not tied to a ticket can stay with the Periodicals and the tally of broad options (`broad-options.md`). This ledger keeps the running answer, one row per merged ticket.

**How a row is read.**
- **Map:** `experiments/place-change/place-change.mjs <repo> <merge>^ <merge> scripts/code-shape/areas.json`, covering new files with no home, two-way pairs grown or shrunk, and new or closed pairs. It's LinearViewer only for now, since simple-dispatcher has no area guide.
- **Copies:** what the next Drift & Coherence reading attributes to the ticket (new rows, improved rows), plus files and functions deleted.
- **Carried:** whether the ticket carried any tally row or routed Periodicals finding.
- **Balance:** `+` better, `0` neutral, `−` worse. It's a judgement from the three columns above, written with its reason. **Guide edits are counted separately**: a home on the map is credited only if the area is real.

## Baseline: the window `015aa4c6..5334c81a` (3–4 Nov), measured before the loop's place view existed

| Ticket | Map | Copies (Drift 11-04) | Carried | Balance |
|---|---|---|---|---|
| LIN-4168 one test reset | +5 cross-area; 2 new files with no home | `key-state-residue` (informational) | n/a | **−** a holder registry with no home on the map |
| LIN-4166 quiet follow-ups | no change | none | n/a | 0 |
| LIN-4173 one exported 7-day window | no change | removed a Harbour copy of the window; `reap-window-constant-cross-repo` still open | n/a | **+** (small) |
| LIN-4177 one cost read | +7; 2 with no home (the hub); two pairs grew, two shrank | `cost-fold-partition-restated` (new); USD 12 → 5 | n/a | **−/+** six engines gone, but a hub with no home |
| LIN-4178 KPIs on the read | +11; 1 with no home; Pages↔Other and Other↔Runs grew | `lineage-identity-read-twins` (new, `founder-lookup.js`) | n/a | **−** a new twin, invited by the ticket's own wording |
| LIN-4179 Harbour calls on the read | +7; Pages↔Other and LLM↔Other grew; Other↔Runs shrank | USD to one home plus a pinned twin (improved) | n/a | **0** |
| LIN-4198 request-usage intake/store | +5; files have a home; three Runs knots +1 | `usage-record-vocabulary-two-readers` (new) | n/a | **−** (small); new capability, expected to grow |
| LIN-4202 runner-kit records | no change | `usage-relay-flag-partial` (new, SD side) | n/a | **−** (small) |
| UI operator's four (LIN-4106, 4107, 4110, 4040) | no change | `task-page-state-outside-owner`: borderline | n/a | 0 |

**The baseline ratio, by row:** 1 better (LIN-4173), 3 neutral (LIN-4166, LIN-4179, and one row for the UI operator's four), 4 worse (LIN-4168, LIN-4178, LIN-4198, LIN-4202), 1 mixed (LIN-4177). On average, a task in this window left the place a little worse, including the careful, surveyed consolidations.

## Forward rows (the loop with the place view)

| Ticket | Map | Copies | Carried | Balance |
|---|---|---|---|---|
| LIN-4212 (records read by posting row; **no Survey**: filed and started mid-lineage) | no change (1262 → 1262; no new files, no pair moved) | prod +167 / −26; Drift not yet re-read | nothing routed | **0** |
| LIN-4201 (records-first read) | Same guide on both sides (the merge's): +8 cross-area imports, no new pair; Other↔Runs shrank; **LLM↔Runs (the High F1 knot) +2 edges**. Every new file has a home. **The guide edit gave `cost-read`, `row-usage` and `lineage-membership` a home in Runs**, beside their store: a real home, counted separately. `cost-format` is still in the catch-all | **`founder-lookup.js` deleted (the twin is gone)**; one loader, the only new importer of the store; one vocabulary module; one fold. Prod +804 / −202 | carried 3 of the 4 routed findings for certain (twin, vocabulary, home); the restated partition and "loading part of the read" are to confirm with the builder | **+ (mixed)** copies down and homes given; the hub's reach moved into the existing F1 knot rather than removed; net +602 lines |
| LIN-4203 (stop snapshots) | Harbour: +2 cross-area imports; **one new file without a home** (`lib/usage-snapshot-intake.js`, the intake counter, in the catch-all); Other↔Runs +1 | **simple-dispatcher shrank about 930 lines net** (non-test +42 / −315, tests +119 / −778); `postUsageSnapshot`, `walkUsage`, `postUsageFeedback`, `fetchSessionRollup` and `usageDelta` all gone; **the flag gates every record flush** (Drift #9 carried) | the routed relay-flag finding | **+** the first ticket in the ledger to make the codebase smaller; one small homeless file |
| LIN-4218 (one Stop sequence) | simple-dispatcher: **one `STOP_OUTCOMES` table and one `runStopOutcome` executor** for every Stop relay; `betweenTextAndStatus` gone; usage flush in the table | non-test +249 / −251 (flat); tests +21,833 (the characterization golden); landed as **one PR**, not the pieces the scope asked for | the tally's "one Stop tail" row (three namings), priced; latent park bug preserved and filed (LIN-4233) | **+** one owner for the relay order in place of seven hand-wired cases; the next relay is one table edit |
| LIN-4226 (loading part of the cost read, split off from LIN-4201) | Harbour: +2 cross-area; **LLM↔Runs (F1) +1**; no new files | prod +252 / −151; the read loads through a `requestSource` passed in once | the pulled extra, now as its own piece (as the builder said it should have been) | **+ (small)** the next input touches no caller; one F1 edge |
| LIN-4220 (harness 1/5: `childEnv(mode)`) | simple-dispatcher, no map. **One owner for nested envs**: the five hand-built sites moved onto `test/child-env.js`; `delete env.NODE_TEST_CONTEXT` and hand-built `NODE_OPTIONS` gone elsewhere | `child-env-census` guards it; tests +1,351 / −65 (characterization, drift and census tests) | the tally's shared-harness row | **+** a decision spread over five places now has one owner and a guard |
| LIN-4223 (harness 4/5: one group stop) | `stopGroup`/`groupAlive` out of `run-mutations.js` into `test/system/harness/stop-group.js`, with a sync variant for `reap.js`; Harbour's stop uses it | `harness-kill-census` added, but **two unit tests' own `process.kill(-…)` are allowlisted, not removed** (the scope said gone); tests +1,002 / −42 | same | **+** one owner and a guard; partial against the scope (the two copies are frozen, not deleted) |
| LIN-4221 (harness 2/5: exit codes and pre-flight) | one `exit-codes.js` imported by both runners, `harbour.js` and `isolate-run.js`; `preflight.js` with a gap report | tests +1,147 / −66, including a characterization of the mutation runner's exit codes | same | **+** "couldn't run" now has its own code and one owner |
| LIN-4222 (harness 3/5: ports) | **0 literal ports left** in `test/system/*.test.js` (35 files touched); `ports.js` owns them, OS-assigned, with an empty fixed-port registry | tests +427 / −69 | same; took the broad option (OS-assigned) | **+** a prerequisite removed rather than checked |
| LIN-4224 (harness 5/5: scripted baseline) | `npm run test:baseline` (a `git worktree` of `main`, JSON, `--against`) replaces the by-hand table; the docs say which skip rule applies to which tier | tests +1,464 / −11; docs +135 / −17 | same | **+** a by-hand procedure done three times (once wrong) is now one command |
| LIN-4219 (heavy-test harness, parent) | Done (`7d515d3`: the group-stop witnesses now run in `npm test`) | | | **+** (its five pieces above) | | the tally's shared-harness row (four namings), priced; scope: the union of both step-backs, in 5 pieces | |
| LIN-4187 (+ LIN-4188 folded in) | simple-dispatcher: **27 of 27 system scenarios carry a Harbour-contract note**, enforced by `system-contract-census`; the assertion re-stated as Harbour's current contract | tests +286 / −57; non-test ±6 | ruled drift; the larger scope landed, LIN-4188 included | **+** the next drift reads "Harbour changed X"; two reds closed in one ticket |
| LIN-4234 (erasure gap, LIN-4203's tidy-after; **no routed findings, scope large**) | no change (1261 → 1261, no pair moved, no new production file) | **one source of collection names** (`tests/helpers/collection-names.js`) for both the erasure and the urlkey-holders guards; four hand-added names deleted; both guards now see `request-usage` and `usage-snapshot-intake`; a census on `db.collection(<non-constant>)`. Against that, the LIN-4198 single-reader census's allow-list gained two entries. Prod +9 / −2; tests +175 / −36 | nothing routed (steer); its own Survey found the second guard's gap | **+** a blind spot closed in two guards at once, not one gap patched; "who else must learn" applied (source-map and the guard header updated, the runbook checked and left) |
| LIN-4239 (LIN-4233 piece 1, simple-dispatcher; **no routed findings**) | no map | `statusLastTrailingTool` gone; **a table rule** (every posting row that isn't status-first ends in `S`) in one helper, used by the golden and by F1, so no third hand-rolled check; the proof imports Harbour's own `parseParkedWait`. Non-test +26 / −24 | nothing routed | **+** an exception deleted and the rule stated once; the cross-process residual named, with its fix as the sibling LIN-4240 |
| LIN-4240 (LIN-4233 piece 2, Harbour; the larger extra, **no routed findings**) | no change (1261, no pair moved, no new file) | **a park is read past non-state entries** (tool, usage, resources, `[ticket]` markers, stamps) through one predicate beside the stamp kinds; the `since` walk uses the same one; the stale "latest entry decides" wording rewritten in four places (`render-run-steps`, `dashboard-feed`, `dispatch-integration.md`, the docblock). Not shared with `findWakeEvent`'s scan. Prod +54 / −20 | nothing routed | **+** a park read no longer depends on what another process posts last; the cross-process residual LIN-4239 named is closed. Builder's q6: the skip list sits apart from the kinds list, untied (a small second copy) |
| LIN-4241 (LIN-4144 piece A, the settled-ruling guard; **the ordinary feature's first piece**, LIN-4142 folded in; no routed findings) | +3 cross-area imports; **one new file without a home** (`lib/ruling-settled.js`, the shared refusal constant, in the catch-all); no pair moved | **one refusal (`ruling-settled`) used by all four routes that settle a ruling** (answer, dashboard dismiss, scan dismiss, the answer route's settled row), not four; `markDecisionAnswered` made check-and-stamp on the existing CAS pattern (reused, not a second); the client treats it as "answered elsewhere" through the existing `RULING_GONE_EVENT`. Prod +323 / −48 | nothing routed | **+ (small)** new behaviour landed through existing seams with one shared code; one small homeless file. Builder's q6: the per-submission id travels only on the card path, so one route behaves two ways by caller (Rulings tab, agents don't send it) |
| LIN-4242 (LIN-4144 piece B, the live section; ordinary feature; no routed findings) | +5 cross-area imports; **Pages↔Other grew 8/6 → 9/8**; **one new file without a home** (`lib/waiting-section.js`, the one renderer, in the catch-all) | **one renderer for the page and the fragment** (moved out of `render.js`, −46 there); **no second timer** (`setInterval` count unchanged: the refresh rides the badge's tick); **one keep-if-typing check** (`QuestionCards.keepsReaderPlace`, used by the merge and by `keepTypedQuestion`); the fragment reads Home's own reduction, pinned byte for byte against the page; `llms.txt` and the LIN-4114 E2E updated. Prod +348 / −62 | nothing routed | **+ (mixed)** the obvious copies (second poll, third renderer, third keep check) all avoided; but the new module has no home on the map and a two-way pair grew. The opened-task repaint witness is a ruling (proposed: its own follow-up) |
| LIN-4243 (LIN-4144 piece C, Home placement follows the Waiting set; the larger extra; no routed findings) | no change (1269, no pair moved); **the new file has a home** (`public/home-placement.js`, in Front end: browser code) | **the policy is a pure, unit-tested module** (when to swap, what blocks it), the DOM swap in `app.js` (+156, a large file grown); one read *per change*, not per tick, as scoped; `llms.txt` states its one limit. Prod +289 / −5 | nothing routed | **+ (mixed)**, revised from `+` after the builder's q6. The tangle both voices found (a task shown twice or nowhere) is closed and the policy is kept out of the page script. But "nothing got simpler": **Home's rendered HTML is now an input the client parses** (selectors become a contract with `render.js` that only E2E guards), the expanded-state replay exists twice, and there's a new one-reader global |
| LIN-4151 (`/backlog` lead roots ranked; **the second ordinary ticket**; code-only global, no routed findings) | no change (1269, no pair moved, no new file) | **one ranking** (`rankKeysOf` + `compareRank`) used by Home's Up next and the project split, no second comparator; **one derivation** for page and fold (`buildHomeView` returns `projectSplits`, `homeRowsFor` pages it; `splitProjectRoots` no longer exported, so it can't be re-split); readiness sorts, never filters; header, `llms.txt`, `source-map.md` and the "Home's folds" comment updated. Prod +111 / −50 | nothing routed | **+** a second split path removed while fixing the order; every at-merge criterion met. Builder's q6: `orderIssuesForSwipe` is still a second "what's next" ranker (Drift's three rankers are now two); the wire and DOM names now name a list that isn't Up next |
| LIN-4048 (the task page on a finished task; **the third ordinary ticket**; the Survey found the reported bug already fixed; code-only global, no routed findings) | no change (1269, no pair moved, no new file) | the rule stays **in one place** (the server's `runOfferOf`): **no browser code reads the tracker's finished word** (`.finished` reads in `public/`: 0); the task page and Swipe now match Home's run block; a held run keeps its Stop; the review caught an ordering bug (quota-limit Go before the no-run branch) and it was fixed. Prod +25 / −12 | nothing routed | **+** the obvious fix (a second, browser-side owner) never landed; two real residues closed instead |
| LIN-4143 (the task page's ruling reads; **the fourth ordinary ticket**; premise stale, confirmed by a witness green at base; code-only global, no routed findings) | no change (1269, no pair moved, no new file) | **no parameter left to forget** (`liveGuard` occurrences in `lib/`/`routes/`: 0): the guard is unconditional in the one reduction, pinned first by a characterization snapshot; **the card fails closed** (an undecided effect records, never runs; four tests red before); the consumer comments updated. Prod +26 / −17 | nothing routed | **+** a flag that let a caller skip the guard is gone, and a latent fail-open path closed. Builder's q6: the card now defaults an absent effect to `record` while `ReplyDelivery` still defaults to `resume` (pinned, but a new caller inherits fail-open); the live predicate is built in three places |

**Seams run 6 (LIN-4231, 4 Nov evening, `5334c81a..d7ceb373`) as a check on the rows above:** "most of what moved on the map is the guide, not the code". LIN-4201's map improvement was largely its guide edit (the cost read given a home). The real code growth was two F1 edges, +0/+1 by runtime dependency. One file without a home (`usage-snapshot-intake.js`). No knot opened or closed. That agrees with LIN-4201's `+ (mixed)` and LIN-4203's homeless-file note.

**Drift run 2 (LIN-4232, 4 Nov evening, trend vs 11-04) as a check on the copies column:**
- **All four Periodicals findings routed into LIN-4201 and LIN-4203 are resolved or improved:** `usage-relay-flag-partial` resolved (LIN-4203); `lineage-identity-read-twins` resolved (LIN-4201); `cost-fold-partition-restated` resolved (LIN-4201); `usage-record-vocabulary-two-readers` improved (LIN-4201). Against that, **all 17** earlier Drift follow-ups, pushed as Backlog tickets, are unmoved.
- **New, left by our tickets:**
  - LIN-4203's `usage-snapshot-intake` collection is missing from the account-erasure inventory (`erasure-inventory-lockstep-gap`, LOW-MEDIUM, minted LIN-4234), so a full wipe leaves its documents;
  - `usage-snapshot-prose-residue` (LOW), stale strings describing the retired snapshot;
  - `cache-module-family` worsened (LOW): LIN-4201's `workspace-kpis-cache.js` is a second keyed cache, repeating a known write pattern.
- **Census flat:** 0 `mustRule` groups moved. **Import graph:** no new cycle, 0 upward edges.
- **Effect on the rows:** LIN-4203 stays `+`, with one new gap noted (erasure). LIN-4201 stays `+ (mixed)`, with one LOW copy noted (cache).

## The blind second scorer (5 Nov, first pass)

Two fresh sessions scored the 28 single-commit rows above (baseline and forward, shuffled together with seed 20261105 and given as commits only). They read code, tests and how-to docs at each parent and commit, not tickets, PRs, `docs/plans/`, `docs/reviews/` or `docs/papers/`, and weren't told why any change was made. Batches A and B are on LIN-4150 (07:48–07:49 UTC). Ledger balances are mapped as: `+` and `+ (small)` → better, `+ (mixed)` and `−/+` → mixed, `0` → neutral, `−` and `− (small)` → worse.

| Ticket | Window | Ledger | Blind | What the blind scorer saw that the ledger didn't |
|---|---|---|---|---|
| LIN-4168 | baseline | − | **better** | one reset over six seams; it doesn't weigh the map's catch-all |
| LIN-4166 | baseline | 0 | mixed | `followUpTo` hand-checked four times; `'none'` in the edge enum |
| LIN-4173 | baseline | + | better | |
| LIN-4177 | baseline | −/+ | mixed | |
| LIN-4178 | baseline | − | mixed | credits the three lineage-cost copies it deleted |
| LIN-4179 | baseline | 0 | **better** | `llm-call-log` shrinks, one formatter with a census |
| LIN-4198 | baseline | − | mixed | a third token-field list, a copied `bulkWriteWithRetry` |
| LIN-4202 | baseline | − | mixed | a cross-repo transcript walk re-implemented rule for rule |
| LIN-4212 | forward, no Survey | 0 | **worse** | the read merges back what the write's key splits; a fourth member-row query |
| LIN-4201 | forward | + (mixed) | mixed | a second stale-while-revalidate cache; batching repeated |
| LIN-4203 | forward | + | better | |
| LIN-4218 | forward | + | better | reshaped, not shorter; opencode keeps its own sequence |
| LIN-4226 | forward | + (small) | better | |
| LIN-4220 | forward | + | mixed | `envWithout` still two copies; tests ≈ 7× the owner |
| LIN-4223 | forward | + | better | |
| LIN-4221 | forward | + | mixed | literal exit codes left in four runners |
| LIN-4222 | forward | + | better | |
| LIN-4224 | forward | + | mixed | `UNIT_ARGS` restates `package.json`; the leak trap's roots hard-coded |
| LIN-4187 | forward | + | mixed | the contract census checks only the format of its lines |
| LIN-4234 | forward | + | better | |
| LIN-4239 (+ LIN-4240) | forward | + / + | mixed (scored together) | a park's readability has an owner on each side; a third marker regex |
| LIN-4241 | forward | + (small) | **worse** | the scan-row settled check goes from 2 copies to 5; a third stamp parser; two 409 codes |
| LIN-4242 | forward | + (mixed) | mixed | the card merge copies `observation.js`'s; a second title rule |
| LIN-4243 | forward | + (mixed) | mixed | |
| LIN-4151 | forward | + | better | |
| LIN-4048 | forward | + | **neutral** | "finished but held" now decided in three places |
| LIN-4143 | forward | + | better | |

**Read with +1 better, 0 mixed or neutral, −1 worse:**

| | Ledger | Blind |
|---|--:|--:|
| Baseline (8 rows) | **−0.38** (1 better, 1 mixed, 2 neutral, 4 worse) | **+0.38** (3 better, 5 mixed) |
| Forward, surveyed (19 rows) | **+0.84** (16 better, 3 mixed) | **+0.37** (8 better, 9 mixed, 1 neutral, 1 worse) |

**Against the criteria logged at 08:20:**
- **Main question: failed.** The blind scorer rates the loop's rows no better than the baseline's (+0.37 against +0.38). By the rule written beforehand, the ledger's gap between the windows is mostly my scoring.
- **Agreement:** 23 of 28 by the logged rule, where "mixed" matches either side, but that rule is nearly empty: "mixed" is the blind scorer's answer on 14 of 28 rows. On exact classes the agreement is 13 of 28.

**Where the two hands differ, and why:**
- **I was harsher on the baseline.** I scored it against the map (homeless files) and Drift's findings, both of which the code-only scorer ignores.
- **I was kinder to the forward rows,** because I credited what the forecasts said the obvious way would have made. A scorer reading the diff sees only what is there, not what was averted. "Left better than it started" is the blind scorer's measure, not mine.
- **The blind scorer finds leftover copies at the edges of nearly every row:** "One X titles are mostly true at the centre and not at the edges." That's its strongest pattern, and the ledger's copies column missed many of them.

A second independent blind pass (batches C and D, reshuffled with seed 1105) is running, to see how much of this is one scorer's taste.

## The blind second scorer, second pass (C and D, reshuffled with seed 1105)

| | Ledger | Blind, pass 1 | Blind, pass 2 |
|---|--:|--:|--:|
| Baseline (8 rows) | −0.38 | +0.38 | **+0.50** (4 better, 4 mixed) |
| Forward, surveyed (19 rows) | +0.84 | +0.37 | **+0.37** (8 better, 9 mixed, 1 neutral, 1 worse) |

- **The result holds.** A second independent scorer also rates the loop's rows no better than the baseline's.
- **The two blind passes agree with each other on 20 of 28 rows exactly, and against me on 13.** Every disagreement between them is better ↔ mixed, never opposite signs. The ledger's balance column is the outlier.
- **Rows both passes rate better:** LIN-4168, LIN-4173, LIN-4179 (baseline), and LIN-4203, LIN-4218, LIN-4234, LIN-4151, LIN-4143 (forward). **Worse in both:** LIN-4241. **Neutral in both:** LIN-4048. LIN-4212 (unsurveyed) is worse, then "mixed, leans worse".
- **What the forward rows rated better have in common:** a deletion (LIN-4203), a priced tally row done as its own task (LIN-4218), a tidy-after as its own ticket (LIN-4234), and two features whose change *was* removing a second path or a flag (LIN-4151, LIN-4143). The ordinary features that added a capability (LIN-4241, LIN-4242, LIN-4243, LIN-4048) are mixed, neutral or worse.
- **From here, the balance column is the blind read.** My column stays as history.

## Forward rows from 5 Nov (balance = the blind read)

| Ticket | Map | Copies (blind reads E, F and mine) | Carried | Balance (blind) |
|---|---|---|---|---|
| LIN-4248 (the Survey as two hand-triggered stages; notebook to main) | not re-read yet | each template's text has one owner; the exclusion reuses the existing set; every per-kind table guarded by a test learned both kinds, and the docs counts are right. But "survey" has no single owner: `SURVEY_KINDS` (read-only) beside `EXCLUDED_FROM_AI_RECOMMENDATION` (hand-only), the read-only rule written in three places, and the literals copied in three test files. Two unguarded lists missed: `pipeline-churn.js FIRST_PASS_KINDS` and `workflow-config.js VIRTUAL_PROMPTS` (both already miss other kinds) | the scope's at-merge list; nothing routed | **mixed, mixed.** It followed the per-kind registry pattern carefully and didn't reduce it. The tidy it bound on (one flag per template, read by the router, "Another step" and the preamble) is the tally row named this morning |

**Seams run 7 (LIN-4249, `d7ceb373..2eb73ae0`) as a check on the overnight rows:** the catch-all grew 14 → 16 from `ruling-settled.js` (LIN-4241) and `waiting-section.js` (LIN-4242), and Pages ↔ Other grew 8/6 → 9/8, all from that placement. F1 grew +1 from LIN-4226. The browser seam grew by four new `window` globals and one wrapper (LIN-4243's half), which no row named. No knot opened or closed. That agrees with the map column of those rows. No follow-ups were minted.

**Drift run 3 (LIN-4250, `d7ceb373..2eb73ae0`) as a check on the overnight rows:**
- **Resolved:** `erasure-inventory-lockstep-gap` (LIN-4234, "the fix reaches the cause").
- **Improved:** `live-anchor-old-home-alive` (LIN-4143: the flag is gone, one inline copy left); `home-next-answer-split` (LIN-4151, partly); `coherence-loop-stalled` (its first movement in four editions).
- **New, from LIN-4241:** `ruling-settled-row-predicate-inline`, the settled check inline at **5 sites, up from 2**. That's the blind scorer's finding, which my `+ (small)` missed; the Periodical sides with the blind read. Also `error-code-case-split`, LOW. New LOW-MEDIUM `parked-wait-text-cross-repo`: an old dependency, ruled for the first time, which LIN-4239 and LIN-4240 improved without closing.
- LIN-4226 edited two files with stale snapshot prose and left it.
- No `mustRule` group moved by code.

| Ticket | Map | Copies (blind G, H and mine) | Carried | Balance (blind) |
|---|---|---|---|---|
| LIN-4253 (a stage's `route` and `writes` declared once on its template; **tidy first**, before LIN-4251) | (to read) | `SURVEY_KINDS` gone; `EXCLUDED_FROM_AI_RECOMMENDATION` derived from `route: null` on every template; `writes` on every template from one leaf (`lib/stage-writes.js`); the preamble no longer knows stage names; a pin test per kind, mutation-checked; router fixtures unchanged; `prompt-system.md` and `source-map.md` updated. The characterisation golden was green across every kind and path, then removed as scaffold. Prod +182 / −77 roughly | the blind reads of LIN-4248 (its own tidy) | **better, better.** Two hand-kept lists deleted, one home per trait, the preamble still registry-free. Both note: the resume path passes no `writes`; the `work` default lives in two places; the one-comment wording is still Survey-specific |
| LIN-4252 (one shared fake DOM for client unit tests; **tidy first**, before LIN-4246) | no production diff | the shared fake has a home (`tests/unit/helpers/fake-dom.js`), states what it models, throws outside that, and has its own tests; `lin-4242`'s private ~150-line fake deleted; `lin-4010` moved, which exposed a test the old stub let pass (a click on a button never drawn). But it owns 2 of about 30 consumers: 18 hand-written `makeContainer`s and about 10 private fake elements remain, CLAUDE.md's new rule has no guard, and the click/key vm layer stayed inside `lin-4010` | the tally's "shared test fakes" row (five namings) | **mixed, mixed.** "A helper that callers may adopt later is one more copy": the essay's trap, because the scope left the other copies out. Tidy-after filed as LIN-4255 |
| LIN-4247 (Go returns after a run ends; **the control**: tidy folded in, in pieces) | (not re-read) | one owner for "the run has ended" (`runEnded` → `endRun`, covering all three presses); an incomplete reply is never an end; a stale read can't end a newer run; the pinned test flipped, not duplicated; witnesses red first (vm units and two E2E); `llms.txt` updated. But "in progress" now has four answers (`runEnded` re-reads `sessions.busy` beside `stageBusy`), documented rather than folded; the `state.go` literal goes from 7 copies to 8, and `run.item = null` from 2 places to 3, in a 2.9k-line file. Prod +42 | nothing routed | **mixed, mixed.** The usual shape for a feature with its tidy folded in: the centre is one owner, the edges gain another copy |
| LIN-4251 (four stages say what they may write, at every entrance; **the follow-on on LIN-4253's tidy**) | (not re-read) | `stageWrites(kind)` one owner, used by all four entrances (launch, resume, both feedback routes), with a census on new `attachProxyContext` call sites; new values in the leaf; READING and `writes` now checked both ways; `work` pinned byte-identical. But `readOnlyContextLines` is a second hand-written copy of the endpoint-hint ladder, made to keep `work` byte-identical; four near-copies of the closing lead-in; one test went back to a literal Survey list. Prod +137 / −43, about 40 minutes | the scope's two larger extras (resume path, workspace hint), both landed | **better, mixed.** On its tidied ground it landed everything asked, quickly. The one copy came from *my* byte-identical constraint: a proof-of-no-change rule invited a copy where an optional clause would have done |
| LIN-4246 (the call-site witness; **the follow-on on LIN-4252's fake**) | (not re-read) | the missing case on the shared fake; the vm layer lifted to `prompt-section-world.js`; the dead keep deleted; CLAUDE.md updated. **Review found a real bug users hit** (the caret was lost on every 10 s poll), which only the fake's focus model could show. Its fix added a second focus capture and restore beside `paintRun`'s, and split "focus inside the card" across two files with a `hadFocus` flag. The shared world has 2 users of about 19 | the scope's larger extra (lift the vm layer) landed | **mixed, mixed.** The same partial adoption as its tidy, plus a copy from the bug fix. The tidy's payoff shows in the film (a user-facing bug found and fixed), not in the still |

### The tidy-first round (5 Nov), summary

| Track | Tidy first | Blind | Follow-on | Blind |
|---|---|---|---|---|
| B (prompt plumbing) | LIN-4253: deleted every copy it named | **better, better** | LIN-4251 | **better, mixed** |
| A (browser tests) | LIN-4252: owned 2 of about 30 fakes, no guard | mixed, mixed | LIN-4246 | mixed, mixed (found a user-facing bug) |
| C (control) | none, tidy folded in | n/a | LIN-4247 | mixed, mixed |

Against the 10:15 criteria: the tidies were better in one of two; the follow-ons were better or neutral in one of two. **Where the tidy finished its job (deleted its copies), it and its follow-on are the only rows today that either blind pass calls better. Where it stopped short, both came out like the control.** Two tracks, one pass each, so this is a hint, not a rate. LIN-4255 (A's tidy-after, with a ratchet census) is the next test: does finishing, or ratcheting, the move turn A's track around?
| LIN-4263 (`/cost` per-dispatch model and tokens inside each lineage) | (not re-read) | `dispatchesOf` in `cost-read.js` reuses `foldRequestUsage`; one helper feeds all four `workerSessions` sites; opt-in `perDispatch` so the Models page and effort readout don't change; snapshot lineages give null; both docs updated. But `postingKeysOf` repeats `isPostingRow`'s key list in the same file, and `rankOf` copies `lineage-membership.js`'s private dispatch order (and breaks on two undated members: NaN); the replay guard gained a looser regex mode | the Surveys' design (nested, not split) | **mixed, mixed.** A capability added with two small re-writes of rules that already lived nearby: "at the edges" again |
| LIN-4276 (LIN-4263's **edges tidy-after**: the first "after" step) | (not re-read) | `rankOf` gone (reuses `byDispatchOrder`, now exported); `postingKeysOf` the one `[id, _id, loopId]` list, from which `isPostingRow` and `keyOf` derive, which fixes a loopId-only row being counted twice. Residues: `source-map.md` doesn't list the new export; the `keyOf` change reaches `distinctRows`' dedup, pinned only by the `missing` case; `dispatch-lineage.js:162` keeps its own order (named in the scope as a follow-up) | the blind reads' named edges, Survey-checked (the NaN claim corrected) | **better, better.** And **LIN-4263 + LIN-4276 read together: better, better** (LIN-4263 alone was mixed, mixed). The "after" step lifted the area |
| LIN-4277 (LIN-4251's **edges tidy-after**: the second "after" step) | (not re-read) | `readOnlyContextLines` deleted: `endpointHintParts` + `renderEndpointHints` own the hints for every `writes` value, the update clause as data; the four closings share `CLOSING_LEAD_IN`; the `work` fixture untouched and green; `plumbing.md` line refs updated. Residues: the hint text is now `\n`-embedded fragments (to keep `work` byte-identical), the clause in five forms across eight branches, a third copy of the clause forms in a test (commented as a drift detector), the non-work wrap pinned only by a whitespace-normalised test, the three mandates' shared tail | the blind reads' named edges, Survey-checked (the "derive the kinds" bullet corrected) | **better, better.** And **LIN-4251 + LIN-4277 read together: better, better** (LIN-4251 alone was better, mixed) |

### The "after" step (5 Nov), summary

| Area | Parent alone (blind) | Tidy-after alone | Parent + tidy-after | Parent cost | Tidy-after cost (of which build) |
|---|---|---|---|---|---|
| `/cost` per dispatch | LIN-4263: mixed, mixed | LIN-4276: better, better | **better, better** | $14.37 | $6.77 ($1.74) |
| prompt plumbing | LIN-4251: better, mixed | LIN-4277: better, better | **better, better** | $11.94 | $5.93 ($0.77) |

Two of two lifted their area to better in both blind reads, at about +45–50% of the parent's cost each, nearly all of it the fixed legs (two Surveys, plan, review, close-out, autopilot). LIN-4276's builder on its tidy-after q7: "Barely, on cost... Inside LIN-4263 it would have been cheaper... But the separate pass found the double listing, which a quick in-PR tidy would probably have missed." **Stop rule:** a tidy-after whose blind reads say better, better gets no tidy-after of its own, though its blind reads and its builder name further edges (both did). Those go into the notebook for the next ticket in the area to pull.

### Track A turned around: partial move, ratchet, then the finishing move (5 Nov)

| Ticket | Map | Copies (blind AA, AB, AC, AD) | Carried | Balance (blind) |
|---|---|---|---|---|
| LIN-4255 (fourteen merges, LIN-4265 → LIN-4272: the census first, then the shared fake grown and the families moved) | test-only, plus one CSS rule (a real unstyled-button bug found by a move) | 31 suites off their own fakes and vm sandboxes; `observation-dom-shim.js` deleted; an AST census that only shrinks (56 → 25), with each of the 9 stops named by the API that blocks it; the fake grew tested real-DOM API rather than per-suite patches. Residues: the `fake-dom.js` header's consumer list (a second, unguarded registry, edited by 13 of 15 commits); `clickOn` added then bypassed in four suites; three ways to load `common.js`; `real-dispatch-disclosure.js`'s entity decode dead on arrival (the fake already decoded them); `CLAUDE.md:58` stale on what the fake hosts | LIN-4252's blind reads (its own tidy-after), with a ratchet | **better, better.** And **LIN-4252 + LIN-4255 together: better, better** (LIN-4252 alone was mixed, mixed) |

So track A, which read like the control at noon, now reads better. The partial move, held by a ratchet and then finished in one large move in pieces, did what John's Hanoi framing said it would. The residues are pulled into LIN-4292, the next ticket in that area, rather than filed (the stop rule).
| LIN-4293 (LIN-4247's and LIN-4246's **edges tidy-after**: the third "after" step, one ticket for two parents) | (not re-read) | about 11 Go-state literals → `goState()` (fresh objects, mutation-checked); `stageBusy`/`goInProgress`/`runEnded` → one `InProgress` owner, each view naming its input; three run-item literals → `runItemOf()`; "focus inside the card" → `QuestionCards.focusInCard`, with `hadFocus` gone; the no-slot double keep deleted; a `render()`-path witness. Its larger step 7 (keep before the write) **stopped by its rule**: `render()` detaches the card through `innerHTML`. Residues: `clearRunItem(why)` never reads `why`; two focus restores kept on purpose; comments grew faster than code (ticket history); a test copies the lin-4246 fixtures | the blind reads' named edges, checked by hand, then Surveyed (11 literals, not 8; fresh objects; the captures' different jobs) | **better, better.** And **LIN-4247 + LIN-4246 + LIN-4293 together: better, better** (each parent alone was mixed, mixed) |

### The "after" step, three of three (5 Nov)

| Area | Parent(s) alone | Tidy-after alone | Together |
|---|---|---|---|
| `/cost` per dispatch | LIN-4263: mixed, mixed | LIN-4276: better, better | **better, better** |
| prompt plumbing | LIN-4251: better, mixed | LIN-4277: better, better | **better, better** |
| `prompt-section.js` Go/run/focus | LIN-4247: mixed, mixed; LIN-4246: mixed, mixed | LIN-4293: better, better | **better, better** |

Plus track A's finishing move (LIN-4252 + LIN-4255: better, better). By 19:15, every area today whose edges were tidied after, or whose partial move was finished, reads better in both blind passes. That's four areas and eight passes, with no exceptions.

**A pattern across the blind reads: comments carrying ticket history.** Named in at least six reads today (LIN-4247 K, LIN-4246 O, LIN-4251+4277 Y, LIN-4293 AE, AF, AG, AH). The tidy-afters shrink code and grow comments: LIN-4293 is +34 net, with 52 changed lines of comment, "mostly ticket history". This is a house habit, not one ticket's fault, so it's one for John (see the log).
