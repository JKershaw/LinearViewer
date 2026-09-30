---
title: Patches on patches — does Harbour converge to a steady base, or only grow?
kind: paper
version: 2
date: 2026-09-30
authors: [Claude (version 1, LIN-3143), Claude (version 2 corrections, LIN-3145)]
model: "Version 1: frontier tier, claude-code, effort high; one bounded research session (dispatch 7d0975b0, kind custom), no plan, review or close-out legs, by the brief's design. Version 2: frontier tier, claude-code, the independent check's session (dispatch d220ff01)."
revision: "Version 2 corrects figures per docs/papers/harbour/steady-base-check.md (LIN-3145): the close-out lineage's prompt bytes, the review-comment lengths, the date and level of the June rise, the acceleration at the gates, who writes the model-written prompts, the deliberate cuts, the gates that are enforced in code, and the restatement count. Judgement disagreements stay in the check."
grounded_at: 8f5fe4aa (LinearViewer, origin/main)
cites: [docs/papers/harbour/steady-base-check.md (LIN-3145), docs/papers/harbour/fleet-complexity-read.md@8f5fe4aa, docs/papers/harbour/efficiency-levers.md@8f5fe4aa, docs/papers/harbour/review-loops.md@8f5fe4aa, docs/papers/harbour/review-consumption.md@8f5fe4aa, docs/papers/harbour/what-the-reviews-checked.md@8f5fe4aa, docs/papers/harbour/close-out-claims.md@8f5fe4aa, docs/papers/harbour/writing-length.md@8f5fe4aa, docs/papers/harbour/root-task-ratio.md@8f5fe4aa, docs/architecture/prompt-system.md@8f5fe4aa, docs/reviews/intra-session-efficiency-review-2026-08-14.md@8f5fe4aa, scripts/prompt-template-change-log.md@8f5fe4aa, tests/unit/claude-md-line-budget.test.js@8f5fe4aa, 1403655c (#462), 35dc0e14 (LIN-1270), d4f749c1 (LIN-2896), LIN-3143 (2026-09-29)]
---

# Patches on patches — does Harbour converge to a steady base, or only grow?

It only grows, and fastest at the gates. Since the fleet started in June, every measure of
process weight we could put a series on has risen, and none has paused for more than four weeks.

- **Prompts.** The close-out prompt is 4.5 times its June size. Review is 5 times its May size.
  Together they gain 5 to 10 KB a month, steadily rather than faster. The meta-prompt, from which
  a cheap-tier model writes five to seven worker prompts in ten, is 5.7 times its May size.
- **Code.** Half of every net new production line is a comment, and each new production line
  comes with nearly three lines of test.

The hypotheses are mostly right about the mechanism. Incident fixes land as prose: eight of
the ten tickets in the close-out lineage changed no runtime code. Almost nothing is ever
removed: 5 of 101 ticket citations have ever left the prompt text. They are wrong about where
the money goes. A cheap model reads the whole rulebook, about 26,000 tokens, each time it writes
a worker's prompt. The worker gets a digest of about 7 KB, which is about 2% of the context a
leg carries. For the expensive models, the rule text itself is cheap. The rules are paid for through what they make agents do: gates that loop,
ledgers and reviews that are written in full but only half read, and pins that must be bumped.
The one standing budget in the repo, the cap on `CLAUDE.md`, shows that a budget works on
what it caps. It also shows the growth moving next door.

## The four hypotheses

| Hypothesis | Verdict | The number that decides it |
|---|---|---|
| 1. Incident fixes mostly land as prose | **Supported for gate rules; not for prompt text as a whole** | Close-out lineage: 8 of 10 tickets prompt-only. But of 96 tickets cited in prompt text at HEAD, 42 also shipped runtime code |
| 2. Nothing removes a rule | **Mostly supported** | 17 of 221 prompt-text commits shrank it; 5 of 101 citations ever left; of three deliberate cuts, #462 was regrown in 7 days and LIN-1850 is still 22% below its old size |
| 3. Growth shows across several things | **Supported, with one exception** | Prompts, briefings, comments, code comments, test ratio and pins all rise. Ticket descriptions do not |
| 4. Only a hard budget bent the curve | **Supported, with a correction** | `CLAUDE.md` fell from 153,845 to 9,174 bytes and has stayed under its cap, but the text moved verbatim to `docs/architecture/`, which has since grown 21 KB |

## Findings

**The prompts grew five- to sixfold in the fleet era, and the growth collects at the gates.**
The table gives each template's *fixed* text: the prompt rendered for an empty ticket with no
description, parent, siblings or comments, at the last commit of each month.

| Month end | research | plan | plan-review | implementation | review | close-out | autopilot kickoff | meta-prompt |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Jan | 945 | 2,017 | – | 1,305 | 804 | – | – | 11,172 |
| May | 1,549 | 5,072 | – | 2,564 | 3,825 | – | – | 18,299 |
| Jun | 9,899 | 7,343 | – | 4,775 | 9,672 | 4,374 | 39,226 | 51,034 |
| Jul | 9,899 | 10,173 | 5,544 | 4,775 | 12,559 | 8,110 | 55,949 | 71,302 |
| Aug | 9,899 | 11,281 | 6,096 | 7,335 | 15,356 | 13,659 | 61,933 | 82,905 |
| Sep | 10,985 | 14,278 | 7,677 | 7,741 | 19,760 | 19,799 | 67,910 | 103,568 |

Bytes. Divide by four for tokens. The meta-prompt is the AI path. A model reads it to write a
worker's prompt, and the next finding shows that this path shapes five to seven prompts in ten. The six
handwritten templates of one pipeline pass now sum to 80,240 bytes, about 20,000 tokens. In May
the four that existed summed to 13,010; plan-review and close-out came later. Where the growth goes matters more than how much there is.
Research has barely moved since June, and the orchestrator kickoff is slowing: it gained
16.7 KB in July and 6 KB in each month since. Review plus close-out gained 6.6 KB in July,
8.3 KB in August and 10.5 KB in September. Measured from mid-month to mid-month instead, they
gained 9.5, 10.4 and 5.2 KB, so the month-end rise is not an acceleration. Most of September's
gain came in one week (LIN-3006, 3033 and 3056). The weight collects at the gates at a steady
rate.

**Most workers never see the handwritten templates. A model writes them a digest: usually a cheap
model reading the whole rulebook, sometimes the orchestrator itself.** We fetched the first
dispatch of each kind on every third ticket from LIN-2951 to LIN-3140. Of 112 dispatched worker
prompts, 102 were model-written; the handwritten template's long fixed lines were absent. Only 10
were the handwritten template, mostly triage, blocked and a few implementations. The dispatch rows
say who wrote the 102. The server wrote 61 from a recommendation. The orchestrator wrote 40 as
stepper beats, sent with a plain `POST /dispatch`, and at least 18 of those wrap a brief the
server wrote. Another caller wrote 1. So the meta-prompt path shaped between 61 and 79 of the
112, five to seven in ten. On that path, a cheap-tier model reads the 103,568-byte meta-prompt,
about 26,000 tokens, on every recommendation. It returns a task-specific prompt with a median size
of about 7 KB:

| Kind | Dispatches | Median bytes | Largest |
|---|--:|--:|--:|
| implementation | 24 | 7,239 | 15,000 |
| review | 24 | 7,195 | 19,708 |
| close-out | 23 | 5,649 | 8,465 |
| plan | 14 | 8,431 | 17,427 |
| research | 12 | 8,215 | 12,209 |
| plan-review | 8 | 6,890 | 9,543 |
| autopilot | 26 | 76,558 | 82,650 |
| wake | 28 | 435 | 626 |

So every rule is paid twice. It is paid in full, at cheap-tier prices, each time a prompt is
written, and again at frontier prices in whatever portion the digest keeps. At dispatch time, nothing
checks which rules the digest kept. The A/B eval for the review ledger exercises the
handwritten review prompt, by its own header (`scripts/eval-review-closeout.mjs`). That path
wrote 1 of the 24 review prompts sampled. The handwritten templates still matter: the
meta-prompt must mirror them and the tests pin them. But they are mostly not what a worker
reads. The meta-prompt is the largest single text behind what workers read, and it grew 5.7× from
May to September. The orchestrator's kickoff and handbook shape the rest. The review-ledger eval
covers neither.

**It is a ramp, then a steady slope.** In source bytes, the worker templates sat between 57 and
69 KB from February to the end of May. They reached 83 KB on 7 June, after eleven PRs in four
days, and 203 KB by 27 September. About 29% of that source growth is JS comments and 11% code.
The rendered table above counts prompt text only. June is when the autopilot fleet began. Every
curve in this paper bends there. The meta-prompt,
the AI path that writes prompts, rose in parallel, from 17 KB to 104 KB. From July to late
September the worker templates gained about 5 KB a week on average, in uneven steps. This is not exponential
compounding. It is a ratchet with a steady pull, and it is strongest on the review side.

**The gate rules are prose, and the close-out lineage shows the pattern.** For each ticket in
the lineage `docs/architecture/prompt-system.md` records, we took its own commits (id at the
head of the subject, or in the PR branch name) and measured what they changed:

| Ticket | Landed | Prompt text added | Runtime code changed |
|---|---|--:|---|
| LIN-550 | 2026-06-29 | 12,671 B | a `lib/workflow-config.js` constant nothing reads; the working registration is the new template entry |
| LIN-810 | 2026-06-29 | 1,060 B | none |
| LIN-811 | 2026-06-29 | 770 B | none |
| LIN-823 | 2026-06-30 | 1,360 B | none |
| LIN-1365 | 2026-07-16 | 1,349 B | string literals only (`lib/proxy-preamble.js`, `routes/proxy.js`) |
| LIN-1579 | 2026-07-26 | 7,377 B | none |
| LIN-2825 | 2026-09-12 | 6,488 B | none |
| LIN-3006 | 2026-09-24 | 4,412 B | none |
| LIN-3033 | 2026-09-25 | 7,793 B | none |
| LIN-3056 | 2026-09-26 | 1,050 B | none |

Ten tickets added 44 KB of prompt text. None added a check that fires at runtime, and nine of
the ten changed no runtime behaviour at all. Each touched
1–4 test files. The last four landed within 14 days of each other, and each of the last three
amends a rule an earlier one set. The architecture doc's summary of the lineage is now
a single paragraph of 1,371 words citing 16 tickets. The gate that everything else rests on is
"merge and Done need a recorded review Approve plus a discharged ledger". It is written in the
worker templates, the meta-prompt, the autopilot kickoff, the operating manual, the proxy
preamble and the proxy instructions. No code refuses a merge or a Done without it.
`lib/follow-on-ratio.js` parses the ledger heading, but only to measure afterwards. Two narrower
gates are enforced in code:
- **GitHub's `main-protection` ruleset.** It has refused any merge to LinearViewer's `main` without
  a passing `CI success` check since 10 June. It requires no approval, and simple-dispatcher has no
  such rule.
- **The periodical report gate.** The proxy answers 409 to a Done on periodical tasks that lack a
  persisted report and a recorded adversarial read (`lib/periodical-report-gate.js`, LIN-694).

That is the gate rules. Taken as a whole, the prompt text is mostly not incident prose. Of the
96 tickets cited anywhere in the prompt text at HEAD, 42 shipped runtime code in their own
commits and 29 changed prompt text only. For 24 we found no commit of their own, and one
changed only docs.
Most prompt text describes a capability that code provides, such as an endpoint, a flag or a
verb. Hypothesis 1 holds exactly where the fleet read says the cost is: review, close-out and
plan-review.

**Removal happens only by hand, and rarely sticks.** 221 commits on main changed the prompt text.
Counting word-level diffs, they added 690,429 bytes and removed 204,851. Most removals are
rewrites. Seventeen commits left the text smaller than they found it. Of 101 tickets ever cited
in the prompt text, five no longer are: LIN-310, LIN-412, LIN-750, LIN-874 and LIN-1240. Three
removals were deliberate and argued:

- **#462 (14 June)** cut the autopilot kickoff and handbook from 39,155 to 31,668 bytes (−19%).
  The reason was measured: abstract caution prose was 43% of the prompt and correlated with
  over-halting. Seven days later the kickoff was back at 38,643 bytes. Three weeks later it was
  72,812.
- **LIN-1270 (12 July)** reverted a grounding-freshness layer because it "never fires in practice",
  with "zero clean fired notes" as the evidence. This is the only retirement we found that was
  based on evidence that a rule never fired. It is the precedent for the proposal below.
- **LIN-1850 (3 August)** revised the passage-planner prompt to a validated v0.1 draft, cutting it
  from 19,204 to 9,405 bytes (−51%). It is the one large cut that stayed down: eight weeks later
  the prompt is 14,961 bytes. It was a rewrite, not a retirement on firing evidence.

Two things make removal harder than addition. First, the pins. The prompt test files carry 493
text-match assertions, up from 279 at the end of June, so deleting a sentence fails the suite.
Second, the two-path rule. "Changes to prompt behavior … must update BOTH" the handwritten
templates and the meta-prompt, so every prose rule is written twice and pinned twice. The
counter-example is in the same doc. LIN-435 moved four grounding rules into one shared post-pass
that both paths run, "so the meta-prompt no longer re-types these rules as prose and they cannot
drift". That is a rule turned into code, and the meta-prompt stopped carrying it.

**Code carries the same residue.** At the last commit of each month:

| Month end | Production lines | Test lines | Test : prod | Comment share | Comment lines citing a ticket | Comment lines citing a plan label | Pin-named test files |
|---|--:|--:|--:|--:|--:|--:|--:|
| May | 35,468 | 22,789 | 0.64 | 22.4% | 74 | 0 | 0 |
| Jun | 61,992 | 50,334 | 0.81 | 31.9% | 1,385 | 9 | 0 |
| Jul | 87,484 | 94,446 | 1.08 | 37.1% | 2,976 | 58 | 4 |
| Aug | 114,213 | 150,674 | 1.32 | 41.2% | 4,575 | 332 | 10 |
| Sep | 144,539 | 239,886 | 1.66 | 43.3% | 6,508 | 688 | 26 |

The month-on-month change shows what each month added. Net new production lines are steady,
at 25–30k a month since June. Net new test lines per production line rose each month: 1.04 in
June, 1.73, 2.10, then 2.94 in September. Before June it was 0.57–0.79. Comments were about a
fifth of net new production lines before June. Since June they have been 45–55%. Plan-label
citations are comment lines naming D7, F4, L2, N1 and similar. Before June there were none.
In September alone 356 were added. "Pin-named" is a crude filename match (census, inventory,
witness, allow-list, pin, parity). It still went from none to 26.

**The rule text is cheap for the worker. What it asks for is not.** We read the local
transcripts of the 330 dispatched legs whose transcript was last written between 24 September
and 20:00 UTC on 29 September. A block of text that enters a session is carried by every later
turn, so we credited it with its size times the number of turns left, and divided by all the
context the legs carried.

| Kind | Legs | Median turns | Dispatched prompt | Ticket reads | File reads | Other tool results | Prompt share, median leg |
|---|--:|--:|--:|--:|--:|--:|--:|
| plan | 107 | 42 | 2.1% | 2.5% | 19.6% | 3.7% | 2.0% |
| implementation | 69 | 96 | 1.2% | 1.8% | 19.4% | 4.1% | 1.6% |
| review | 36 | 38 | 2.1% | 0.6% | 23.1% | 5.3% | 2.0% |
| research | 26 | 63 | 1.6% | 0.5% | 24.3% | 5.2% | 1.9% |
| close-out | 22 | 38 | 2.5% | 0.8% | 16.6% | 5.3% | 2.2% |
| autopilot | 21 | 70 | 3.1% | 1.1% | 12.2% | 2.1% | 0.6% |
| plan-review | 12 | 44.5 | 1.5% | 0.8% | 26.8% | 5.2% | 1.9% |
| All 330 (incl. wakes, periodicals) | | | **1.6%** | 1.6% | 17.9% | 3.9% | **1.9%** |

The dispatched prompt is about 2% of the context a leg carries, whether pooled or for the median
leg. That covers the whole prompt: the digested rules, the proxy preamble and the ticket's own
content. The 26,000-token meta-prompt read is not in this table, because it happens on the
cheap-tier lane, one call per dispatch. Most of the rest is the harness's own system prompt and
tool definitions, and the model's own earlier turns. Some rule text arrives outside the prompt.
248 of the legs fetched the proxy's `/instructions` catalogue (0.57%), and `CLAUDE.md` reads add
0.65%. With both, rule-bearing text is 2.8% pooled and 3.4% for the median leg. Cutting all of
it in half would save at most about 1.5% of a worker's input tokens. The rule set's direct token
tax on the expensive models is real, but it is small.

The rules cost more through what they make agents do:

- **Loops.** Plan-review and review, with the re-passes they cause, are 38% of priced cost over
  the thirty days to 12 September (`review-loops.md`).
- **Post-PR rounds.** On LIN-3131, the rules turned test-only suggestions into two extra round
  trips: 26% of tokens and 43% of wall-clock, with zero production changes
  (`fleet-complexity-read.md`).
- **Writing.** Across the 89 Done tickets from LIN-2951 to LIN-3140, the median ticket carries
  10 comments and 6,063 comment words. Its median description is 715 words. A review comment
  runs a median 1,394 words in September (209 comments). It was 772 in July (50) and 1,796 in
  August (44). `writing-length.md` measured comment words per issue at 1,201 in June and
  4,332 in August. Descriptions are the one measure with no trend. Across every fifteenth
  ticket, the median was 497 words in June, 317 in July, 584 in August and 521 in September,
  which matches `writing-length.md`. What grew is the conversation, not the statement of the
  task. `review-consumption.md` found that half of a review's sentences are never consumed
  downstream. Ticket reads are only 1.6% of what the legs above carried, so the comments are
  written in full and read in part.

The gates do fire. In the same 89 tickets:

| Rule signature in the comments | Done tickets (of 89) |
|---|--:|
| inside/outside mark (LIN-2825) | 84 |
| review ledger (`What CI Did Not Prove`) | 78 |
| mutation check (LIN-2274) | 75 |
| class check or bounded classes (LIN-1871) | 66 |
| conditional Approve | 61 |
| Surface Assessment | 39 |
| Request Changes | 38 |
| named monitor or rollback lane (LIN-1579) | 23 |
| close-out hold or route back | 21 |
| Principle 0 (LIN-2202) | 10 |

A signature shows that a rule was exercised, not that it caught anything. The catches on record
come from the earlier papers. LIN-3124 PR3's review found about seven real credential bugs
that CI missed (`fleet-complexity-read.md`). Mutation checks exposed a suite that stayed "27 of
27 green" after the code was deleted (`efficiency-levers.md`). Of the seven genuine misses among
thirteen later-found bugs, none would have been caught by another review round
(`what-the-reviews-checked.md`).

**The one budget worked where it pointed.** LIN-2896 (18 September) cut `CLAUDE.md` from
153,845 bytes to 9,174 and added a test capping it at 110 lines and 12,000 bytes. Eleven days
later it is 9,806, still under the cap. The intra-session review had priced reading `CLAUDE.md`
at 5.0% of a day's spend when the file was about 100 KB. At a tenth of the size, that cost should
be roughly a tenth, a saving of about 4.5% of a day's spend. The text
was not removed, though. It moved verbatim into eight files under `docs/architecture/`, 147,422
bytes in all, and those files have since grown to 168,768. The budget test's own failure
message says what to do on overflow: "Move whatever pushed it over into a doc under
docs/architecture/". A budget reduces what every session pays. It does not reduce what the
system writes, unless the overflow has to go somewhere other than another document.

## The rule inventory

We read 320 rules, a rule being one directive a worker or orchestrator must follow. Five
sources were read in full: review, close-out, plan-review, implementation and the autopilot
kickoff, 213 rules and 78,046 bytes. Five more were sampled by taking every third rule in file
order: plan, research, the shared formatter sections, the passage-runner prompt and the
meta-prompt. Every rule is in `steady-base-rules.json` with its line, bytes, cited tickets,
enforcement, where else it is restated, a signature phrase and a class.
`node scripts/steady-base-rules-recompute.mjs` rebuilds the tables below from that file.

| Source (census) | Rules | Bytes | Runtime check | Pinned by a test | Prose only | Restated elsewhere |
|---|--:|--:|--:|--:|--:|--:|
| autopilot kickoff | 77 | 33,552 | 8 | 36 | 33 | 65 |
| review | 58 | 17,174 | 0 | 36 | 22 | 38 |
| close-out | 44 | 17,473 | 0 | 41 | 3 | 42 |
| implementation | 18 | 3,427 | 0 | 3 | 15 | 15 |
| plan-review | 16 | 6,420 | 0 | 15 | 1 | 15 |
| **All census** | **213** | **78,046** | **8** | **131** | **74** | **175** |

**No review or close-out rule is enforced by Harbour's code.** The eight rules with a runtime
check are all in the orchestrator's kickoff:

- the task and session budgets and the duplicate-dispatch refusal (`lib/dispatch-factory.js`);
- the proxy's 60-a-minute limiter (`routes/proxy.js`).

Across all 320 rules, three more are enforced: the meta-prompt's action-name parsing and one
passage-runner line on the same 409. Everything in review, close-out, plan-review and
implementation is prose in the repo's code. One close-out requirement is enforced outside it.
GitHub's ruleset refuses a merge to LinearViewer's `main` without green CI, which covers the CI
half of close-out's merge rules (lines 1143 and 1187). The column above does not credit it. Six
rules in ten carry a test, but the test pins the *text*. It checks
that the sentence is in the prompt, not that the agent obeyed it. Those pins are what keep a
sentence from being deleted.

**Most rules are said more than once.** 175 of the 213 census records name a restatement.
Of those, 21 name only the rule's own source, and 22 name only `docs/autopilot-kickoff.md`, a
keep-in-sync document for people that no agent is handed. That leaves 132 restated in another
prompt source: the meta-prompt, the autopilot kickoff, the operating manual, or the lane and
passage prompts. Close-out restates 34 of its 44 on that count. The records under-find as well.
The check's blind recode found a restatement for 40 of 45 sampled rules, most often in the
handbook the kickoff inlines, so four in five is still the better estimate
(`steady-base-check.md`). The two-path rule requires this, and it is what makes each rule
expensive to change.

**How the census classes:**

| Class | Census rules | What it means |
|---|--:|---|
| Keep as prose | 111 | Judgement no check can make, such as how to weigh a design risk |
| Convert to a code check | 55 | Mechanically checkable: a section present, a count, a bound, a status, a label, a diff size |
| Retire | 45 | 42 of the 60 across the whole inventory restate another rule in the same or a sibling prompt; the rest are superseded |
| Scope to a risk tier | 2 | Only two rules are specific to high-risk work at the rule level |

The last row is a finding in its own right. The fleet read's risk tiers are about *which legs
run*, not which sentences render. At the level of text, the gates are written as universal.
Tiering them means choosing which gates run, not trimming their prose.

**Review and close-out are the conversion candidates.** Fifteen of close-out's 44 rules are
mechanical:

- merge only after re-reading CI on the exact commit;
- never merge over an undischarged ledger item;
- the LIN-3033 authoring bound;
- a filed follow-up carries a priority and a type label;
- archive and prune only after merge, with the snapshot verified first.

Nine of review's are mechanical too. The five most expensive census rules are:

- an autopilot stand-by rule, 1,326 B;
- review's named-monitor rule, 1,144 B;
- plan-review's completeness check, 1,123 B;
- review's inside/outside marking, 1,095 B;
- the ledger itself, 1,031 B.

Three of the five come from the close-out lineage, and a fourth, plan-review's check, is
LIN-1871's class rule, which that lineage builds on.

**Removals the history does show.** The inventory's history walk found eight removals, none of
them a whole gate:

- LIN-550 folded review's inline close-out gate into the new close-out step;
- LIN-810 dropped a clause LIN-550 had added the same day;
- LIN-2917 struck "a routed follow-up ticket" from the accepted monitors;
- LIN-2311 dropped a priority clause;
- LIN-1206 reversed LIN-1071's session-closing rules;
- LIN-740 replaced sections LIN-697 had added a day earlier;
- LIN-435 moved the staleness check from meta-prompt prose into code;
- one commit trimmed implementation's scope and testing sections.

Each was a correction to a recent rule, a narrowing, or a move into code. Apart from the
LIN-1270 revert above, none retired a rule on evidence that it had stopped paying.

## A steady-base design

A steady base, as proposed here, has four properties:

- the rule text a dispatch pays for has a ceiling;
- a new rule either replaces one or arrives as code;
- every rule has a record of firing;
- the heavy gates appear only where the risk is.

The steps below are ordered by value per unit of risk. Each can be reverted, and each collects
the evidence for the next. The first three change no gate's behaviour.

1. **Freeze every template and briefing at today's size.** Add a byte-budget test modelled on
   `claude-md-line-budget.test.js`, set at the current rendered size:

   | Prompt | Budget (bytes) |
   |---|--:|
   | meta-prompt | 103,568 |
   | autopilot kickoff, with its handbook | 67,910 |
   | close-out | 19,799 |
   | review | 19,760 |
   | plan | 14,278 |
   | research | 10,985 |
   | implementation | 7,741 |
   | plan-review | 7,677 |

   The meta-prompt matters most, because it is what a cheap-tier model actually reads to write
   five to seven worker prompts in ten. The kickoff budget covers the orchestrator, which writes
   most of the rest. A new rule must displace text, or come with a raised number that John approves
   in the same PR. Unlike the `CLAUDE.md` cap, the overflow may not move into a doc the agent is
   told to read. It must go into code or be dropped. *Value:* it stops the ratchet, which last
   month added 20.7 KB to the meta-prompt and 10.5 KB to review and close-out, and it forces every
   other step. *Risk:* none to behaviour; some friction on rule changes. The token saving is small, so
   adopt this for its effect on how rules are written, not for tokens.

2. **Fix it in code first.** A change to a gate rule names the check that will fire, or says in one
   line why none can. The first candidates are the checkable parts of the close-out lineage:
   - the merge and Done gate, which today is prose in six places. The check would be a refusal of
     the Done transition at the proxy, and a required status check on the merge, since merges
     happen on GitHub and not through the proxy. Both have working precedents:
     - the `main-protection` ruleset already requires `CI success`;
     - the proxy already refuses Done on periodical tasks (`lib/periodical-report-gate.js`);
     - `lib/follow-on-ratio.js` already parses the ledger heading;
   - LIN-3033's authoring bound (at most 2 files and 3 hunks) as a diff-stat check;
   - the ledger's inside/outside mark and the misfire-guard line as a format parser;
   - plan-label and ticket citations in production comments as a lint (688 and 6,508 lines).

   Ship each as a warning for two weeks, then enforce it. *Value:* each rule is paid for once, and
   its prose shrinks to a line naming the check. *Risk:* moderate, because a wrong parser blocks
   real work. The warning period is the mitigation.

3. **Give every rule a provenance tag and a firing record.** In source, not in the rendered
   prompt, each rule carries its ticket and a signature phrase. A monthly script, the signature
   count in `steady-base-tracker.mjs` extended per rule, counts firings over the last 100 Done
   tickets and whether any firing changed production code. A rule that never fires in 100 tickets
   is demoted: moved out of the per-dispatch prompt into its reference doc, not deleted. A rule
   that fires but never changes code goes to John as a keep-or-retire ruling. LIN-1270 is the
   precedent. *Value:* the ratchet becomes a valve. *Risk:* low, since demotion is not deletion.
   The text pins have to move with the rule.

4. **Collapse an amendment chain once it reaches three links.** Restate the rule as it stands
   today, in one place, and move the history to `prompt-system.md`. The close-out lineage is
   the first candidate. Check with an eval run on the meta-prompt path before and after. The existing ledger eval
   runs on the handwritten path only.
   *Value:* shorter and clearer gate prose. *Risk:* a rewording can change behaviour, which the
   eval is there to catch.

5. **Choose which gates run by risk tier.** The inventory found the gate text written as
   universal: only 2 of 213 rules are specific to high-risk work. So tiering means choosing which
   legs run, not trimming sentences. The fleet read's three lanes:
   - **Tier 0:** one implementation leg and CI.
   - **Tier 1:** one review.
   - **Tier 2:** today's full process, for credentials, auth, data migration and external contracts.

   Default to Tier 1, not 0. Grant Tier 0 by a path check in code, not by a label an agent
   chooses. This is the fleet read's first simplification and by far the largest, but it saves
   by running fewer legs, not by shortening prompts. *Risk:* the highest here, because a mis-tiered ticket skips a
   check. That is why it comes after the firing record exists.

6. **Retire the global census pins** in favour of an import-graph lint, and keep the behavioural
   tests (`fleet-complexity-read.md` §5).

**Protected in every step:**

- the review gate on Tier 2 work, which found about seven credential bugs on LIN-3124 PR3 that CI
  missed;
- the three LIN-550 floors: a missing ledger blocks, green CI never discharges an item, and an
  empty ledger passes through;
- the reviewer-side mutation check, wherever a review runs;
- plan-review's first passes on Tier 2 designs, where pass 4 found a real double-copy bug;
- the refusal licence: 5 refusals, 0 faked closes, 2 prevented regressions.

**Adopt first: step 1, then the Done refusal from step 2.** The budget costs nothing to run
and changes how every later rule gets written. The Done refusal at the proxy is the smallest
code change that retires the most-restated prose rule. The matching merge check is the second
half, and it is harder, because it has to read the tracker from GitHub.

## Method

All numbers were measured at `8f5fe4aa` (origin/main, 2026-09-29). Each non-trivial measure is
a committed script with a one-line header. "Prompt text" means the worker templates
(`lib/prompt-templates.js`, `-defs.js`, `-formatters.js`), the meta-prompt, the autopilot kickoff
and handbook, and the lane, passage and runner prompts. Groups are defined once, in
`scripts/steady-base-growth.mjs`.

```sh
node scripts/steady-base-render.mjs                   # run in a checkout of 8f5fe4aa: fixed rendered size per kind, incl. the meta-prompt
node scripts/steady-base-render-history.mjs 8f5fe4aa  # the same at each month end (throwaway worktrees)
node scripts/steady-base-growth.mjs 8f5fe4aa          # source bytes, cited tickets, imperatives per ISO week
node scripts/steady-base-churn.mjs 8f5fe4aa           # bytes added/removed per commit; citations that left
node scripts/steady-base-provenance.mjs 8f5fe4aa      # what each cited ticket's own commits changed (v2: each landing commit counted once)
node scripts/steady-base-provenance.mjs 8f5fe4aa --tickets LIN-550,LIN-810,LIN-811,LIN-823,LIN-1365,LIN-1579,LIN-2825,LIN-3006,LIN-3033,LIN-3056
node scripts/steady-base-code.mjs 8f5fe4aa            # production/test lines, comments, citations, pin files per month
node scripts/steady-base-carry.mjs --since 2026-09-24 --until 2026-09-29T20:00:00Z   # needs this machine's ~/.claude/projects
node scripts/steady-base-tracker.mjs fetch cache.json   # ~25 min over the local proxy, paced under 60/min
node scripts/steady-base-tracker.mjs report cache.json  # descriptions, comments, dispatched prompts and their path, rule signatures
node scripts/steady-base-rules-recompute.mjs            # the inventory tables, from steady-base-rules.json
# text-match assertions in the prompt test files, at a month-end sha:
for f in $(git ls-tree -r --name-only $SHA tests/unit | grep -E "prompt-templates|autopilot-kickoff|meta-prompt|worker-lane-kickoff|passage-runner|prompt-formatters|close-out|review-closeout|completion-signals"); do
  git show $SHA:$f | grep -cE "assert\.(match|doesNotMatch)|\.includes\("; done | paste -sd+ - | bc
# the CLAUDE.md split: sizes either side of d4f749c1
git cat-file -s d4f749c1^1:CLAUDE.md; git ls-tree -r -l d4f749c1 docs/architecture | awk '{s+=$4} END {print s}'
```

The rule inventory was built by reading. Its sampling is stated with it.

## Limits

- **Fixed size is a floor.** The rendered sizes use an empty ticket. Real prompts add the ticket
  and its context, and some sections appear only under flags the mock does not set.
- **Carry covers the input side only.** It prices tokens, not dollars, and covers five days on
  one machine. It also misses what a rule costs by changing behaviour, which is the larger cost
  and is only borrowed here from earlier papers.
- **The inventory is one reading.** One reader built it, from the source, in one session, and it
  was spot-checked, not double-coded. Its classes are judgements, and "convert to code" in
  particular is a claim that a check *could* be written, not a design for one.
- **The path split is a heuristic.** A dispatched prompt counts as handwritten when at least 30% of
  its template's long fixed lines appear in it verbatim. The split was 102 to 10. The nearest
  scores either side of the line were 0.21 and 0.50. Model-written prompts share a few appended
  sections with the templates, which is why their score is not zero.
- **Signatures show use, not catches.** A regex match shows a rule was exercised. "Request
  Changes" also matches plans quoting the rule.
- **Provenance depends on commit naming.** A ticket whose commits do not lead with its id counts as
  unattributed (24 of 96), and a runtime file a ticket touched may not be the rule's check.
- **Pins are counted crudely.** They are counted by filename and by assertion shape, not read.
- **The code measures are net lines.** A month that deletes as much as it writes shows as flat.
- **Checked once.** `steady-base-check.md` (LIN-3145) re-ran every measure and recoded a sample of
  the inventory blind. It found the errors this version corrects. Its disagreements of judgement
  are there, not here. The biggest is that the recode would retire more than twice as many rules.
- **No counterfactual.** Nothing here shows the fleet would be as reliable with fewer rules. The
  proposal is built so that each step can be undone on the evidence it collects.

## Next

Run the evidence review in step 3 of the proposal once, by hand, on the review and close-out
templates. For each rule, find its signature in the comments of the last 100 Done tickets and
record whether any of those uses changed a line of production code. That table would say which
rules have paid for their place, which is the question this paper could only half answer.
