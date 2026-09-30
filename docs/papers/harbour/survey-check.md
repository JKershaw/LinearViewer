---
title: Do the three survey papers — growth, effort and reliability — hold up?
kind: paper
version: 1
date: 2026-09-30
authors: [Claude]
model: "Frontier tier, claude-code. One bounded session (dispatch b82a90d8, kind custom, LIN-3153), no plan, review or close-out legs, by the brief's design. Three in-session sub-agents of the same tier re-ran one paper each and did the second reading; this session read their reports, re-read two of the tickets they relied on, and checked their arithmetic before using it. Not the author of any of the three papers: they came from dispatches 95ecbd59, f8d71367 and 0a5bf247."
grounded_at: 4e566c2a (LinearViewer, where the papers measured; the git scripts were re-run there) and c65b7dd8 (origin/main when checked); 3b1e734 (simple-dispatcher)
cites:
  - "docs/papers/harbour/growth-atlas.md@c65b7dd8 (version 1, LIN-3147)"
  - "docs/papers/harbour/where-the-effort-goes.md@c65b7dd8 (version 1, LIN-3148)"
  - "docs/papers/harbour/reliability-baseline.md@c65b7dd8 (version 1, LIN-3149)"
  - "docs/papers/harbour/reliability-baseline-defects.json@c65b7dd8, reliability-baseline-review-blockers.json@c65b7dd8"
  - "scripts/survey-growth-*.mjs, scripts/survey-effort-*.mjs, scripts/survey-reliability*.mjs @c65b7dd8, each re-run"
  - "scripts/survey-effort-fetch.mjs@c65b7dd8:26-28, survey-effort-analyse.mjs@c65b7dd8:68-71 (cached fetch errors)"
  - "scripts/survey-reliability.mjs@c65b7dd8:56,65,75 (residue by label; the lag filter)"
  - "scripts/survey-growth-git.mjs@c65b7dd8:52,54; survey-growth-chart.mjs@c65b7dd8:93,153 (test cases, pins, endpoints, the step week)"
  - "docs/papers/harbour/steady-base-check.md@c65b7dd8 (the house check form)"
  - "LIN-3032, LIN-2849, LIN-2351, LIN-1137, LIN-2081 and 44 sampled Bug tickets, read over the workspace proxy 2026-09-30"
  - "simple-dispatcher state/dispatcher.run-*.log and state/oplog.jsonl on the runner machine, read 2026-09-30"
  - "GitHub PRs and Actions runs of JKershaw/LinearViewer and JKershaw/simple-dispatcher, via gh, 2026-09-30"
---

# Do the three survey papers — growth, effort and reliability — hold up?

On their headlines, mostly yes; on four load-bearing claims, no. Every git-derived figure in all
three re-runs exactly, and the analysis scripts reproduce every printed number from the authors'
caches. **Growth:** process does outgrow product, at every base week from 25 May to 6 July, net
or gross, with or without comments, and with the fleet's own code on either side of the line.
The multiples are fragile, because June is a step: pins fall from 12.2× to 7.4× if the base moves
one week. **Effort:** the supervision share (35%) holds, but its September rise is entirely the
passage Runner and its legs, and "dispatches doubled at every size while working time stayed
flat" does not hold. The runner's logs undercount July; on the tickets they see whole the rise is
about 1.4×, from 1.2× to 1.8× by size, almost all of it warm beats into held sessions. **Reliability:**
the escaped-defect counts reproduce, but residue is found only by its label, and at least 21 more
escapes are residue without it. With them out, LinearViewer's September is 5.7 per 100 merged PRs,
level with June, so "finding, not making" holds there more strongly than the paper says;
simple-dispatcher's September is 27, not 44, and within noise of June. The attributed-escape lag is
about 4 days, not 1.4, and the "three gates, most escapes" result was manufactured by rows naming
the ticket whose review found the fault. The review catch-rate is 35–45% at best, on an interval of
about a quarter to two-thirds. Each paper's version 2 corrects its figures. The judgement
disagreements stay here.

