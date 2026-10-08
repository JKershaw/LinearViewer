---
title: Do the supervisor, test-estate and throughput papers hold up?
kind: check
version: 1
date: 2026-09-30
authors: [Claude]
model: "Frontier tier, claude-code. One bounded session (dispatch 78c6707f, kind custom, LIN-3154), no plan, review or close-out legs, by the brief's design. Five in-session sub-agents of the same tier: one re-ran each paper, and two blind coders recoded a fresh sample of supervisor steps. This session drew the sample, scored the codings, read the sub-agents' reports, re-read the code lines and script lines their main corrections rest on, and wrote the version 2 corrections. Not the author of any of the three papers: they came from dispatches ae378bda, c343596a and 2d2249f5."
grounded_at: c65b7dd8 (LinearViewer, where the papers measured; the Harbour scripts and code were read there), fd6b1352 (origin/main when checked); 3b1e734 (simple-dispatcher)
cites:
  - "docs/papers/harbour/what-supervisors-do.md@fd6b1352 (version 1, LIN-3150), what-supervisors-do-codes.json, what-supervisors-do-failures.json"
  - "docs/papers/harbour/test-estate.md@fd6b1352 (version 1, LIN-3151), test-estate-validation.json"
  - "docs/papers/harbour/measuring-throughput.md@fd6b1352 (version 1, LIN-3152)"
  - "scripts/survey-supervise-*.mjs, scripts/survey-tests-*.mjs, scripts/survey-scorecard.mjs @c65b7dd8, each re-run"
  - "scripts/survey-supervise-classify.mjs@c65b7dd8:27, survey-supervise-analyse.mjs@c65b7dd8:61 (the wake detector)"
  - "scripts/survey-scorecard.mjs@c65b7dd8:101-127 (fleet hours), :273-274 (the June weeks); survey-reliability-git.mjs@c65b7dd8:86-98 (named fixes)"
  - "routes/proxy.js@c65b7dd8:337, :374-384 (withTimeout); lib/http-keepalive.js@c65b7dd8:21"
  - "simple-dispatcher hook.js, reapers.js, config.js, phases.js @3b1e734; lib/dispatch-wake.js, lib/dispatch-factory.js, lib/prompts/autopilot-kickoff.js, docs/passage-runner-prompt.md, routes/proxy-writes.js @c65b7dd8, at the lines given below"
  - "docs/papers/harbour/survey-check.md@fd6b1352, survey-check-readings.json (the house check form; finder rows)"
  - "docs/steady-base.md@fd6b1352"
  - "docs/papers/harbour/survey-check-2-codes.json (this check's recode)"
  - "LIN-353, LIN-366, LIN-384, LIN-430, LIN-870, LIN-881, LIN-1280, LIN-1323, LIN-1451, LIN-1591, LIN-1656, LIN-1884, LIN-2145, LIN-2229, LIN-2468, LIN-2754, LIN-2899 and 34 more failure candidates; LIN-687, LIN-1033, LIN-1614, LIN-2481, LIN-2554, LIN-2590, LIN-2903, LIN-2985, LIN-2988, LIN-2989, LIN-3133 and the rest of the 18 pin tickets; LIN-450, LIN-704, LIN-756 to LIN-758: read over the workspace proxy 2026-09-30"
  - "GitHub Actions runs of JKershaw/LinearViewer and JKershaw/simple-dispatcher since 1 June, via gh, 2026-09-30"
  - "local session transcripts under ~/.claude/projects and simple-dispatcher state/ run logs and oplog on the runner machine, read 2026-09-30"
---

# Do the supervisor, test-estate and throughput papers hold up?

On their headlines, yes; on several load-bearing claims, no. Every committed script re-runs, and
nearly every printed number matches exactly. **Supervisors:** a fresh blind recode puts the
mechanical share *higher*, at 86% of tokens (81–91%) against the paper's 77%, so "mostly
bookkeeping" holds. But it holds because the codebook calls a gate reply and a fetch mechanical,
not because of the coders. The quiet-wake share is 30.7% of wakes and 25% of the bill, not 32.5%
and 30%: the paper counted a resume handshake as a wake. "The answers are already held in code"
cites the right lines. But two of its claims are wrong: that the prompts ask for polling
alongside wakes, and that the merge-and-Done gate is only prose. Its list of supervisor slips
does not survive a reading of the tickets, though the total does: 22 of 25 failures were
mechanical, 21 in code. **Test estate:** the 25-second idle is real and is 31% of serial time,
but `armKeepalive` does not cause it. A timeout timer in `routes/proxy.js` that is never cleared
does. Flakes are the largest cause of red CI. The pin evidence is thinner than the paper says:
"pin edits 2.8%, rising" counts whole files, and assertion-literal edits fell. Only about five of
the 18 "bump" tickets are bumps. The catch-against-bump table rests on one or two real catches
a class. **Throughput:** the printed numbers reproduce, but the definitions carry the
reliability paper's finder-row error. 35 of the 66 Bugs that "name their introducer" name the
ticket whose review found the fault, and the true median lag is 3.3 days, not the same day.
June's 95 a week covers the weeks of 8 to 29 June; June's calendar weeks give 69. And the
per-change detection power treats changes as independent: over four weeks it detects ×2.8 in
dispatches and ×2.0 in hours, not ×1.4 and ×1.3. A doubling still shows first in hours per
change, but only just, and not within one or two weeks. The scorecard's weekly dispatches are
clear of the July run-log gap; the per-ticket July figures are not. Each paper's version 2
corrects its statements; judgement disagreements stay here. Nineteen lines of
`docs/steady-base.md` change, and a twentieth misquotes the earlier check.

