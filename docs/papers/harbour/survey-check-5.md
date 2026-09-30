---
title: Do the wake-inventory and browser-flakes papers hold up?
kind: paper
version: 1
date: 2026-09-30
authors: [Claude (LIN-3173)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 803de3ea, kind custom, LIN-3173); effort not recorded in the dispatch item. One bounded session, with no research, plan, review or close-out legs, by the brief's design. Six in-session subagents of the same tier: two re-ran each paper's scripts and recounted its figures, one walked both repos and read the 25 failure tickets, one read the flaky specs' source, and two blind-coded fresh samples without the labels. This session drew the samples, held the keys, compared the codes, re-read the load-bearing lines and wrote the check. It is not the author of either paper, which came from dispatches 48bb3a17 and 8278406b."
grounded_at: 04dc586d (LinearViewer, origin/main when the check was written, for the anchor's line numbers); 304da17c (origin/main when it began); the papers measured at e308b871 and fe541ee9; simple-dispatcher 3366748
cites:
  - "docs/papers/harbour/wake-inventory.md@304da17c (version 1, LIN-3172) and wake-inventory-failures.json; its scripts survey-doubling-runner.mjs, survey-wake-extract.mjs, -analyse.mjs, -figures.mjs, each re-run"
  - "docs/papers/harbour/browser-flakes.md@304da17c (version 1, LIN-3168); its scripts survey-tests-ci-runs.mjs, survey-tests-ci-classify.mjs, survey-flakes-analyse.mjs, -spec-source.mjs, -sessions.mjs, -figures.mjs, each re-run; -ci-fetch.mjs and -green-sample.mjs spot-checked live"
  - "scripts/survey-wake-extract.mjs@304da17c (the WRITE pattern), lib/runner-kit/runner.mjs@e308b871:154-163 and :340-361 (LIN-3098, 816bf9b7, 2026-09-29), simple-dispatcher reapers.js@3366748:444-485, :622, :1221, :2326-2327, :2369-2381, hook.js@3366748:1069-1072, :1185-1191, followup.js@3366748:48-60, dispatcher.js@3366748:571-577, :1884-1893, opencode-runner.js@3366748:642-675, :733"
  - "tests/e2e/observation.spec.js@fe541ee9:401-424, prompts.spec.js@fe541ee9:669-693, dispatch-presets.spec.js@fe541ee9:231-238, session-page.spec.js@fe541ee9:350-362, opened-task-first-screen.spec.js@fe541ee9:120-124, proxy-local.spec.js@fe541ee9:37, public/settings.js@fe541ee9:152, public/app.js@fe541ee9:1790-1797, playwright.config.js@fe541ee9:7-16"
  - "LinearViewer a00ee5ed (LIN-1910, 2026-08-13), 0e8a1461 (LIN-1727, 2026-08-23), 5af7c3cc (LIN-799), c37d07c0 (LIN-629, 2026-06-24), d4a05f2e (LIN-2797) and PR #1451; PRs #1209, #1211, #1212"
  - "docs/papers/harbour/what-doubled-the-dispatches.md@304da17c (version 2) and survey-check-4.md@304da17c (the charging rule, and the house check form)"
  - "docs/steady-base.md@04dc586d (points 16 and 17, the implications, map rows 1, 2 and 5, open questions and evidence table)"
  - "The 25 failure tickets and LIN-3173's description and brief, read over the workspace proxy 2026-09-30"
  - "scripts/survey-check-5-wake.mjs and survey-check-5-flakes.mjs (this check)"
---

# Do the wake-inventory and browser-flakes papers hold up?

Their descriptions of the traffic hold. Their explanations do not, in two places each. Every
committed script re-runs, and every printed number reproduces from the authors' snapshots.

**Wake inventory.** The counts reproduce exactly, and a fresh blind reading of 80 wakes agrees
with the script's changed-nothing-or-acted call on 74 of them (κ 0.84). All six disagreements
come from one pattern: the extract counted `--json` anywhere as a write, so a read such as
`gh pr view --json` made a wake "act". Corrected, terminal wakes are acted on 89% of the time,
not 94%. Pause wakes change nothing 83% of the time, not 80%. Wakes that changed nothing are
6.9 per correct change, not 5.8, and 12% of tokens, not 11%. The blind reading then agrees on
79 of 80. "Every wake is minted at one point" holds for the function, but aborts, halts and
the runners' watchdogs also post the lines that mint wakes. The inventory also missed a second
runner, LinearViewer's own runner kit (29 September), and simple-dispatcher's re-delivery of
lost follow-ups. The relays are 1,614 (35%), not 1,749: the larger count took every pause wake
from a supervisor child. The 18.9 wakes per correct change charges each wake to the child's
ticket. Charged to the session it entered, the rule `survey-check-4.md` set, it is 14.9. The
18 in `what-doubled-the-dispatches.md` v2 is a different measure, and matches 18.9 only by
coincidence. Of the lost wakes, 11 of 15 were lost in the runner's delivery, not 9 of 14.

**Browser flakes.** The census holds: 138 E2E-red attempts, at least 64 flakes, none before two
workers, seven specs. A fresh blind recode of 32 other attempts agrees on 29 and never swaps a
flake with a real fault. The causes do not hold. Read from the flaky tests' source, 15 of the
39 known-spec flakes are waits or route holds that do not hold. 11 are state left in a
worker's own partition by earlier specs, and 10 are a read racing a re-render. State shared
*between* the two workers explains only June's burst. The livebar's empty `animationName` is
what a detached element reports, not a rule that had not yet applied. The `prompts` spec has
held a stream URL that stopped matching in August. "About 7½ runner-hours" is elapsed time; the
re-runs used about 3 runner-hours. And flakes did reach main after a flaky PR run, three times
on 23 August.

Each paper has a version 2 in this PR, with this check's author added. Seventeen lines of
`docs/steady-base.md` change; they are listed below. This check does not edit the anchor.

## Findings

### Wake inventory

**Every script re-runs, and the analysis reproduces byte for byte.** Over the author's snapshots,
`survey-wake-analyse.mjs` writes an `analysis.json` identical to the author's, and the figures
script redraws both SVGs unchanged. A fresh extract and runner log, taken about an hour later,
add four sessions from 30 September and move nothing in 1–28 September.

**One classification error moves every outcome column.** The extract's write pattern is
`\s(-d|--data…|--json)\s|…` over a whole Bash command. `gh pr view --json`, `gh pr checks
--json` and `gh run view` are reads, and a `curl` GET chained with one of them is too. Counting
data flags as writes only inside a `curl` call changes 383 of 11,226 deliveries: 375 fall from
act to read, and 8 rise. The blind reading was drawn and coded before this was known, and its
six disagreements were all such reads.

| Figure | Version 1 | Checked | Verdict |
|---|---|---|---|
| Terminal wakes that led to an action | 94% | 89% | corrected |
| Pause wakes that changed nothing | 80% | 83% | corrected |
| All Harbour wakes that changed nothing | 44% (not printed) | 48% | — |
| Relays | 1,749 (38% of wakes, 75% of pause wakes), 94% quiet, 10% of tokens | 1,614 (35%, 69%), 97% quiet, 9% of tokens | corrected |
| Wakes per correct code change, by the child's ticket | 18.9 (LV 18.7, SD 21.6) | 18.9 (18.7, 21.6) | holds |
| …of which changed nothing | 5.8 | 6.9 | corrected |
| Wakes per correct code change, by the session entered | — | 14.9 (15.3, 19.9), 3.4 changed nothing | added |
| Share of tokens: wakes / quiet wakes | 29% / 11% | 29% / 12% | corrected |
| The gate's share of a quiet wake; its typical cost | 34%; 146k units | 32%; 149k | corrected |
| Quiet share: beats, own wake-ups, notes, stall failsafe | 18%, 58%, 21%, 81% | 20%, 62%, 26%, 89% | corrected |
| Quiet share by edge, worker → stepper / → ticket autopilot | 3% / 4% | 6% / 12% | corrected |
| Quiet share by edge, stepper → ticket autopilot / → leg / → stepper | 88% / 93% / 79% | 92% / 95% / 87% | corrected |
| Changed nothing per worker event: no stepper / stepper / passage | 4% / 34% / 62% | 12% / 39% / 63% | corrected |
| Passage events that reached a third or fourth layer | 340 of 498 | 317 reached the Runner; 340 made chains three wakes deep | corrected |
| 4,602 wakes (2,264 terminal, 2,338 pause); 17,778 deliveries; 2,009 sessions | | reproduce | holds |
| Wakes per event 1.00 / 1.59 / 2.97, 0.78 at the Runner | | reproduce | holds |
| Gate: 7,429 asks, 62% PENDING-EXTERNAL, Runner 619 of 623, 9% of tokens | | reproduce | holds |
| 211 repeats (195 to a Runner); 27 re-fire wakes; 97 pause-then-done | | reproduce | holds |
| Runner log: 5,098 warm, 684 cold, 711 rejected; 5,605 of 5,782 seen | | reproduce | holds |
| Cohort 185 / 127 / 108 LV / 22 SD; linking 1,586 / 2,415 / 264 / 337 | | reproduce | holds |

**A relay was counted by its child, not its cause.** The paper defines a relay as a supervisor's
own re-arm posted after it handled a wake. Its 1,749 counts every pause wake whose child is a
supervisor. In 135 of those, the child had not just handled a wake: 93 came at the child's own
launch, 33 after a relayed note, 8 after a task notification, 1 after a re-fire. On the paper's
own edge-column definition there are 1,614. Requiring the child's gate to have answered
PENDING-EXTERNAL too gives 1,576. Either way 97% are quiet. One relay pair was read end to end
in the transcripts (6 September) and matches the mechanism the paper describes.

**The inventory's minting claim holds; its delivery and "not a wake" claims do not.**
- *One function.* Every `kind: 'wake'` row is written in `addFeedback`. Pause wakes skip
  `_mintWake` and are enqueued by `addItem` directly, as the paper's H3 cite shows.
- *Who posts the lines that mint.* The paper says the fast-fail watchdog, abort and halt "only
  report". They post on the child's row: `[failed] Session fast-failed…` (`reapers.js:622`),
  `[aborted]` from an abort and from halt's stop sweep (`dispatcher.js:571-577`, `:1884-1893`),
  and `[failed] Session … wedged` from stall force-fails (`reapers.js:444-485`). Each mints a
  terminal wake. Abort was already the paper's own H4.
- *A second runner.* LinearViewer's runner kit (LIN-3098, `816bf9b7`, 29 September) delivers
  every follow-up, wakes included, by continuing a subagent (`runner.mjs:154-163`), with no hold,
  gate or handshake. Its watchdog and restart recovery post `[blocked]`/`[failed]` lines that
  mint wakes (`:340-361`). It landed after the traffic window, so no figure moves.
- *Re-delivery.* "The rescue sweep … is not built" is true only of Harbour's LIN-1717.
  simple-dispatcher re-injects a follow-up whose hold died (`expired-hold-followup`, LIN-2468,
  `reapers.js:2369-2377`) or whose resume stalled first (`stalled-bootstrap`, LIN-2259,
  `reapers.js:2326-2327`, `hook.js:1185-1191`), and does the same for opencode.
- *A forced follow-up.* `force: true`, which stepper beats carry, turns a busy rejection into a
  kill-first cold resume (`followup.js:48-60`). S3's "otherwise rejected" misses it.
- *Texts and cites.* S1's nudge is sent only to a broker-armed session; others get the full
  prompt (`hook.js:1069-1072`). S6 sends Claude sessions the re-ask with a withdraw option
  (`reapers.js:2381`), and two of its arms re-inject the task instead. Two of the seven selectors
  fail a session rather than re-fire it. The S9 cite (`opencode-runner.js:642-675`) is
  opencode's completion gate, not its hold (`:733`). The Method says four tickets were re-read;
  it was five.
- *What holds.* No CI or PR webhook or poller exists in either repo. Nothing in code fires a
  periodical yet. Every other cited line lands.

**The Runner's edge is small for a reason the paper does not give.** It says few of the Runner's
legs fly code changes. In fact 409 of the 455 leg→Runner wakes came from four legs whose
sessions carry no ticket of their own, each of which dispatched 12–34 tickets. The charging
rule then falls back to the passage epic, which is excluded. 567 wakes (12%) land on the two
excluded epics, 409 of them linked. The Limits line says the fallback bites only when "the
child is not linked".

**Smaller slips, each corrected in version 2.**
- "Stepper under a ticket autopilot": 462 of its 1,057 steppers have no linked parent. Version 2
  calls the row "outside a passage".
- The 72 "self-armed polls" are every task notification into a supervisor, about 55 of them
  CI or PR waits. None is shown to race a child's push; LIN-1323 remains the one case.
- In-session subagents' tokens are not in the shares, though the extract's header says they are.
  Adding them (2.6% of units) moves 29% to about 28%.
- `what-wakes-lead-to.svg` summed rounded per-source shares, so its beats and stall bars read
  16% and 2% against the table's 15% and 1%. The script now takes the table's share; both
  figures are redrawn from the corrected analysis.
- The edge table silently dropped leg→worker (7) and worker→Runner (4). Version 2 lists them.

**The failures: the list is right, two placements move, and delivery's share grows.** All 25
tickets were re-read over the proxy. The list is exactly `what-supervisors-do-failures.json`'s
26 less six, plus five, as the paper says. Placed again from the tickets, 20 agree fully.
- **LIN-1816** moves from H1 to S6. Its own research calls "the child-completion wake never
  arrived" wrong in mechanism: a sticky `refiredAt` force-FAILed the waiting orchestrator
  (LIN-1731), and another consumer claimed the wake item (LIN-1792).
- **LIN-1323** is a lost wake, not a duplicate. The hook let the supervisor's own poll override
  `PENDING-EXTERNAL`, and the wake sat queued behind the busy session (S4 with S8).
- Three are soft. LIN-870's zombie followed either a wake or its own monitor. LIN-1698's loss
  spans minting and resume, and its fix was on LinearViewer's side. LIN-2145 is still in Backlog
  with its mechanism unconfirmed.

| Figure | Version 1 | Checked |
|---|--:|--:|
| On a wake path | 18 | 18 |
| Lost / duplicated / misdelivered | 14 / 3 / 1 | 15 / 2 / 1 |
| Lost on the runner's side | 9 of 14 | 11 of 15 (10 if LIN-1698 is Harbour's) |
| Lost where Harbour mints | 5 | 4 |
| Where two paths touch | 9 of 18 | 11 of 18 (12 with LIN-1698) |