## Findings

### The growth atlas

**Every git figure re-runs exactly; the tracker and fleet figures within 1–2%.** The two git runs
were made at the paper's shas, CI through `gh`, the fleet script against the runner's state, and
a fresh tracker fetch (13 list pages and 315 details) on 30 September:

| Paper's figure | Re-run | Verdict |
|---|---|---|
| Harbour production 3.7×, tests 9.3×, reading 3.7× (233 → 861 KB) | 3.66×, 9.28×, 3.70× | confirmed |
| simple-dispatcher code 8.4×, tests 42×; dispatch + fleet 10.2×; hook + state 13.4×; views and UI 2.6× and 2.3× | identical | confirmed |
| Product code 2.9×; tests 10.6×; pins 12.2×; comments 7.1×; reading 4.6×; cumulative Done 7.0× | identical | confirmed; pins depend on the mix, below |
| Endpoints 2.2× "across both repos" | 137 → 301, **Harbour only** (`survey-growth-chart.mjs:93`) | label corrected |
| Area table, comment shares 54 / 53 / 48 / 33% | identical | confirmed |
| Product ~2,800 lines a week (2,872 → 2,709); reading 40.9 → 35.7 KB a week | identical | confirmed, as means (weekly product ranges 515–5,619) |
| Test share of net added lines 40 / 62 / 75%; PRs 300 in 21 weeks, 970 in 13 | identical | confirmed |
| Unit pass 0.23 / 0.85 / 1.38 / 1.87 min; whole run 2.8 → 5.1; simple-dispatcher 0.37 → 0.85 | same, but "now" is 2.20 at the re-run | "now" moves with the run read |
| Created per Done 1.8 / 2.2 / 1.8; Done a week 108 / 73 / 95; descriptions by month | 1.82 / 2.20 / 1.86; 107 / 73 / 93; identical | confirmed |
| Comment words per Done 1,702 → 8,180 → 6,037 | 1,705 → 8,180 → 5,986 | confirmed |
| Fresh sessions 456 → 526 a week, beats 809 → 1,572; 14,011 of 20,449 dispatches are beats; tiers 68 / 27 / 5% | identical (the logs have grown by 7 items) | confirmed |
| Open pile ~20 on 1 June → ~1,140 | 20 → 1,150; census 1,143 | end confirmed; base corrected, below |

**Seven statements are wrong.** Version 2 corrects each one.

| Paper's statement | Correct | Why |
|---|---|---|
| "The week of 31 August was the busiest week of the year" | Busiest only for net test lines (29,781). The weeks of 22 and 29 June merged more PRs (134 and 136 against 115); the week of 21 September ran more dispatches (3,725 against 2,288) | read from the same weekly series |
| After 31 August "net test lines per week roughly doubled", 9,711 → 18,172 | **15,269** a week after the step week, 1.6× | the "since 31 August" periods (`survey-growth-chart.mjs:153,172,178,206`) include the step week |
| "Local `node --test` counts 13,690 unit tests, so the regex is close" | The regex's 14,097 includes 1,566 e2e and 80 visual cases; its unit-only count is **12,451**, 9% under | `survey-growth-git.mjs:52` counts every test directory |
| Pins: "the growth multiple is biased only if test style changed" | Style changed. On 1 June 522 of Harbour's 580 pins were `.includes(`. `assert.match` and `doesNotMatch` grew **57×**, `.includes(` **6.0×** | `survey-growth-git.mjs:54` sums two patterns |
| Open pile "about 20 on 1 June" | **At least about 20, up to about 75** | the base rests on two sampled tickets, and 45 pre-June tickets were canceled or marked duplicate on dates the proxy does not give |
| August Done 400, and "September eased from August's peak" | A second one-in-ten sample gives 500; the two together **445**. On that count August's comment words per Done are about 6,600, level with September's | a single one-in-ten month is good to about ±15%, not the ±30% a week the Limits quote |
| Unit pass "1.87 now", "8× since late June" | **1.9–2.2**, **8–10×** | each week's time is its last green run, so "now" depends on when the script runs |