## Findings

### What supervisors do

**Every script re-runs byte for byte, and every printed number matches.** A fresh extract over
the same window is identical to the author's cache under `cmp`: no transcript in scope had aged
out yet. Classify, sample, failures (offline), analyse and render then reproduce every output
file and both committed figures. Over a copy of the author's cache the same holds.

| Paper's figure | Re-run | Verdict |
|---|---|---|
| 32,525 steps, 254 sessions; 2 / 35 / 118 / 96 / 3 by layer | same | confirmed |
| 77% of supervision tokens mechanical, 80% by the second estimate; 61% of working time | 77.1, 80.3, 61.4 | confirmed; the recode puts it higher, below |
| The class table: steps, token shares, mechanical shares, time shares | same, row for row | confirmed as the rules' shares; the recode moves restate and poll, below |
| Median gate reply 34k units against 30k for a beat; 24k → 71k over 56 sessions | same | confirmed |
| 82 hours at work, 1,459 held | 81.6, 1,459 | confirmed |
| A third of wakes quiet, 1,782 of 5,485, 30% of the bill | same | **30.7% and 25%** once a handshake is not counted as a wake, below |
| The Runner "re-arms on 94% of its 970 wakes" | 94.1% of its wakes are *quiet*; it re-arms in 98% | label corrected |
| Stepper wakes 9% quiet | same | **7%** without the handshakes |
| Runner 15.8% of the bill, 97% mechanical; leg and stepper 21.6% and 34.4%, 70–71%; autopilot 26.7%, 92% | same | confirmed; these come from the direct estimate, which totals 80%, not 77% |
| Coder agreement 93.6% (κ 0.92), M or J 94.5% (κ 0.83), rules 71.8% (κ 0.67) | same | confirmed |
| 26 failures of 82 candidates; 12 / 6 / 6 / 2 by type; 24 mechanical; 21 in code | same counts | LIN-2145 is not among the 82; the classification changes, below |
| 108 failsafe re-confirms, 40 nudges, 30 refused duplicates, 47 other dispatch errors | same counts | **27** duplicates; the 47 are mostly outages, below |
| 27% of the fleet's weighted tokens | 35 × 0.771 | arithmetic confirmed; the 35% is another paper's, over a wider window |

**A fresh blind recode puts the mechanical share higher: 86%, not 77%.** 160 steps, none of
them among the paper's 220, were drawn systematically with probability proportional to their
weighted tokens. On that design the share of sampled steps coded M estimates the token-weighted
mechanical share directly, with no rule classes and no layer weights. Two coders coded every
card blind to the paper, its codes, the rules and each other, using the paper's own codebook
unchanged.
- **Agreement.** Class 98.1% (κ 0.98), M or J 92.5% (κ 0.68). The rules against the coders,
  where the coders agreed: 66.9% (κ 0.61), against the paper's 71.8%.
- **The share.** 86.2% of tokens mechanical, split verdicts counting half; a 20,000-resample
  bootstrap gives 81–91%. 82.5% of steps were M to both coders. By layer: Runner 100% (n=25),
  leg 86% (35), stepper 80% (55), autopilot 88% (43).
- **The sample matches the census.** The rules' classes of the 160 steps are 25% read, 23%
  re-arm, 20% restate, 12% judge and 7% dispatch, within sampling error of the paper's token
  shares (23.7, 24.2, 15.4, 13.7, 8.4).
- **Where it differs from the paper.** By the coders' class, judging a report is 68% mechanical
  (paper 50%) and writing a beat 45% (paper 22%). Most mechanical judge steps check a PR, CI or
  status the worker reported. The rules' largest error in this sample is not re-arm but restate:
  18 of the 32 steps the rules call restate are acknowledgements of a progress wake or a resume
  handshake, which both coders call poll. Poll is about 19% of tokens by the coders against 4%
  by the rules, restate 11% against 20%. Both are mechanical, so the total is unaffected.
- The coders flagged two failures: the 5 September wake doing a worker's job, which the paper
  also found, and an autopilot resolving a child's escalation itself instead of putting it to John
  (`1de62534:484`).

**The share is robust to the coders and hinges on the codebook.** Varying the estimator moves
it little: split verdicts as J 74.6%, as M 79.5%; either coder alone 77.3% and 76.9%; step- rather
than token-weighted 78.3%; a within-layer bootstrap 72–82%; without the two Runner sessions
73.6%. What moves it is the definition. The codebook makes a gate reply and a fetch of a known
URL mechanical by rule. Without the re-arm class the rest of the bill is 70% mechanical; without
re-arm and wake deliveries, 62%. And "read" is not all idle: about 16 of its 23.7 points are
reads in a cycle that goes on to judge, dispatch, relay or decide. The finding is exact for
what it defines, that three-quarters or more of the tokens pay for steps whose action state
decided. Whether code could take those steps over without losing what the model reads along the
way is the paper's first Limit, and this check does not settle it either.