`wake-inventory-failures.json` is corrected for the two moves. The count of 15 lost wakes now
matches `survey-check-2.md`'s "15 missed or lost wakes", which the anchor already cites.

**Reconciling 18.9 with the doubling paper's 18.** They are different measures, and near each
other by chance.

| Count | Cohort | A wake is charged to | Wakes per correct change |
|---|---|---|---|
| Wake inventory | Code changes merged 1–28 September, first dispatched on or after 30 August (127 correct) | the child's ticket | 18.9 |
| Same | same | the session it entered | 14.9 |
| Same, merged 1–13 / 14–28 September | 69 / 58 correct | the session entered / the child | 15.1 / 14.7 against 17.1 / 21.1 |
| `what-doubled-the-dispatches.md` v2 | Code changes merged 1–13 / 14–28 September, no 30 August filter (74 / 66 correct) | the session entered, from the runner's log | 16.1 / 18.0 |

On one cohort, switching from the child to the session entered cuts 18.9 to 14.9. Almost all
of that is on the supervisor edges: stepper→ticket autopilot 3.0 to 1.7, stepper→leg 1.2 to
0.1, stepper→stepper 1.3 to 0.2 and the Runner 0.1 to none, while the worker edges barely move
(7.8 to 7.7, 4.2 to 4.1). The doubling paper's "wakes" are every runner follow-up into an
autopilot session: relayed notes included, wakes into worker sessions left out. It also keeps
the long-lived tickets the 30 August filter drops. The wake paper used the child rule, the one
`survey-check-4.md` found inflates late September, and on its late fortnight that rule gives
21.1. It cited version 1 of the doubling paper, and its Limits line still carried that framing.
Version 2 gives both figures and says which rule each uses.