Two smaller slips: the quiet weeks were three from 9 February to 1 March, then single weeks in
late March and mid-April, with no commits from 26 April to 15 May (not 27 April to 10 May); and the
reading rates are 1,000-byte KB while the totals are 1,024-byte.

**The product-against-process conclusion survives every definition we tried.** Multiples to 28
September, both repos:

| Base week | Product code | Tests | Pins | Comments | Reading | Endpoints |
|---|--:|--:|--:|--:|--:|--:|
| 25 May | 3.19 | 12.20 | 15.29 | 8.70 | 6.62 | 2.26 |
| **1 June** | **2.92** | **10.56** | **12.22** | **7.10** | **4.57** | **2.20** |
| 8 June | 2.56 | 8.43 | 7.37 | 5.39 | 3.52 | 1.88 |
| 15 June | 2.38 | 7.35 | 6.32 | 4.57 | 3.31 | 1.91 |
| 6 July | 1.69 | 3.57 | 2.51 | 2.45 | 1.98 | 1.43 |

- Every process series beats product code at every base. The gap narrows: tests over product
  from 3.6 at 1 June to 2.1 at 6 July, reading over product from 1.56 to 1.17.
- Counting comments and prompt text as product gives 3.89×, still below tests, pins and comments.
- Harbour's product is a dispatch control plane, so its dispatch and fleet code is both product
  and process. Moving it to process lowers Harbour's product multiple from 2.77× to 2.52×, widening
  the gap. Adding back the proxy catalogue's 660 lines at the base gives at most 2.99×.
- Gross, not net (`git log --numstat`): production code has about one line deleted per four added
  in every period; tests went from 12 deleted per 100 added before June to 3 since 31 August. On
  gross additions, tests per production line went 0.58 → 1.41 → 2.28. "Almost nothing shrinks" is
  true net; production code is rewritten throughout, and tests are nearly append-only. Net
  understates product work more than test work, so the net ratios slightly overstate the gap. The
  gross ratios still show it.

**Per Done ticket, the claim that holds is the robust one.** Three denominators were tried: the
paper's sample, the two samples together, and merged Done tickets from git. "Product per Done
flat; tests and conversation up 2.5–4× on June" holds under all three. "September eased from
August's peak" holds under none of the better two for comment words: per merged Done ticket,
tests keep rising into September (89, 201, 258, 275 lines) and comment words reach about 10,000.
Dispatches per Done rise 16.2 → 22.6 on the combined count, 1.4×, not 17.8 → 22.3.

**What the growth method cannot see, beyond its Limits.**
- What agents read at run time is mostly not on disk: ticket comments, briefs and the live
  catalogue reach every session. Comments are the fastest-growing text the paper measures, so "the
  reading load tracks delivery" is true of repository text only.
- The git numerator and the tracker denominator run on different clocks, and the share of Done
  tickets that ship no code is rising (245 Done against 161 merged Done in September). Part of the
  fall in product per Done is research and papers entering the denominator.
- Only first-parent `main` is seen: unmerged PRs, abandoned branches and the process spent on them
  are invisible, as are screenshot and visual baselines under `tests/`.

### Where the effort goes

**Its supervision share and its correlations re-run exactly; the monthly march does not.**
`survey-effort-git.mjs` and `survey-effort-runner.mjs` were re-run fresh. `survey-effort-analyse.mjs`
was run over those files and the author's proxy cache, and its report matches the author's
`report.txt` byte for byte. The fleet table was re-run fresh on the same window:

| Paper's figure | Re-run | Verdict |
|---|---|---|
| Supervision 35% of weighted tokens; 28% → 45% | 35.0%; 28.4, 23.5, 31.5, 45.4 by week | confirmed; not a steady rise |
| Implementation 24%, 28% → 18%; gates 24%; research and plan 13% | 24.6%; 28.4 → 17.8; 23.5%; 13.0% | confirmed |
| Re-orientation 3.5% (fleet), 5.6% (sample) | 3.5%; 5.2% (n=87) | confirmed |
| Median dispatches 8 / 10 / 17; working hours 1.41 / 1.39 / 1.56 | identical | reproduced; July's 8 is wrong, below |
| Waiting 28% → 72% | 28.3% → 72.1%, pooled | reproduced; median ticket 40% → 47%, below |
| Rank correlations: census 0.21 / 0.36 / 0.41; sample 0.19 / 0.32 | identical | confirmed; the sample's shift when the sample is repaired, below |
| Risk table; high risk 13 dispatches, 1.72 h, 196 lines against 100 | identical | reproduced; the reading is too strong, below |
| simple-dispatcher 11 dispatches, 1.40 h; LinearViewer 11, 1.49 h | identical | confirmed |
| 1,951 sessions in the fleet window | 1,942 | nine transcripts of 31 August were deleted between the author's run and ours |

**"Dispatches doubled at every size while working time stayed flat" does not hold.**
- By the paper's own table the rise is 1.6×, 1.3×, 2.25× and 2.3× across the four size bins. It
  doubled in the two larger bins only.
- July is undercounted. The run logs have a gap from 6 to 11 July, and `survey-effort-runner.mjs`
  gives every ticket every item ever mapped to it, so a ticket merged in early July loses part
  of its history. The July working hours come only from tickets merged from 12 July, when the
  oplog starts. On those same 157 tickets the July median is **12 dispatches, not 8**. By bin
  the late-July medians are 16 (n=7), 11, 11 and 14, so September is 1.2× to 1.8× July in the
  bins with enough tickets. The overall rise is about 1.4×, not 2.1×.
- The rise is warm follow-up beats. Median fresh sessions per ticket went 5, 6, 7; warm
  follow-ups 0, 3, 8. A beat is a message into a held session, so a September dispatch is a
  smaller unit than a July one. `growth-atlas.md` found the same from the fleet side.
- "Flat" working time rests on the generous instrument. On the 71 September tickets that have
  both, the phase clock gives a median of 1.57 working hours and the feedback-gap measure 0.62.
  In the largest size bin the phase-clock hours rose 27%.

**The supervision share holds; its rise is one new layer.** Without the passage Runner and its
legs, which first appear on 17 September, supervision was 28%, 24%, 15% and 26% by week: flat
to falling. One Runner session, flying LIN-3099 from 26 to 30 September, is 4.8% of all thirty
days' tokens. The share depends on the weights. Supervisors' tokens are mostly cache reads of
long waiting contexts, so at a cache-read weight of 0 the share is 29% and at fresh input and
output alone 23%. The direction of the September rise survives every weighting we tried. The
fall in implementation, 28% to 18%, is the same arithmetic: without the Runner and its legs it is
28% to 24%. 33 of the 35 legs also carry the stepper flag, so "leg" against "stepper" is a
naming order, not two populations.

**The waiting share is pooled, and a few tickets carry it.** The 28% → 72% sums session-hours
across all tickets. Ten tickets hold 48% of September's waiting; one (LIN-2837) has 142 hours
of peer wait. The median ticket waited 40% of its session time in July and 47% in September.

**Most of the per-ticket sample's gaps were fetch errors, not missing lineages.**
`survey-effort-fetch.mjs:26-28` writes an HTTP error into the cache as `{ error: status }`, and
no later run retries it. `survey-effort-analyse.mjs` then counts an error as "no cost data" or a
lineage "aged out". Of the 146 candidates, 52 are cached 404s and only 22 truly had no lineage;
all 9 "aged-out" lineages are cached 404s. We re-read a third of the sample at 12 calls a minute:
where the author's fetch had succeeded, all 32 lineage sets and all 185 usage streams match; of
the 17 former 404s, 16 now return data. With those 16 added (n=87):
- tokens against production lines 0.27, against test lines 0.37 (paper 0.19 and 0.32);
- a docs- or tests-only ticket costs about 77% of the median ticket, not 90%;
- the ticket's own autopilot 20.7% of its tokens, a woken supervisor 18.7%, span 2.6 h, working
    0.59 h (paper 21.5%, 19%, 2.5 h, 0.6 h).