**The quiet-wake share counts a handshake as a wake.** The cycle detector
(`scripts/survey-supervise-classify.mjs:27`, `-analyse.mjs:61`) starts a cycle at "resumed to
handle a follow-up … reply 'ready'", which the runner sends just before the "Your task … is
ready" wake it announces. That makes 142 one-step quiet cycles, and because a resumed session
rewrites its whole context cache they cost 5.9% of the bill. Merged into their wakes: 1,639 of
5,342 cycles quiet, **30.7%, and 25.3% of the bill**; the Runner 94.0% of 955; steppers 7%.
Leaving orient out of the quiet set changes nothing that matters (32.3%); leaving restate out
too drops the share to 18.8%, because 749 quiet cycles contain a restate step.
- "These are the progress wakes" was asserted, not measured. Reading the wake type from each
  fetched prompt: 87% of quiet cycles are "paused (pending), not done" progress wakes, and the
  rest terminal wakes (73), handshakes and task notifications. 39% of progress wakes (980 of
  2,525) did lead to an action, so a progress wake and a quiet wake are not the same thing.

**"The answers are already held in code": the lines are right, several claims are not.** Every
cited line was read at its sha.

| Citation | What the paper says | Verdict |
|---|---|---|
| `hook.js:418`, `:491`, `:1062` | the gate asks, parses, the wake text | correct |
| `hook.js:1437` | parks PENDING-EXTERNAL in `AWAITING_EXTERNAL` | correct, after a warm hold expires (`:1452`) |
| `reapers.js:877`, `config.js:112` | fails a session that re-declares PENDING too often | correct (three refires) |
| `reapers.js:1207` | failsafe after 60 minutes | correct; the 60 minutes is `config.js:50` |
| `reapers.js:1009` | live-child knowledge used "only" to exempt from the stall reaper | **too narrow**: it also gates the expired-hold fail path and the inactivity reap (`:2169`, `:2905`). "Never tells the parent" holds |
| `phases.js:131` | `isLegalTransition` has no run-time caller | correct in both repos |
| `lib/dispatch-wake.js:75`, `:151` | the progress text; guards self-wakes, loops, aborts | correct |
| `lib/dispatch-factory.js:62`, `:187` | refuses duplicates, over-budget and closed-ticket dispatches | **overstated**: duplicates only within five minutes and without `followUpTo` or `force` (`:272`); budget only when declared (`:389-393`); closed tickets only on the composed-run path (`:513-567`). Lineage inheritance is right |
| `lib/openrouter.js:1799`, `lib/recommend-recurse.js:106` | recommend is a model call in deterministic wrapping | correct |
| `autopilot-kickoff.js:198`, `:386`, `:467` | the child-set; the 30-minute clock; the plan bound in prose only | correct; the clock is at `:392-393`, the bound at `:469-472` |
| `autopilot-kickoff.js:447`; `passage-runner-prompt.md:132`, `:139` | prompts ask for polling alongside push wakes | **wrong**: the kickoff forbids polling a subscribed child (`:136`, `:384`); `:447` lists a watch verb; the passage prompt polls only a leg with no dispatch row, instead of a wake |
| `passage-runner-prompt.md:56` | re-read state rather than trust notes, "and keep those notes anyway" | the first half is right, about the passage description; the second has no source |
| "the merge-and-Done ledger gate" is prose only | | **partly wrong**: GitHub refuses a merge without green CI, and the proxy refuses Done on periodical tasks (`routes/proxy-writes.js:309-316`). The Approve-and-ledger half is prose |

The lede's "nearly all the answers are already held in code" is a claim the paper's own first
Next proposes to measure. The code check supports "much of it" for the completion gate, wake
delivery and stall handling, and does not support it for the factory's refusals or the polling.
Of the 24% "spent re-arming", the part that restates live-child state is the PENDING-EXTERNAL
replies, 20.4% of the bill.

**The failure list mostly survives in total and not in its examples.** Every one of the 26 and a
systematic 15 of the 57 excluded candidates were re-read over the proxy with their comments,
plus eight targeted tickets. Version 1 classed from the title and the first 1,500 characters.
- Six are not supervisor failures: LIN-1884 and LIN-2899 are worker sessions, LIN-1591 is a
  measurement (its own correction reads 14% of *dollar* spend over six sessions), LIN-2754 is a
  feature gap, and LIN-2229 and LIN-2468 are latent, with no incident.
- Five belong in: LIN-430 (an autopilot merged two red-CI PRs, June), LIN-353, LIN-870, LIN-1280
  and LIN-1451.
- Four change locus. LIN-1323's fix was in `hook.js`, which returned before parsing a correct
  PENDING-EXTERNAL; LIN-1656 was a missing creation guard. Both were "model", both are code.
  LIN-881, labelled code, is a supervisor that did not set `subscribe` when told to. LIN-384
  blames the recommend engine's defer decision, a model call.
- On that reading, 25: 15 missed or lost wakes, 4 loops, 4 wrong routings, 2 lost inputs; 22 in
  mechanical actions; 21 in code, 2 in the recommend engine, 2 a supervisor's own model slip.
  **None of version 1's five "supervisor's own mechanical slips" holds up as one.** The headline,
  mechanical and mostly plumbing, stands. Merging LIN-2517 into LIN-2511, which it splits from,
  gives 24.
- Of the transcript signals, 3 of the 30 "refused duplicate dispatches" are reads of a guide
  that mentions `DUPLICATE_DISPATCH`; of the 47 "other dispatch errors", 34 are HTTP 503s from
  tracker authentication or the AI service and 8 are failed reads.