### Browser flakes

**Every script re-runs, and every output reproduces.** The analysis matches except for its
timestamp. So does the classification over the author's fetch, with all 192 rows identical.
The spec census is byte-identical at `fe541ee9`, and both figures redraw unchanged. The session
scan finds the same episodes; its session totals have drifted with the transcripts (2,016 to
2,029 sessions, 1,231 to 1,244 that looked at CI), and the 37 and 15 are unchanged. A fresh run
list holds all 3,238 runs plus three green June runs, which moves no rate. Eleven fetched attempts
(six from June) and two green runs' eight shard logs were read live, and all match.

**The census holds, and a fresh blind recode confirms it.** 138 attempts: 64 flakes, 42 real
faults, 3 count pins, 4 environment, and 25 unplaced (14 unverified, 9 unresolved and 2 "main
moved", a class the paper never names). Flakes by period are 0, 25, 7, 25 and 7. 1–23 June had
six E2E-red attempts. The one whose commit later passed failed at "Initialize containers"
within 16 seconds, before any test ran, so "no flakes before two workers" holds. A fresh sample
of 32 from the 57 attempts with evidence that version 1's blind coder had not seen was coded blind
from runs, diffs and source:

| This check's blind coder → | flake | real fault | count pin | environment |
|---|--:|--:|--:|--:|
| Census flake (14) | 14 | | | |
| Census real fault (13) | | 13 | | |
| Census count pin (1) / environment (1) | | | 1 | 1 |
| Census unresolved (2) / main moved (1) | 1 | 2 | | |

29 of 32 agree, and none of the disagreements is a flake against a real fault. The main-moved
row it called a flake is the "other" in `observation`'s row: the livebar test, with the livebar's
error, on 4 September. The flake count is a floor by at least one.

**The causes, read from the source, are not the paper's three.**

| Spec (flakes) | Version 1 | The flaky test's source and errors |
|---|---|---|
| `observation` (10) | a computed style read before the rule applies | Every failure read `animationName` `""`. In Chromium a rule not yet applied reports the animation's name (`shimmer`), and a detached element reports `""`. So the feed poll re-rendering the node between the locator and the read (`:408-420`) fits; a late rule does not |
| `observation-rulings` (8) | shared state between workers | 6: state left in the worker's own partition, as 0e8a1461 says. 2 (25 and 27 August, the non-page ruling test) came after that fix, on commits that contain it: undetermined |
| `dispatch-presets` (8) | a wait that does not wait | Holds. The app's save reloads the page itself (`public/settings.js:152`), racing the test's own reload. 7 of 8, not 8, died on `ERR_ABORTED`; the 18 July one failed `toHaveValue` first |
| `next-run` (5) | shared state between workers | Leftover rows in the same worker's queue (0e8a1461) |
| `session-page` (4) | none given | A single read of the sessions feed straight after seeding (`:357-360`): a wait |
| `prompts` (3) | network and streaming | The test holds `**/api/recommend/<id>/stream` (`:669`). Since LIN-1910 (13 August) the client adds `?source=…` (`public/app.js:1795`), which that glob does not match. The hold never engages, and the test passes only if `toBeHidden` runs before the real stream ends. The first flake was ten days later. Another spec already notes the suffix (`opened-task-first-screen.spec.js:120-121`) |
| `ship` (1) | an ordering gap in `ship-biscuit` | That ordering gap is a real-fault row in another spec. The `ship` flake is the test LIN-801 fixed in June: undetermined |

That gives waits and holds that do not hold 15, leftover per-worker state 11, re-render race
10, undetermined 3. Version 1's "between the two parallel workers" is June's cause: three of its
four fixes were cross-worker seed collisions. The fourth, LIN-799's feed cache, reproduced with
one worker. LIN-1727's commit describes specs leaking into one worker's partition, and both
August specs already used the per-worker key.

**The shared-key census counted comments.** "Sixteen specs still name the fixed key or call
`createSession` with no `urlKey`": no spec calls `createSession` at `fe541ee9`, and most of the
sixteen matches are comments or sit beside a per-worker key. In running code only `proxy-local`
uses a fixed key (`:37`), a case the config documents as safe. "30 of the 92 use
`workerUrlKey`" misses `localWorkerUrlKey`, `secondWorkerUrlKey`, `seedLocal` and
`workerSuffix`: counted with them, 75 of 92. The flaky tests in `observation` and `next-run`,
which the paper left unchecked, both use the per-worker key. CLAUDE.md:54 does still say that
`workers > 1` "is **not** enabled yet". Fixed sleeps are in 10 specs, not 12: the pattern also
counted `setTimeout` promises as `waitForTimeout`.

**Costs: the counts hold; one name and one sum are wrong.**
- "About 7½ runner-hours" is 252 + 192 minutes of red attempts and re-runs end to end: elapsed
  time. In runner time, the re-run jobs took 184 job-minutes, about 3 hours, and every job in
  the red attempts and re-runs took about 14.8 hours.
- "679 job-minutes" counts 48 minutes twice. A re-run of failed jobs copies the others into the
  new attempt with their old timings; counted once it is about 631.
- 105 red PR attempts, 44 flakes in 38 runs, 41 real, 3 pins, 42%, 38 of 1,944 PR runs (2.0%),
  54 of 82 re-runs, 10 cleared otherwise, the 3½-minute median: all hold. The 1.1-minute median
  re-run delay is 1.03 by the usual median.
- The green sample holds: 288 runs, every 8th of 2,302; 229 with a retry (79.5%); 289 flaky
  tests; the livebar 204 of them, in 70.8% of runs; about 90% in July (92.9%) and 44% late
  September; 11%, 46% and 22% by month. Its ±5 points is right for the whole sample; the monthly
  shares are ±6 to ±10.

**Masking: two claims are wrong.**
- "Of the 14 main reds with a known spec, none followed a red on that spec in the merged PR's
  own runs." The join matched on a PR number that 103 of 105 PR rows do not record. Looked up by
  branch, three main reds on 23 August followed a red on the same spec in their PR: #1209 and
  #1212 on `next-run`, #1211 on `observation-rulings`. All three PR reds were flakes re-run to
  green before merging. A fourth main red (20 July) has no PR to check.
- PR #1451's bulk-agree tests were called "pre-existing", not "pre-existing flaky". Its own A/B
  found them passing 10 of 10 before the change and failing about half the time with it:
  removing a 5-second cache grace window exposed the race LIN-2797 fixed. It is a flake the PR
  caused, correctly counted as a real fault, rather than a known flake that hid one.
- Smaller: version 1's blind coder read two, not three, of the seven masking attempts as
  flaky specs fixed in the PR. The eleven own-surface flakes are 8 runs. June's 25 are 24
  re-runs of the same commit and one empty re-trigger. `observation-rulings` flaked twice after
  LIN-1727. The table's `observation-rulings` has two flaky tests, so "one test in each" is six
  of seven. The eight hand-read session judgements could not be checked; the data holds their
  verdicts, not the reading.

### The lines of `docs/steady-base.md` that change

The lines are at `04dc586d`. This check did not edit the anchor.

| Line | Now | Should read |
|---|---|---|
| 3 | "…`survey-check-4.md` then checked `model-choice.md`, `what-doubled-the-dispatches.md` and `proportional-process-backtest.md`; each is now at version 2." | Add: `survey-check-5.md` checked `wake-inventory.md` and `browser-flakes.md`; each is now at version 2 |
| 86 | "*(`browser-flakes.md`, unchecked)*" | *(`browser-flakes.md` v2)* |
| 89 | "The causes are server-side state shared between workers (the `urlKey` isolation LIN-625 owns), waits that do not wait for what they check, and a computed style read too early." | The causes, read from the flaky tests' source, are waits and route holds that do not hold (15 of the 39 known-spec flakes), state left in a worker's own partition by earlier specs (11), and a read racing a re-render of the element (10). State shared between the two workers (LIN-625) explains June's burst only |
| 90 | "…54 re-runs and about 7½ runner-hours." | …54 re-runs, about 7½ hours end to end and about 3 runner-hours of re-runs |
| 91 | "*(`wake-inventory.md`, unchecked)*" | *(`wake-inventory.md` v2)*. The heading stands: relays are 35% |
| 92 | "Harbour creates every wake at one point (`addFeedback` …). simple-dispatcher delivers it warm into a held Stop hook or by a cold resume, and adds its own completion gate and stall re-fires." | Harbour creates every wake in `addFeedback`, but aborts, halts and the runners' watchdogs also post the lines that mint them. simple-dispatcher delivers a wake warm into a held Stop hook or by a cold resume, re-delivers some it lost, and adds its own completion gate and stall re-fires; since 29 September LinearViewer's runner kit also delivers wakes, into a continued subagent |
| 93 | "terminal wakes led to an action 94% of the time; pause wakes changed nothing 80% … **1,749 wakes (38%) … 94% of those were quiet.**" | 89% … 83% … **1,614 wakes (35%) were a supervisor's own re-arm relayed to its parent, and 97% of those were quiet** |
| 94 | "…1.6 wakes up the chain under a ticket autopilot and 3.0 inside a passage: 18.9 Harbour wakes per correct code change, 5.8 of them changing nothing. Wakes took 29% of tokens, quiet wakes 11%." | …1.6 outside a passage and 3.0 inside one. Per correct code change, 18.9 wakes charged to the child's ticket (6.9 changing nothing), 14.9 charged to the session each entered (3.4). Wakes took 29% of tokens, quiet wakes 12% |
| 95 | "…9 of the 14 lost wakes were lost in the runner's delivery…" | …11 of the 15 lost wakes… |
| 100 | "…38% of them are a supervisor relaying its own 'still waiting' upward, almost all quiet." | …35% of them… |
| 138 | Row 1: "38% of wakes are relayed PENDING-EXTERNAL re-arms, 94% quiet; quiet wakes 11% of tokens (`wake-inventory`)" and "9 of 14 lost wakes were lost in the runner's delivery (`wake-inventory`)" | 35% … 97% quiet; quiet wakes 12% of tokens (`wake-inventory` v2); and 11 of 15 lost wakes (`wake-inventory` v2). The "15 of 25" beside it now agrees |
| 139 | Row 2: "one worker event sends 3.0 wakes up inside a passage against 1.6 under a ticket autopilot (`wake-inventory`)" | …against 1.6 outside one (`wake-inventory` v2) |
| 142 | Row 5: "seven specs, three causes, none before two workers (`browser-flakes`)" | seven specs; waits and route holds, leftover per-worker state and a re-render race; none before two workers (`browser-flakes` v2) |
| 164 | "The answer moves September's figures by about a third (`survey-check-4.md`)…" | Add: on the wake inventory's cohort, 18.9 wakes per correct change by the child against 14.9 by the session entered (`survey-check-5.md`) |
| 167 | "**Two papers are not yet checked by a second document:** `browser-flakes` and `wake-inventory`…" | Every paper cited here has been checked by a second document; `survey-check-5.md` checked the last two |
| 191–192 | "(unchecked)" on two rows | (v2) on each, and a row for `survey-check-5` |

Unchanged and confirmed:
- Lines 87–88: no flakes before two workers; at least 64 of 138; seven specs, three carrying
  two-thirds.
- Line 90's "80% of sampled green runs passed a test only on an in-job retry".
- Line 94's 1.6, 3.0 and 29%.
- Line 95's 18 of the 25 failures on a wake path.
- Line 29's "31% of wakes change nothing" is `what-supervisors-do.md`'s figure, over supervisor
  cycles classed by hand. The inventory's tool-call reading gives 48% of September's Harbour
  wakes; the two are different populations and should not replace each other.
- Line 44: flaky browser specs are the biggest cause of red CI.

## Method

Each paper's committed scripts were re-run unchanged in this branch at `origin/main`, over copies of
its author's snapshots from the session workspaces that made them. Snapshots that could be
rebuilt without the proxy were rebuilt fresh and compared. For the flakes paper, GitHub's API
re-fetched the run list, 11 attempts and 8 green shard logs, not the whole fetch.

```sh
# wake-inventory (author's data/survey-wake and data/survey/scorecard.json copied in)
node scripts/survey-wake-analyse.mjs --out data/check5-wake-author/analysis.json    # diff against the author's
node scripts/survey-doubling-runner.mjs --out data/check5-wake-fresh/runner.json
node scripts/survey-wake-extract.mjs --out data/check5-wake-fresh                    # then analyse with paths changed
node scripts/survey-wake-figures.mjs --in data/author/survey-wake/analysis.json --out <scratch>
node scripts/survey-check-5-wake.mjs                        # independent recount, relays, charging, propagation
node scripts/survey-check-5-wake.mjs --reclass --write data/check5-wake-v2         # corrected outcomes
sed "s#'data/survey-wake/#'data/check5-wake-v2/#g" scripts/survey-wake-analyse.mjs > <scratch>/analyse-v2.mjs
node <scratch>/analyse-v2.mjs
node scripts/survey-wake-figures.mjs --in data/check5-wake-v2/analysis.json
node scripts/survey-check-5-wake.mjs --dir data/check5-wake-v2                      # version 2's figures
# browser-flakes (author's data/survey-flakes copied in)
node scripts/survey-flakes-analyse.mjs --dir <copy>
node scripts/survey-tests-ci-classify.mjs <copy>/ci-runs.json --detail <copy>/detail --out <scratch>
node scripts/survey-flakes-spec-source.mjs --at fe541ee9 --out <scratch>            # and at 304da17c, 04dc586d
node scripts/survey-flakes-sessions.mjs --ci … --detail … --out <scratch>
node scripts/survey-flakes-figures.mjs --dir <copy> --out <scratch>
node scripts/survey-tests-ci-runs.mjs <scratch> --since 2026-06-01 --until 2026-09-30
node scripts/survey-check-5-flakes.mjs --analysis <scratch>/analysis.json --fresh <scratch>/fresh-ci-runs.json --gh
```

- **Blind samples.** This session drew both and kept the keys. Wakes: 80 of the 4,602 at random
  (seed 3173), given to a coder as a transcript path and a time window only; the codebook was
  none, arm, read, act and dispatch as the paper defines them, plus a separate judgement of
  whether the wake carried news the session used. Red attempts: 32 of the 57 with a log or an
  environment class that version 1's blind sample had not drawn (seed 3173), with errors, diffs
  and the same-commit facts, and no class. Neither coder opened the paper, its data or its
  scripts.
- **Code.** Both repos were walked for every path that injects a turn into a held or parked
  session or posts a wake marker. Every H and S citation was checked at `e308b871` and `3366748`.
- **Failures.** All 25 tickets were read over the proxy, with their fixing commits where they
  exist, and placed from that reading; the reader had seen the paper's placements, so the two
  are not blind to each other.
- **Spec source.** The flaky test in each of the seven specs was read at `fe541ee9`, with its
  errors from the census and the fixing commits. Two behaviours were checked directly in a
  scratch Playwright file: Chromium's `animationName` for an applied, unapplied and detached
  element, and whether the `prompts` glob matches a URL with a query.
- **Masking.** Each merged PR's branch was looked up on GitHub, and its runs matched to the main
  reds by spec.
- **Proxy.** Reads of the brief, the ticket and the 25 failure tickets, paced under the shared
  limit. No proxy call re-fetched survey data. The only writes are this ticket's comment and
  status.

## Limits

- **Every reader shares a tier with the authors.** The re-runs, readings and blind codes are
  independent of the authors' sessions, not of their model tier.
- **The corrected write rule is still a pattern.** It reads tool inputs, so a failed POST or a
  rejected push still counts as acted, and a write made inside a script counts as a read. The
  blind sample agrees with it on 79 of 80 wakes. The one difference, a dispatch that returned
  409 as a duplicate, is such a case. *Bias:* small, toward "acted".
- **The blind samples are small.** 80 wakes put the agreement at about ±5 points. 32 attempts
  cannot rule out a disagreement rate of a few percent between flake and real fault.
- **The causes are read, not reproduced.** No spec was re-run in CI. The livebar reading rests on
  Chromium's behaviour outside CI, and the `prompts` reading on the glob matcher in the
  installed Playwright.
- **Failure placement is judgement.** Two readers agree fully on 20 of 25. The three soft
  placements move the runner's share between 10 and 11 of 15, not its direction.
- **The runner kit postdates the window.** Its wakes are in the inventory but in no traffic figure.
- **The anchor may move.** The table lists lines at `04dc586d`. A later edit shifts them.

## Next

- **How many browser specs hold a route whose URL has since changed?** `prompts` has held a
  stream URL that has not matched since 13 August, and passes only when the real stream is slow.
  List every `page.route` glob in `tests/e2e/` and match it against the URLs the client builds at
  origin/main; report the holds that never engage and whether each spec has flaked. This goes
  into `proposals.md`.
- **Is the livebar test's first failure the feed replacing the node?** Its failures read a
  detached element. Run it alone, repeated, with and without the feed poll, and report which
  makes the first attempt fail.
- **What does a supervisor do with a terminal wake it does not write on?** The blind reading found
  news used in 46 of 48 sampled terminal wakes, and a write in 40. Sample the quiet terminal wakes
  and say how many decided something without writing: a stop, an escalation, a judgement.
- Each paper's own Next stands, with its figures as corrected in version 2.