The paper's Limits explain the missing half as lane-landed cheap tickets, biased up. That
explains the 22, not the 52.

**The size correlations are robust; the risk null is wide.**
- Tie-corrected Spearman moves the census correlations by less than 0.01 and the sample's token
  correlation from 0.19 to 0.16. Leaving out comment lines moves each by 0.02 or less, so the
  paper's Limit that comments flatten the size relation is not borne out. Leaving out `scripts/`
  (19% of LinearViewer's "production" lines) moves dispatches from 0.21 to 0.19.
- Test lines still lead with production size held fixed: partial rank correlation with
  dispatches 0.32 for test lines and −0.11 for production lines. Working hours against test
  lines, which the paper's table leaves blank, is 0.49. The direction is not identified: reviews
  ask for tests, so more rounds may make more test lines.
- The lede quotes the weak end. Working hours correlate 0.41 with production lines: moderate.
- Risk: bootstrapped intervals on the difference in median dispatches, high risk against the
  rest, run −8 to +14 (1–49 lines, n=9), −8 to +4 (50–299, n=39) and −6 to +13 (300 and over,
  n=29). The middle bin's "fewer" is partly month mix: 49% of its high-risk tickets merged in
  July, the undercounted month, against 35% of the rest. The data cannot tell equal effort from
  a difference of half either way. "Gets no more dispatches than any other" is not established;
  neither is its opposite.

**Two measures of dispatches per ticket agree once reconciled.** `growth-atlas.md`'s 17.8 → 22.3
divides all Harbour dispatches in a window, including tickets never Done, by the tickets Done in
it: a ratio of flows. This paper takes the median, over merged Done tickets, of every item ever
mapped to each; its means are 11.1, 14.4 and 24.7. Both put the rise down to follow-up beats.

**What the effort method cannot see, beyond its Limits.**
- Nothing joins effort to what it bought. "Most of it goes to supervising" is an accounting
  statement, not a finding of waste; no defect, finding or approval is set against the tokens.
- A dispatch is not a fixed unit across the period, and the two working-time instruments disagree
  2.5× on the same tickets. Only the git and run-log parts of the paper can be re-run after the day;
  transcripts and dispatch history age out at 30 days, and a re-run eight hours later had already
  lost nine sessions.
- A process that is risk-aware through ticket text or labels, rather than file paths, would not
  show in a risk class read from file names.

### The reliability baseline

**Every figure re-runs; the classification under four of them does not hold.** The GitHub,
git and analysis scripts were re-run on the author's caches (recovered from a sibling session;
the author's workspace had been reaped) and on a fresh GitHub pull and ticket list. The three
figures redraw byte-identical. A fresh pull matches up to the author's fetch at 07:03 on 30
September, and 54 re-fetched ticket details match the cache in dates and comments.

| Paper's figure | Re-run | Verdict |
|---|---|---|
| 265 Bugs: 190 escaped, 39 routed, 11 test-only, 23 not a defect, 2 unclear | same | confirmed |
| September 17.2 per 100 (61 / 355); LinearViewer 5.4 → 13.7; simple-dispatcher 12.2 → 43.6 | same | confirmed as counts |
| 47 of 103 August–September escapes are residue; 33 of August's 42 | same by label | label count confirmed; **67** by text |
| LinearViewer without residue: August 1.9, September 9.0 | same by label | **September 5.7** |
| simple-dispatcher September "has no residue", 24 of 55 stands | 9 unlabelled residue | **15 / 55, 27.3** |
| Operator-found 10/11, 18/26, 18/43, 2/42, 7/61 | same | confirmed |
| Bug is 1% of LIN-2000–2249 against 15–22% of LIN-2250–2999 | same | confirmed |
| 30 attributed escapes, median lag 1.4 days (0.1–6.4) | reproduces | **24, median 4.1 days (0.7–10.2)** |
| Size: 0.7 / 1.5 / 3.3 per 100 | reproduces | **0.7 / 1.2 / 2.5** |
| Depth: 2.1 / 1.1 / 2.2 / 4.4 per 100 for 0–3 gates | reproduces | **2.1 / 1.1 / 1.5 / 2.9** |
| Review: 24 bugs in 10 tickets, 23.1 per 100, 129–192, 38–48% | reproduces | **22 in 9, 21.2, 113–176, 35–45%** |
| Red CI: "1–5% of runs after June" | 4.6% in June; 0.7–1.5% a month since | wording corrected |
| Three reverts, none for a defect; no hotfix PRs; named fix-follow-ups | same | confirmed |

**Residue is found only by its label, and the label is missing on at least 21 escapes.**
`survey-reliability.mjs:56,65` treats an escape as residue only if it carries
`kind:review-residue`. A keyword pass over the verdict reasons, then a reading of each ticket,
found 21 more escapes whose own text says another ticket's review, research or close-out found
the fault in older code and filed it (for example LIN-3032: "Found by the review of
simple-dispatcher PR #245"; LIN-2849: a fault present since LIN-2619). Eleven carry
`kind:follow-up`. Nine are simple-dispatcher's September, ten LinearViewer's. The list is a
floor.

**`introducedBy` often names the finder.** The rubric lets the "introducer" be the ticket that
"introduced, exposed or left the fault unhandled", so a ticket whose review found an older fault
and deferred it becomes its introducer. Twelve such rows were filed before the named ticket
merged, and the filter `lagDays >= 0` (`survey-reliability.mjs:75`) drops them without a word.
Six more, each with a lag of 0.0–0.2 days on a September merge carrying review and close-out
gates, stay in the 30. They pull the median lag down to 1.4 days, and they credit review-found
faults to the tickets that had the most reviewing. That is what made the three-gate bucket the
highest.

**Escaped-defect rates: the rise is real as a count, and not as a fault rate in LinearViewer.**
Per 100 merged PRs, with 95% Poisson intervals:

| Month | LinearViewer, all | LinearViewer without any residue | simple-dispatcher, all | simple-dispatcher without any residue |
|---|---|---|---|---|
| Jun | 5.4 (3.3–8.3) | 5.4 | 12.2 (3.9–28.5) | 12.2 |
| Jul | 8.3 (5.4–12.0) | 8.0 | 14.8 (8.5–24.1) | 13.0 (7.1–21.8) |
| Aug | 12.6 (8.7–17.6) | 1.9 (0.6–4.3) | 22.7 (10.9–41.8) | 6.8 (1.4–19.9) |
| Sep | 13.7 (9.8–18.5) | 5.7 (3.3–9.1) | 43.6 (28.0–64.9) | 27.3 (15.3–45.0) |

- Counting residue as routed, the option the paper's Limits name, removes LinearViewer's rise
  and halves simple-dispatcher's.
- The denominator shifts the other way. Docs and paper PRs grew: in LinearViewer, PRs touching
  production code were 81% of June's merges and 70% of September's. Per production PR, all
  escapes, September is 19.6 against June's 6.7. The headline per-PR rate understates the count's
  rise; it does not change the residue reading.
- simple-dispatcher's 41 to 108 PRs a month give intervals 20 to 40 points wide. Only its
  all-escapes September clears June's interval.

**"Finding, not making" holds for LinearViewer, more strongly than the paper says.** Without
all residue, September equals June. The one series dated by the month a fault shipped rather
than the month it was filed, attributed escapes per 100 shipped tickets, is flat once the finder
rows go: 1.8, 1.8, 1.8 and 2.0 for June to September, on 6, 7, 5 and 6 escapes. With them in,
September shows a spurious 3.9. The shift from operator to agent finders is mostly the residue
channel: among LinearViewer's non-residue escapes, the operator found 15, 14, 2 and 3 and agents
3, 7, 3 and 10 from June to September. For simple-dispatcher the paper's direction is right and
its evidence is wrong. September has residue (9 of 24), and the 15 left are within the noise of
June's small base. Nine of the 24 come from other tickets' reviews and research on the substrate,
so part of that cluster is a review campaign.

**The review catch-rate is soft in both directions.**
- LIN-2351's two "bugs" come from a plan review ("Plan Review Verdict"), and the rubric counts
  only the change under review. Without them: 22 bugs in 9 tickets, **35–45%**.
- LIN-1137's catch had already failed CI, which GitHub would have refused to merge anyway. One
  of 22.
- Unit: the estimate compares review findings with Bug tickets. LIN-2081's eight interlocking
  findings would plausibly have escaped as one to three Bugs. Counting tickets with a caught bug
  instead (10 of 104) gives about 27%.
- A bootstrap over the 104 reviewed tickets (20,000 resamples) gives 8.7–43.3 bugs per 100
  reviewed tickets, **25–63%**. The paper's "±15 points" is about right.
- Denominator: every review catch is on a change made in the window, but the escapes include
  faults in pre-fleet code. Against non-residue escapes only, the share is 48–58%.
- Re-reading LIN-2081's first two send-backs found five bugs, and the paper's other three are
  plausible from the later rounds' summaries. The count of 8 stands.
- The ticket population for the blocker reading was chosen by a subagent and is not in committed
  code, so it cannot be re-run as the paper's Method implies.

**A second reading of 44 verdicts agrees on 39.** Every 6th Bug by number was re-read from its
title, labels, state, description and first two comments, before the recorded verdict was
looked at. For about 8 of the 44 the checker had already seen the recorded reason, so the reading
is not fully blind. Verdict agreement is 39 of 44 (κ ≈ 0.73), repo 42 and finder 41. Three of the
five disagreements move an escape out (LIN-946 and LIN-2576 to not-a-defect, LIN-2003 to
unclear); LIN-1881 moves from routed to test-only and LIN-2450 from routed to escaped. So the
escaped counts may be about 9% high (3 of 34). The systematic disagreement is residue: four of the sample's 34
escapes are unlabelled residue, which is what led to the full search.

**What the reliability method cannot see, beyond its Limits.**
- Residue without its label, and the difference between the ticket that wrote a fault and the
  ticket whose review exposed or deferred it. Both push any analysis that uses gates as a predictor
  towards "more gates, more escapes".
- A denominator that changed character: docs and paper PRs grew from 19% to 30% of LinearViewer's
  merges.
- Whether a review catch was review's alone: CI would have stopped at least one.
- The evidence behind each verdict. The committed verdicts keep a one-line reason and no quote, so
  any check has to fetch every ticket again.

## Method

Each paper's own commands were re-run unchanged. Outputs went to the git-ignored `data/`, and
figures to a scratch directory; no committed figure was redrawn.

```sh
# growth atlas: git at the paper's shas, then CI, fleet, a fresh tracker fetch, the chart script
node scripts/survey-growth-git.mjs lv . 4e566c2a --json > data/survey/git-lv.json
node scripts/survey-growth-git.mjs sd ../simple-dispatcher 3b1e734b --json > data/survey/git-sd.json
node scripts/survey-growth-ci.mjs JKershaw/LinearViewer test.yml --json > data/survey/ci-lv.json
node scripts/survey-growth-ci.mjs JKershaw/simple-dispatcher ci.yml --json > data/survey/ci-sd.json
node scripts/survey-growth-fleet.mjs --json > data/survey/fleet.json
node scripts/survey-growth-tracker.mjs fetch data/survey/tracker-cache.json
node scripts/survey-growth-chart.mjs data/survey <scratch>/fig

# where the effort goes: git, runner and fleet fresh; analyse over the author's proxy cache
node scripts/survey-effort-git.mjs --sd ../simple-dispatcher
node scripts/survey-effort-runner.mjs
node scripts/survey-effort-fleet.mjs --since 2026-08-31 --until 2026-09-30T06:50Z
node scripts/survey-effort-analyse.mjs --dir <author's cache>

# reliability baseline: GitHub and the ticket list fresh; analysis on the author's caches and on fresh ones
node scripts/survey-reliability-github.mjs data/survey/reliability-github.json
node scripts/survey-reliability-tracker.mjs data/survey/fresh-list.json --only-extra
node scripts/survey-reliability.mjs
node scripts/survey-reliability-git.mjs
node scripts/survey-reliability-figures.mjs --out <scratch>/fig
```

**Caches.** The effort and reliability authors' proxy caches survived in other session
workspaces on this machine and were copied, not trusted: each was compared with a fresh read.
The growth atlas's cache had not survived, so its tracker was fetched afresh.

**Fresh proxy reads.** About 940 GETs, no writes, each paced at 12 to 15 a minute so that the three
together stayed under the proxy's shared 60:
- growth: the list, 315 details, and a second systematic sample of 187 Done tickets (every one
  numbered …5), 34 of them reused from the reliability cache;
- effort: `/issues/{id}/cost` and every `/dispatch/{root}` for every third ticket of the paper's
  146-ticket sample (49 tickets, 369 calls);
- reliability: the list and 72 details, for the second reading and to test the cache.

**The second reading.** Every 6th Bug by number, offset 3: 44 of 265. Each was classed against the
committed rubric from its title, labels, state, description and first two comments before its
recorded verdict was opened. Agreement is raw proportion and Cohen's κ. The residue search that
followed was a keyword pass over all verdict reasons for the phrasing residue uses ("Found by the
review of …", "Pre-existing since …", "out-of-scope sibling"), then a reading of each hit's
description. The 44 readings, the 21 unlabelled residue tickets and the 18 finder rows are in
`survey-check-readings.json`.

**The new measures.** Base-week and gross-line multiples from the growth JSON and
`git log --first-parent -m --numstat`; the late-July dispatch medians, per-ticket waiting shares,
partial and tie-corrected rank correlations and bootstrapped risk intervals from the effort
census; Poisson intervals and a 20,000-resample bootstrap of the review catch over
the 104 reviewed tickets from the reliability data. The scripts for these are one-off analyses in
the session scratchpad and are not committed; every number they give is stated here with its
population.

## Limits

- **The sub-agents share a tier with the authors.** Each paper was checked by a reader of the same
  model tier that wrote it, in a separate session with no access to its author's reasoning. That is
  independence of session, not of model.
- **The second reading was not fully blind.** About 8 of the 44 had been seen, with their recorded
  reasons, while checking the attributed rows. The disagreements it found all run one way (fewer
  escapes), so the 9% is a ceiling on this sample, not an estimate for the 265.
- **The unlabelled-residue count is a floor.** It came from a keyword pass, then a reading of each
  hit. A residue ticket whose text uses none of the keywords is still counted as a fresh escape.
- **Two of the effort corrections use a partial refetch.** The 16 recovered tickets are a third of
  the fetch failures. The n=87 figures show which way the sample moves, not where a full refetch
  would land.
- **The effort fleet table cannot be exactly re-run any more.** Transcripts age out daily, so a
  later reader re-running this check will match neither the paper nor us.
- **The second Done sample tests the first, not the truth.** A monthly census of Done would take
  about 1,760 reads.
- **Our own scripts are unchecked.** The one-off analyses were read back once and not re-run by
  anyone else.

## Next

- **Can a ticket's effort be compared month on month in one unit?** "Dispatches" changed meaning
  over the summer, the two working-time instruments disagree 2.5×, and tokens exist only from 31
  August. This goes into `proposals.md`.
- The reliability paper's own Next, dating the introducing commit of each residue fault, should
  include the 21 unlabelled ones as well as the 49 labelled; its `proposals.md` line is widened to
  say so.