**Smaller slips, each corrected in version 2.** There are twelve classes, not eleven. The relay
example is backwards: both sampled relays of a ruling were J to both coders, and the one M relay
points a gate line at an open decision. The mechanical-beat example ("sends preplanned beat 4/4")
was a split verdict; the three beats both coders called M re-send the engine's recommendation.
`review-loops.md` counted 83 of 94 *tickets* sent back at least once, not plans. Not every number
is printed by the analyse script. Two cited papers are not used and nine named tickets are not
cited.

### The test estate

**The measurements re-run; several of the readings built on them do not.** The shape script was
re-run at HEAD (no test changed since c65b7dd8), the timing script as a fresh serial run in a
scratch worktree at c65b7dd8, CI fetched and classified fresh through `gh`, the session script
fresh, the friction scripts at c65b7dd8, and the analysis over a copy of the author's cache.
Seven Harbour logic mutants (every fifth) and all four killed prose mutants were re-run.

| Paper's figure | Re-run | Verdict |
|---|---|---|
| Class table; 14,097 cases, 12,451 unit; 851 pins; 93% behavioural | identical per test | confirmed |
| Blind validation 64 of 85; pins 22 of 25; behavioural 35 of 36 | identical (`--validate`) | confirmed |
| Serial 324 s, 74 s inside tests (23%), median file 0.28 s | 323 s, 72 s (22%), 0.277 s | confirmed |
| Four files idle ~25 s, 101 s, 31% of serial | 101.7 s, 31.5%, the same four files | confirmed; **the cause is wrong**, below |
| Pin classes 18 s, about 5% | 17.3 s, 5.4% | confirmed |
| 181 failed attempts in 3,190 LinearViewer runs | 183 in 3,216 | the snapshot missed 26 runs of 12 and 15 June |
| PR attempts 54 flaky / 34 test / 19 fault / 5 bump / 10 unresolved | same from the cache | confirmed; recounted by run, below |
| Sessions 1,219 / 11,088 runs / 6,169 episodes / 3,267 deliberate / 1,386 test-first / 225 | identical up to the author's cut | confirmed as counts; the labels, below |
| Friction: 2.8%, 1.0 → 4.9%; 32 PRs; 18 tickets, 10 in September; 61 | identical | confirmed as counts; what they measure, below |
| Mutants 28 of 32; prose 4 of 19; simple-dispatcher 37 of 43 | identical; the 11 re-run match outcome and killers | confirmed |
| Fault label right 10 of 11 on PRs, 2 of 9 on main | no committed source | cannot be re-run |

**The idle is a never-cleared timeout, not `armKeepalive`.** The four files
(`lin-2216-transient-vs-terminal-auth`, `lin-2804-provider-ui-endpoint-hints`,
`proxy-openrouter-fallback-note`, `lin-2363-kickoff-provider-attribution`) each take 25.5 s alone.
They take 0.4–0.5 s with `--test-force-exit`, and their longest test is 0.1 s. None imports
`armKeepalive`; all import `routes/proxy.js`. A preload that traced `setTimeout` found each file
arming a 25,000 ms timer in `withTimeout` (`routes/proxy.js:374-384`, set from
`GRAPHQL_TIMEOUT_MS` at `:337`), reached from `resolvePromptIssueContext`, and never cleared. In
a scratch worktree, unref'ing `armKeepalive`'s timer left all four at 25.4–25.6 s. Unref'ing
`withTimeout`'s brought them to 0.43–0.45 s with every test passing. The two 25-second defaults
are a coincidence. The paper speaks of serial time, correctly. It does not say the idle costs
wall-clock time too. A greedy pool over the per-file times finishes in 47 s with it and 26 s
without it at nine workers, and in 108 s against 75 s at three. CI runs the unit suite twice.
Measured whole-suite runs on the loaded runner machine pointed the same way, noisily. LIN-3158,
merged while this check ran, clears the `withTimeout` timer on settle.

**Flakes are the largest cause of red CI, by attempt and by run.** The classifier calls an
attempt flaky when the next green run has the same sha. Every one of the 72 flaky rows is a
re-run of the same workflow run, so it tested identical code. Counting attempts inflates flakes: one run re-tried to
attempt 6 gives five rows. By run, 176 failing runs: 47 e2e flaky, 28 e2e fault, 28 e2e test
updated. Faults and test updates together still outnumber flakes. A hand check of every 9th
LinearViewer PR attempt (15; 3 logs expired) agreed with the label 13 times. One flake had been
labelled a merge from main. The same `observation-rulings` test failed on two branches on the
same day, which suggests a real race rather than a harness flake.

**Several CI statements are wrong in detail.**
- "Unit-suite reds are mostly flakes": 13 of the 42 unit-job attempts are flaky and 13 are
  faults.
- "14 attempts fixed in interface code" are fewer faults. Three `header-nav` attempts are one
  branch failing a test its own PR added, two `next-run` attempts share a commit, and two were
  fixed in backend code.
- "Failing tests by class, e2e 107, behavioural 31" is both repos' 140 PR attempts, including
  38 with no named test, counted by job. LinearViewer's named tests alone give 71 and 24.
- "Pins turned CI red on a PR only twice" is true of the 851 unit pin-class tests. Count pins
  inside browser specs failed PR CI three more times (`audit.spec`'s template count twice,
  `templates.spec` once). They are classed e2e by the first matching rule.

**The pin evidence inside sessions rests on a handful of events.** The per-thousand table
turns 4, 4 and 12 text-pin episodes and 3, 5 and 5 census episodes into rates. All 33 were read
by hand:
- **Census:** one real catch against three bumps. None of the author's five "bumps" is a bump
  (two are a test-authoring error, three a missed probe), and two "rewrites" and one "fix" are
  bumps.
- **Text pins:** two catches, one a syntax error, one bump, and three false positives from an
  ordering pin. All 12 "rewrites" are one mutation probe the detector missed. So "rewritten
  three times as often as either" is wrong.
- **Direction:** "about as likely to demand a bump as to catch a fault" holds, bumps at or
  above catches, on one or two catches a class.
- **Source scans:** 6 of their 12 "fixes" are one session re-pointing scans after code moved,
  the caveat the paper itself raises.
- **Behavioural:** "they make almost every catch that survives" reads the 225 production edits,
  which the paper rightly calls a ceiling, as catches. Every 16th behavioural episode was read
  (10): one was a real catch, the rest missed probes, tests written first, the AppleScript
  environment failure, a date-dependent test and a fixture.
- **The session window** is 31 August to 30 September, not 30 July: 30 July is one stray run.

**The friction figures measure less than they say.**
- "Pin edits are 2.8% of changed test lines, rising to 4.9%": 88% of those lines are every
  changed line of a file flagged as a pin file. A file is flagged for as little as the word
  "census" or one source read. Assertion-literal edits alone are 0.33%, and they fell from 0.75%
  in June to 0.27% in September.
- The 18 tickets, each re-read, are mostly not bumps. About five are: two snapshot re-baselines
  (LIN-1033, LIN-1614), two doc or comment counts with no test (LIN-687, LIN-2481), and
  LIN-3133. The other 13 repair or extend weak pins. Of the "four pure count bumps", LIN-2985 and
  LIN-2989 add entries nobody had pinned, LIN-2988 was cancelled, and LIN-3133 also changed
  production code. The paper's own rule misses two more (LIN-2554, LIN-2590): 20 in all, 12 in
  September. One of the 18, LIN-2903, is simple-dispatcher's, against "no ticket".

**Smaller slips, each corrected in version 2.**
- `opencode-runner.test.js` fails when `SD_WORKER_USAGE_RELAY=1` is set, not
  `HARBOUR_LOCAL_BASE`.
- Behavioural tests caught two of the four killed prose mutants, not one.
- Two of simple-dispatcher's 47 curated mutants target Harbour and were not run: 45 ran, 43
  still apply.
- The 6,234 "text pins" are `growth-atlas.md`'s count, not `survey-check.md`'s.
- Two citations are a few lines off (`cheap-implementer.md:208-210`, `growth-atlas.md:104`), and
  `reliability-baseline.md:106` is cited but not used.

### Measuring throughput

**Every printed number reproduces.** The git, runner, fleet and token scripts were re-run fresh
with `origin/main` pinned to the paper's shas. The scorecard was run over the author's tracker
and GitHub snapshots, and 19 fresh proxy reads checked the ticket list. Every line of the
scorecard's output matches, except three. The week of 31 August's tokens per change are 11.0
million, not 11.4, because transcripts have aged out. The unfinished last week gained 3.7
working hours. At today's `origin/main` September's rank correlation is 0.21, not 0.23. Both
figures regenerate byte-identical.

| Paper's figure | Re-run | Verdict |
|---|---|---|
| 47 a week since mid-July, 95 "in June"; 131 PRs a week | 46.5, 94.8, 131.3 | reproduce; **the June weeks are 8 to 29 June**, below |
| 998 mature; 14 / 31 / 78 / 114 / 139 not; 763 pass, 76.5% | identical | reproduce; the definitions, below |
| "Three in four merged tickets" | 76.5% of the mature population; 71.6% since mid-July | true only over the whole population |
| 66 escapes name the change; median filed the same day, 86% in 7 days | identical | reproduce; **35 of the 66 name the finder**, below |
| Blocks: 152 / 232 / 127; 35.4 / 25.7 / 48.8 dispatches and 4.43 / 2.67 / 2.79 hours a change; medians 13 / 9 / 18 | identical | reproduce; July's hours, below |
| Tokens 11.4 / 14.4 / 11.4 / 16.0 M a change | 11.0 / 14.4 / 11.4 / 16.0 | transcripts age out |
| By repo, BLOCKED entries, correlations, process weight, docs-only 43 | identical | reproduce |
| CVs and detectable ratios, lag-1 −0.13 to 0.19 | identical | weekly rows hold; **per-change rows do not**, below |
| "A cap of 1 to 4 hours gives 3.2 to 3.8 hours a change" | 3.0 to 3.5 pooled, as the table pools | the paper averaged weekly ratios instead |

**The definition of correct inherits the finder rows, and more of them than `survey-check.md`
found.** The scorecard reads `introducedBy` from the reliability verdicts, which survey-check
found often names the ticket whose review *found* an older fault. By their own reasons
("pre-existing", "predates", "older code", "left out of scope"), 35 of the 66 escapes that name
a change are finder rows. They include all 18 that survey-check listed. The scorecard's window
opens two days *before* the merge, so it also re-admits 11 negative-lag rows that the
reliability script drops, 10 of them finder rows. The other 31 were filed a median of **3.3
days** after the change's last merge, 71% within 7 days and 97% within 30. So "the median is
filed the same day … this agrees with the reliability paper's 1.4 days" is wrong twice. The
real lag agrees with survey-check's corrected 4.1. Eight of the 31 changes counted incorrect
are named only by finder rows (LIN-1815, LIN-2037, LIN-2291, LIN-2331, LIN-2333, LIN-2351,
LIN-2354, LIN-2384). Without them 770 pass, not 763.

**The named-fix test matches mentions.** A later ticket counts as a fix of a change when its
subject *or its ticket's title* says fix, and the change's id or PR number appears *anywhere in
its description* (`survey-reliability-git.mjs:86-98`). 36 of the 78 say fix only through the
title, 69 name the change only in the description, and a PR number is not checked against its
repo. One reader read the text around each mention, not blind. About 11 clearly blame the
change, 15 are unclear, and about 52 are mentions: "prior history … is unrelated", "do NOT fix
this", line-number shifts, nine tickets named in one plan. With those and the finder rows
corrected the mature pass rate would be about 82%, not 76.5%. This reading is one reader's and
first, so version 2 reports it as a limit, not a figure.

**Completeness is biased both ways, not only down.**
- **Omitted origins.** It takes a follow-up's origin to be its parent, even when the parent is
  an epic. 38 mature changes named in the text of such follow-ups count as complete. It ignores
  `kind:review-residue` filings. Filings that say "Filed by LIN-X close-out" or "Routed from
  LIN-X review" name 78 more mature changes (sampled, not all read).
- **The 23-of-40 rate does not transfer.** The Limits cap the downward bias with
  `never-worked-pile.md`'s 23 of 40, a sample of *never-worked* follow-ups. A quarter of
  follow-ups were worked.
- **Right-censoring.** Completeness has no window at all, so recent weeks are high on both
  counts. The week of 21 September shows no named fix and 6% incomplete, against 8% and 20% in
  the mature weeks since mid-July. At mature rates it would have about 50 correct, complete
  changes, not 65, "not a few".

**The 95 → 47 fall: June's figure is the weeks of 8 to 29 June, and most of the fall is fewer
merged tickets.** `survey-scorecard.mjs:274` averages the weeks beginning 8, 15, 22 and 29 June;
the last runs into July. June's four calendar weeks, 1 to 22 June, give 69 a week. In the week of
1 June only half of merged PRs named a ticket, against 81–100% in every week after, so 69 is low
too. On the paper's weeks, merged Done tickets fell from 111 to 64 a week before any filter. Of
the 48-change fall, 37.5 (78%) is fewer merged tickets and 10.8 (22%) a lower pass rate, 84% to
72%. The pass rate fell for reasons June could not show:
- **Finder-row escapes:** 4.3 points; none are in June.
- **Follow-ups:** the `kind:follow-up` label came into use around 10 June.
- **Routed Bugs:** June has none.
- **What did not change:** the join does not lose later tickets, and the median change is
  about 80 production lines in both periods.

`why-throughput-halved.md` (LIN-3155), which landed while this check ran and is not checked
here, finds the same four-fifths and one-fifth on the same weeks.

**The weekly detection power holds; the per-change power does not.** The method is a z-test on
log means, exp(2.8·s·√(2/k)), with weeks independent and s from 11 weeks. Taking t-quantiles for
an s estimated on 10 degrees of freedom, the weekly count needs ×2.66 at four weeks and ×2.0 at
eight: "about eight weeks" is the edge. The per-change rows assume about 47 independent changes a
week, but only 41 a week have runner data. Their weekly means vary 2.7× (dispatches) and 2.1×
(hours) more than independence predicts (F = 15.0 and 7.3 on 10 and 444 degrees of freedom).
On the observed spread of the weekly mean, four weeks detect ×2.8 in dispatches and ×2.0 in
hours, and eight weeks ×2.1 and ×1.6, against the paper's ×1.4 and ×1.3. A halving is not
visible in one to two weeks (×7.9 and ×4.3). The per-change series is also a different measure
from the headline one. Its dispatches are those mapped to each ticket, not fleet dispatches over
changes, and its hours are the runner's uncapped clock. The paper's conclusion survives only
weakly: hours per change sees a doubling at about four weeks, the weekly count at about eight.

**The scorecard's weekly dispatches are clear of the July run-log undercount; three July
figures are not.** The fleet series starts on 13 July, after the 6–11 July gap, and 17,805 of the
17,910 oplog items since 12 July are in the run logs. What the undercount and the scope touch:
- **Hours in the July block.** The 673 working hours in the July block are every oplog session.
  The dispatches are Harbour's workspaces only. About 19 of those hours are from other
  workspaces, and 94 are from sessions the run logs cannot place. On Harbour's own sessions July
  is about 3.7 hours a change, not 4.43, so the fall "from 4.4" is overstated.
- **July's rank correlation**, 0.06, includes tickets merged 1 to 12 July, before the oplog,
  whose median is 5 dispatches. From 13 July it is 0.11.
- **The per-ticket medians and the per-change noise** use `survey-effort-runner.mjs`'s
  every-item-ever mapping. From 13 July it barely touches pre-gap logs (0 of 178 tickets), and
  the July median of 13 is not low.

**Two citations do not stand after `survey-check.md`, and version 2 replaces both.** "Per
ticket, dispatches doubled while working time held" is about 1.4× from July, almost all warm
beats. The paper's own blocks agree: the median went 13 → 18 and fleet dispatches per change
35.4 → 48.8, both 1.38×. "Nearly doubled from August" is true only because August is the cheapest
block. And the risk gap does not "disappear once size is held fixed". The data cannot tell equal
effort from a difference of half either way.

**Smaller slips, each corrected in version 2.** The five changes with no state did not merge
after the census. They merged 13 to 28 June: LIN-450 and LIN-704 are Done but missing from the
team list, and LIN-756 to LIN-758 no longer exist in the tracker. "66 of 190 escaped Bugs name
the change" is about 31. The other citations land where the paper says.

### The lines of `docs/steady-base.md` that change

The anchor (at fd6b1352) was written from version 1 of all three papers. This check did not edit
it. Nineteen lines change because of this check, and one more because it misquotes
`survey-check.md`:

| Line | Now | Should read |
|---|---|---|
| 23 | "Without that layer, supervision was flat at 26–28%." | 28%, 24%, 15% and 26% by week: flat to falling (`survey-check.md`) |
| 29 | "A third of wakes change nothing, and they are 30% of the supervision bill." | 31% of wakes, and 25% of the bill; the Runner's 94% stands |
| 30 | "Most of the answers are already held in deterministic code …" | Much of it is (the completion gate, wake delivery, stall handling); how much is unmeasured. The prompts do not ask for polling alongside wakes, and part of the Done gate is in code |
| 31 | "24 of the 26 on record were in mechanical actions, and 21 of those were bugs in the plumbing." | 22 of the 25 on record, on a reading of each ticket; 21 were in code |
| 41 | "… make nearly all the catches that matter." | Behavioural tests alone kill most sampled logic mutants; in sessions the 225 production edits are a ceiling, and a reading of ten found one catch |
| 42 | "turned CI red only twice since June … a pin demanded a bump about as often as it preceded a fix, and 18 tickets since June exist mainly to bump one." | Twice as unit tests; count pins inside browser specs three more times. Bumps at least as often as catches, on one or two catches a class. 18 tickets (20 by the paper's rule) exist mainly to repair or bump a pin; about five are bumps |
| 46 | "four files idling about 25 seconds each on an open keepalive handle." | … on a 25-second timeout timer in `routes/proxy.js` that is never cleared; it also costs about 20–30 s of parallel wall-clock |
| 75 | "(95 a week in June; …)" | 95 a week in the weeks of 8 to 29 June; 69 in June's calendar weeks, when half of PRs named no ticket |
| 76 | "26–49 dispatches and 2.7–4.4 working hours per correct change" | July's 4.4 counts other workspaces' sessions; on Harbour's own it is about 3.7 |
| 79 | "The instrument detects a 1.4× shift in dispatches per change, or 1.3× in hours, within four weeks." | ×2.8 in dispatches and ×2.0 in hours over four weeks; hours per change sees a doubling at about four weeks, the weekly count at about eight |
| 96 | Row 1: "A third of wakes change nothing, 30% of the supervision bill"; "stop prompts asking for polling on top of push wakes"; "(12 of 26)"; "~10%" | 31% of wakes, 25% of the bill; the prompts do not ask for that polling; 15 of 25; the ~10% was 30% of the 35% share, and 25% of it is about 9% |
| 97 | Row 2: "re-arms on 94% of its wakes" | 94% of its wakes change nothing |
| 98 | Row 3: "the answers are already in code" | much of it, unmeasured; 77% mechanical stands, 86% on a fresh blind recode |
| 99 | Row 4: "(the open keepalive handle)"; "up to about a third of serial unit time" | the uncleared `withTimeout` timer; a third of serial time and about 20–30 s of parallel |
| 101 | Row 6: "18 bump-only tickets since June, 10 in September; no CI catch on record"; "~2–3 tickets a week of bump work" | about five of the 18 are bumps; e2e count pins failed PR CI three times; the weekly rate rests on the 18 |
| 121 | "fall from 95 a week in June to about 47 from mid-July" | from 95 in the weeks of 8 to 29 June; about four-fifths of the fall is fewer merged tickets, a fifth a lower pass rate |
| 123 | "The research papers themselves are unreviewed by a second document for this wave" | checked by `survey-check-2.md`; each has a version 2 |
| 136–138 | The three papers, unversioned | each "(v2)", and a row for `survey-check-2` |

Unchanged and confirmed: line 27's 77% and 27%, line 45's 77% outside any test, line 44's
flakes, line 47's stale mutants, and line 77's tokens.

## Method

Each paper's own commands were re-run unchanged. Outputs went to the git-ignored `data/`, and
figures to scratch directories; no committed figure was redrawn.

```sh
# what supervisors do: a fresh extract over the paper's window, then every step; and over a copy of the author's cache
node scripts/survey-supervise-extract.mjs --since 2026-09-01 --until 2026-09-30T12:00:00Z --out data/check2/sup-fresh
node scripts/survey-supervise-classify.mjs --in <dir>/steps.jsonl --out <dir>/coded.jsonl
node scripts/survey-supervise-sample.mjs --dir <dir>
node scripts/survey-supervise-failures.mjs --dir <dir> --offline
node scripts/survey-supervise-analyse.mjs --dir <dir>
node scripts/survey-supervise-render.mjs --dir <dir> --out <scratch>/fig
# the recode's sample (committed with this check)
node scripts/survey-supervise-pps.mjs --dir <author's cache> --n 160 --start 0.37

# test estate: shape and validation at HEAD, timing at c65b7dd8, CI and sessions fresh, friction at c65b7dd8
node scripts/survey-tests-shape.mjs --rev HEAD --sample 70 --seed 3151 --validate
node scripts/survey-tests-timing.mjs lv            # in a scratch worktree at c65b7dd8
node scripts/survey-tests-ci-runs.mjs; node scripts/survey-tests-ci-fetch.mjs; node scripts/survey-tests-ci-classify.mjs
node scripts/survey-tests-local.mjs; node scripts/survey-tests-friction-git.mjs; node scripts/survey-tests-friction-tickets.mjs
node scripts/survey-tests-analyse.mjs; node scripts/survey-tests-figures.mjs

# measuring throughput: git, runner, fleet and tokens fresh; the scorecard over the author's snapshots
node scripts/survey-effort-git.mjs; node scripts/survey-effort-runner.mjs
node scripts/survey-growth-fleet.mjs --json > data/survey/scorecard-fleet.json
node scripts/survey-effort-fleet.mjs --since 2026-08-31 --until 2026-09-30T06:50:00Z
node scripts/survey-scorecard.mjs --cap-hours 1|2|3|4 --svg <scratch>
```

**Caches.** The three authors' caches survived in other session workspaces on this machine and
were copied, not trusted. The supervisor extract was compared with a fresh one (identical), the
test estate's CI and session snapshots with fresh pulls, and the scorecard's ticket list with a
fresh list read.

**The recode.** `scripts/survey-supervise-pps.mjs` orders the census by session start and step
and walks it in steps of one-160th of the total weighted tokens, from a fixed start of 0.37 of a
step. It skips the paper's 220 steps; a hit moves to the session's next step, which happened
twice. Cards are built exactly as the paper's sampler builds them. The two coders were given
only the paper's codebook and the cards. Coder 2 read them in reverse. Neither saw the paper, its
codes, the rule classes or the other's file. Agreement is raw proportion and Cohen's κ. A step
scores 1 if both coders marked it M, 0.5 if they split, 0 if neither. The mean score over the
sample is the token-weighted share, with a 20,000-resample bootstrap interval. The codings, and
each step's rule class added afterwards, are in `survey-check-2-codes.json`.

**Code and tickets.** Every code line a paper cites was read with `git show <sha>:<path>`, and
every uncited claim about code was checked with `git grep` in both repos. The idle was traced
with a preload that wrapped `setTimeout`, and tested by unref'ing each candidate timer in a
scratch worktree. About 90 proxy reads, no writes except this ticket's status and comment. Each
was paced at one per 8 seconds, because a sibling session shared the proxy's 60 a minute:
- all 26 supervisor failures, a systematic 15 of the 57 excluded candidates and 8 targeted;
- the 18 pin tickets and 2 misses;
- the ticket list and 6 details for the scorecard.

**Hand readings.** Each was one reader, not blind:
- all 33 census and text-pin session episodes;
- every 16th behavioural production-fix episode;
- every 9th red PR attempt;
- the text around each of the 78 named-fix mentions;
- the reasons of the 66 escapes.

The one-off analyses that produced the sensitivity, cycle, power and decomposition figures are
in the session scratchpad and are not committed; every number they give is stated here with its
population.

## Limits

- **Every reader shares a tier with the authors.** The re-runs, the recode and the readings are
  independent of the authors' sessions and reasoning, not of their model tier. The recode uses
  the paper's own codebook, so it tests the coding, not the definition. The definition is where
  the mechanical share is exposed.
- **The recode's agreement on class is high enough to be suspicious.** 98% on class, κ 0.98, is
  higher than the paper's 94%. Both coders read quickly, and a card's wake text makes many steps
  easy. M or J agreement, κ 0.68, is the figure to weigh, and it is lower than the paper's 0.83.
- **The PPS sample's precision.** 160 steps give ±5 points on the share. The sample's rule mix
  matches the census, but its judgement classes are thin: 17 judge steps and 11 beats.
- **The failure re-reading, the named-fix reading and the pin-episode reading are one reader
  each, not blind.** They show where the papers' labels are weak. Counts from them are first
  readings, and version 2 reports the named-fix reading only as a limit.
- **The parallel-time figures are a simulation.** Measured full-suite runs on the runner
  machine, under heavy sibling load, pointed the same way but varied by 20 seconds.
- **The effect on the fleet.** The check re-ran a simple-dispatcher script that, run as a
  module, starts the mutation gate. It was stopped mid-mutant, and the one mutated file in this
  session's checkout was restored and verified clean at 3b1e734. The live runner's checkout was
  not touched.
- **Transcripts age out daily.** The supervisor extract was still identical today; a later
  re-run of this check will not be.

## Next

- **Which of the scorecard's named fixes are fixes, and which follow-ups are the change's own?**
  The correct and complete tests rest on text matches: 69 of 78 named fixes are a mention
  anywhere in a later description, and 116 mature changes are named as origin in filings the
  scorecard ignores. A blind second reading of both sets would turn the scorecard's correct and
  complete rates from bounds into estimates. This goes into `proposals.md`.
- The existing `proposals.md` line on per-change sensitivity quoted ×1.4 at four weeks; it is
  corrected to the observed spread, ×2.8 in dispatches and ×2.0 in hours.
- `why-throughput-halved.md` (LIN-3155) landed while this check ran. It uses the same "June"
  weeks and, for its escapes by tier (9.6% against 2.4%), the same `introducedBy` field, so its
  check should test how many of those escapes are finder rows.
- Each paper's own Next stands. The test estate's "what holds them?" is answered here. The
  supervisors paper's first Next, replaying gate replies against the runner's own state, is the
  measurement that would say how much of the mechanical share state alone decides.
