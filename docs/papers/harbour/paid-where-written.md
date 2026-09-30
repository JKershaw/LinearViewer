---
title: Every Fix Is Paid Where It Is Written
kind: essay
argument: A fix written into code is paid once, but a fix written into a prompt, a rule or a review ledger is paid on every run by every agent that reads it and does what it asks, so a system that answers each incident with another paragraph of instructions ratchets upward even when every patch is reasonable — and the way out is a steady base, deep where rigour has earned its keep and lean everywhere else, held there by budgets and by rules that must keep proving they catch something.
version: 2
date: 2026-09-30
authors: [Claude (version 1, LIN-3144), Claude (version 2, source corrections, LIN-3146)]
model: "Version 1: frontier tier, Claude Code CLI; effort not recorded in the dispatch item. One bounded writing session (dispatch afe16c11, kind custom, LIN-3144) with no research, plan, review or close-out legs, by the brief's design. Commissioned by John Kershaw on 29 September 2026. Version 2: frontier tier, Claude Code CLI; effort not recorded in the dispatch item. The independent check's session (dispatch 65867df7, kind custom, LIN-3146), acting as a named co-author under standard.md rule 2."
revision: "Version 2 carries the corrected figures of steady-base.md version 2 (LIN-3145) and fixes readings that went past their source, per paid-where-written-check.md version 2 (LIN-3146): the close-out lineage's bytes, who writes the model-written prompts, the token ceiling, the gates enforced at runtime, the restatement count, the deliberate cuts, the paper's checked status, the displacement next door, the NAO and Texas figures, Cunningham's wording, the LIN-1270 layer, the loop and round readings and the mutation check's origin. The argument is unchanged. The check's findings on the argument are for John and are not written in here."
sources:
  - "docs/papers/harbour/steady-base.md@6574f6023d7c84ab74bfa6d32c0b5d1af1e7241a (version 2)"
  - "docs/papers/harbour/steady-base-check.md@6574f6023d7c84ab74bfa6d32c0b5d1af1e7241a (LIN-3145)"
  - "docs/papers/harbour/steady-base-rules.json@6574f6023d7c84ab74bfa6d32c0b5d1af1e7241a"
  - "docs/papers/harbour/fleet-complexity-read.md@6574f6023d7c84ab74bfa6d32c0b5d1af1e7241a"
  - "docs/papers/harbour/review-loops.md@6574f6023d7c84ab74bfa6d32c0b5d1af1e7241a"
  - "docs/papers/harbour/review-consumption.md@6574f6023d7c84ab74bfa6d32c0b5d1af1e7241a"
  - "docs/papers/harbour/what-the-reviews-checked.md@6574f6023d7c84ab74bfa6d32c0b5d1af1e7241a"
  - "docs/papers/harbour/efficiency-levers.md@6574f6023d7c84ab74bfa6d32c0b5d1af1e7241a:48"
  - "docs/reviews/lane-run-review-2026-08-23.md@6574f6023d7c84ab74bfa6d32c0b5d1af1e7241a:558-561"
  - "tests/unit/claude-md-line-budget.test.js@6574f6023d7c84ab74bfa6d32c0b5d1af1e7241a:28-53"
  - "35dc0e14 (LIN-1270, the revert of a layer that never fired, 2026-07-12)"
  - "LIN-3143 closing comment (2026-09-29); PRs #1625 and #1626 (no reviews recorded)"
  - "Cunningham, The WyCash Portfolio Management System, OOPSLA '92 experience report — https://c2.com/doc/oopsla92.html (read 2026-09-30)"
  - "Texas Sunset Advisory Commission — https://www.sunset.texas.gov/ and https://www.sunset.texas.gov/how-sunset-works/impact-sunset-reviews (read 2026-09-30)"
  - "National Audit Office, The Business Impact Target: cutting the cost of regulation, HC 236, 29 June 2016 — https://www.nao.org.uk/wp-content/uploads/2016/06/The-Business-Impact-Target-cutting-the-cost-of-regulation.pdf (full report read 2026-09-30)"
---

# Every Fix Is Paid Where It Is Written

*Patches on patches, and a steady base*

Prepared for John Kershaw | September 2026

Every fix has a price, and where the fix is written decides who pays that price and how
often. A fix written into code is paid once: someone writes the check, and from then on it
fires by itself. A fix written into a prompt, a rule or a review ledger is paid on every run,
by every agent that reads it and does what it asks, for as long as it stays written. A system
that answers each incident with one more paragraph of instructions therefore climbs. Each
patch is reasonable and each one is small, but together they add up to longer prompts, longer
tickets and heavier review, and nothing in the system brings them back down. The alternative
is not less care. It is a *steady base*: deep rigour in the few places where it has earned
its keep, a lean base everywhere else, and two things holding it there: budgets, and rules
that have to keep proving they catch something.

This essay makes that argument from one system's record. The system is young, and the
evidence is uneven. The last section says what the evidence does not show.

## 1 A fleet that writes down its lessons

Harbour is a small software project run largely by AI coding agents. Its tickets live in an
ordinary issue tracker. An always-on orchestrating agent picks them up and sends each one
through a pipeline of short agent sessions: research, a plan, a review of the plan,
implementation, a code review and a close-out that merges the work. Each session is started
with a prompt built from a template, and the templates are where the project's rules live:
what a plan must contain, what a review must check, when a close-out may merge. One person,
John Kershaw, owns the project and rules on what the agents cannot settle.

This setup has one property that matters here: every lesson can be written down. When
something goes wrong, the quickest durable fix is a sentence in the template, and it is
usually a reasonable sentence. The next agent reads it and doesn't make the same mistake.
There is no training cycle to wait for and no team to persuade, and nobody has to remember
it. For a system made of agents that read their instructions afresh on every run, adding a
rule is the obvious way to learn.

It is also a way to take on debt without noticing. Ward Cunningham's original description of
technical debt was about code: "Shipping first time code is like going into debt." A little
debt speeds development "so long as it is paid back promptly with a rewrite", and "every
minute spent on not-quite-right code counts as interest on that debt"
[[1]](#1-the-debt-metaphor). Prose rules can become the same loan left unpaid. The rule is
written once, but the interest is paid on every run, and nothing in the system schedules the
rewrite.

## 2 Paid once, paid forever

Harbour's June-to-September record, measured in the paper this essay accompanies
[[2]](#2-the-steady-base-paper), shows what that looks like in practice.

The gate rules — the ones that decide whether work is good enough to merge — are almost all
prose. Take the close-out step. The rules governing it grew over ten tickets between late
June and late September. Together those tickets added 44 KB of prompt text, and eight of the
ten changed no runtime code at all; a ninth changed only string literals. None added a check
that fires on its own. The last four landed within fourteen days of each other, and each of the last three amends a rule an
earlier one set. The central gate of the whole pipeline, that merging or closing a ticket
needs a recorded review approval and a discharged ledger of open items, is written out in
six places: the worker templates, the model-facing guide to writing prompts, the
orchestrator's briefing, the operating manual, the preamble that is added to every dispatch,
and the proxy's instructions. No code reads the approval or the ledger before a merge or a
closure. Two narrower gates do run by themselves: since 10 June GitHub has refused any merge
to the main branch without green CI, and the proxy refuses to close one kind of task, a
periodical report, that lacks its evidence. [[2]](#2-the-steady-base-paper)

The paper also counted the rules. Of the 213 rules read in full, in the templates for
review, close-out, plan review, implementation and the orchestrator's briefing, eight are
enforced by a runtime check, and all eight are in the orchestrator's briefing. Nothing in
review, close-out, plan review or implementation is enforced by Harbour's code; GitHub's
green-CI rule covers only the CI half of close-out's merge rules. About six rules in ten
carry a test, but the test checks that the *sentence* is present in the prompt, not that any
agent obeyed it. And about four rules in five are said more than once, somewhere else.
[[2]](#2-the-steady-base-paper) [[3]](#3-the-rule-inventory)

That is what "paid on every run" means. But the payment is not where one might first look.

## 3 The bill is behaviour, not tokens

The obvious cost of a long prompt is the tokens it takes up. In Harbour the obvious cost is
real, but it is small, and in an odd place. Most worker prompts in the pipeline are not the
handwritten templates at all. Of the 112 dispatched prompts the paper sampled, a model wrote
102. Usually that model is a cheap-tier one, which reads a single guide to writing prompts and
then writes the worker's prompt: it wrote 61 outright. The orchestrator wrote 40 more itself,
and at least 18 of those wrap a brief the cheap model wrote, so the guide shapes five to seven
prompts in ten. That guide is 103,568 bytes, about 26,000 tokens, and the cheap model reads all
of it every time. The worker receives a digest with a median size of about 7 KB. Measured
against everything a working session carries across its turns, the dispatched prompt is about
2%. Counting the rule text that reaches a worker by other routes, the proxy's instructions and
the standing instructions file, rule-bearing text is about 3%. So cutting all of it in half
would save a frontier-tier worker at most about 1.5% of its input.
[[2]](#2-the-steady-base-paper)

The rules cost through what they make agents do.

- **Loops.** In the thirty days to 12 September, the two review gates took 30% of the priced
  money spent on sessions, and the extra passes they sent work back for took another 9%.
  Plan review approved a plan first time in 11 of 94 cases. Of the eight send-backs the study
  read closely, half asked for a member missing from a list the plan had already built and
  the rest for a reconciliation, a missed case or a re-derived claim. None asked for a
  different design. The study itself cannot say whether the loops are worth it: a gate that
  finds a real missing member each time may be the cheapest step in the pipeline.
  [[4]](#4-review-loops)
- **Rounds that change nothing.** On one mid-sized feature, the rules turned a reviewer's
  test-only suggestions into two extra round trips. The second was sent back because a
  planted mutation survived: one authority check had no test. Those rounds took 43% of the
  ticket's wall-clock time and about 26% of its tokens, and changed no production code.
  [[5]](#5-the-fleet-complexity-read)
- **Writing that is not read.** Of 89 recently finished tickets, the median carries ten comments and
  about six thousand words of them. What grew is the conversation, not the statement of the
  task: median descriptions showed no trend from June to September. [[2]](#2-the-steady-base-paper)
  When a separate study followed review text into the close-out that consumes it, it found
  48% of a review's sentences were used. The ledger of open items was used almost completely,
  and the narration of how the reviewer checked things only a quarter of the time.
  [[6]](#6-review-consumption)
- **Pins.** The prompt tests carried 493 assertions matching text by late September, up from
  279 at the end of June. Deleting a pinned sentence fails the suite.
  [[2]](#2-the-steady-base-paper)

A rule's words are cheap. The work it asks for is expensive: every round, ledger, table and
pin it calls for, done again on every ticket it touches, whether or not that ticket has the
problem the rule was written for.

## 4 How reasonable patches become a ratchet

Nothing here requires a bad decision. The ratchet comes from an asymmetry in who pays.

The person, or agent, who adds a rule pays once and sees the benefit at once: the incident
that prompted it will not recur. Everyone downstream pays afterwards, a little at a time, in
places the author never sees. So adding a rule is cheap for the one who adds it and costly
for everyone after, and removing one is the reverse. Whoever removes a rule takes on the
risk that the old incident comes back and gets almost nothing they can point to. The savings
are spread across future runs, while the risk lands on them.

Harbour's record shows the asymmetry working. Of 221 commits on the main branch that changed
the prompt text, seventeen left it smaller. Of the 101 tickets ever cited in that text, five
no longer are. Two large deliberate cuts were measured and argued. In mid-June, a change
removed 19% of the orchestrator's briefing, because abstract caution prose made up 43% of it
and correlated with the orchestrator stopping when it did not need to. The briefing was back
to 38,643 bytes, nearly its old size, seven days later, and three weeks after that it stood at
72,812. In August a rewrite halved the prompt that plans a passage of work, and that cut has
held: eight weeks later the prompt is still 22% below its old size.
[[2]](#2-the-steady-base-paper)

Three things in the system make removal harder than addition, and each was reasonable on its
own terms. The text-matching tests make a deletion fail the suite. A standing rule requires
every prompt change to be made in two places, the handwritten templates and the
model-facing guide, so every prose rule is written twice and pinned twice. And because most
rules are restated elsewhere, deleting one copy leaves the others in force, and deleting all
of them means finding them first. [[2]](#2-the-steady-base-paper)
[[3]](#3-the-rule-inventory)

The ratchet has also reached the code. Comments made up about a fifth of net new production
lines before June and 45–55% since. Comment lines citing a plan's internal labels, such as
"D7" or "N1", went from none to 688. Each new production line now arrives with nearly three
lines of test, up from about one in June. [[2]](#2-the-steady-base-paper) A comment that explains *why*
the code is shaped the way it is does useful work. A comment that cites a label from a plan
the reader cannot see is prose, and every reader of the file pays for it.

## 5 One person with one agent

John's comparison point is himself, driving a single agent with his full concentration for
about two hours. Against that, the fleet is thorough, consistent and always on. It does not
get tired, skip the review on a Friday or forget last month's incident. It works. But its
cost trends upward, and it does not settle.

An independent read of three landed tickets puts numbers on both sides
[[5]](#5-the-fleet-complexity-read). The smallest was an eight-line change that did nothing
at runtime. It took 41 queue items and an hour, and both reviews changed nothing. The reader
estimated John and one agent would have shipped it in ten to twenty minutes. The largest was
a cutover of how the system reads and refreshes credentials for three external services. There, review
found about seven real bugs that the automated tests had missed, including one that deleted
a healthy credential and one that spent a single-use refresh token twice. John alone would
probably have shipped some of those and found them in production days later.

So the comparison is not between rigour and carelessness. When John drives one agent, he
decides where to look. He looks hard at the credential cutover and barely at the eight lines.
The fleet applies the same depth to both. The rule inventory found only 2 of 213 rules
specific to high-risk work at the level of the text. The gates are written as universal.
[[3]](#3-the-rule-inventory) Two hours of concentration go where the risk is. The fleet
spends evenly across everything, and more of it each month.

## 6 A steady base

A steady base is the fleet's thoroughness kept where it is paying and taken away where it is
not. The paper proposes four properties for it [[2]](#2-the-steady-base-paper): the rule
text each run pays for has a ceiling; a new rule either replaces an old one or arrives as
code; every rule keeps a record of firing; and the heavy gates appear only where the risk
is. Each is conservative, and each can be reverted on the evidence it collects.

**Deep where rigour has earned its keep.** Credentials, authentication, data migrations and
external contracts keep today's full process. The credential cutover is where review found
real bugs that tests missed. Those gates stay whole. So does the mutation check at review,
which reviewers first ran on their own initiative and which exposed a test suite that stayed
"27 of 27 green" after the code it tested was deleted [[7]](#7-the-levers-inventory), and so
does the rule that green tests never discharge an open ledger item. Rigour here is not a cost to
cut. The steady base exists to protect it.

**Lean everywhere else, and lean by choice of gate, not by trimming.** Since the gate text is
written as universal, making it lighter means deciding which gates run for which work, not
editing sentences. The fleet read's proposal is three tiers: one implementation session and
automated tests for inert or tiny changes, one review for normal work, and today's full
process for the high-risk kinds above. [[5]](#5-the-fleet-complexity-read) Another review
round is also not the cheap insurance it looks like. Of seven genuine misses among thirteen bugs
later found in Harbour's reviewed tickets, a separate study concluded that not one would have been
caught by one more round. What would have caught them was cheaper: a five-minute check on a
real host, a finished search, a single page load, one reader for the close-out.
[[8]](#8-what-the-reviews-checked)

**Held there by budgets.** Harbour has run one budget, and it worked on what it capped. A test
fixed the agents' standing instructions file at 110 lines and 12,000 bytes. The file fell
from 153,845 bytes to 9,174 and has stayed under the cap. But the budget test's own failure
message says what to do on overflow: "Move whatever pushed it over into a doc under
docs/architecture/". The text went there word for word, and those documents have grown by
about 21 KB since, though only about a third of that growth came in changes that also edited
the capped file. [[2]](#2-the-steady-base-paper) [[9]](#9-the-standing-budget) Britain's
national auditor found a related problem in a government-wide regulatory budget. The target
counted only some costs. In the first year of that Parliament, the net costs expected from
decisions outside its scope, £8.3 billion, "greatly exceed" the £0.9 billion net reduction
claimed inside it, and the auditor judged the scope "open to manipulation"
[[10]](#10-a-regulatory-budget). It did not find cost moving out of scope to escape the count:
the largest exclusions were decided for reasons of their own. What it does show is that a
budget stops seeing whatever it does not count. So a prompt budget has to say where overflow
may go, and the only safe answers are into code or out of the system. Another document the
agent is told to read does not qualify.

**Held there by rules that must keep proving they catch something.** A rule stays in place
until someone takes it out, and nobody gets credit for taking one out. Texas turned that
default around in 1977: an agency under review is abolished on a set date "unless the
Legislature passes a bill to continue it". By the commission's own count, that has abolished
42 agencies and programs and consolidated 54, across 603 reviews; most reviews end in the
agency continuing with changes [[11]](#11-sunset-review). Harbour has one precedent of its
own, and it was code rather than prose. In July a layer of code that skipped re-grounding when
the grounding was already fresh was reverted because it "never fires in practice", with "zero
clean fired notes" as the evidence [[12]](#12-the-one-evidence-based-retirement). The paper
found no other rule retired on evidence that it had stopped paying. The steady-base
version is modest: record when each rule fires, and move a rule that has not fired in a
hundred tickets out of the per-run prompt into reference, without deleting it.
[[2]](#2-the-steady-base-paper)

**Fix it in code first.** Many gate rules are mechanical. The inventory classes 55 of the 213
as checks that could be written in code: a section is present, a count is within bounds, a
diff is under a size. The classes are one reader's judgement, and an independent recode
matched them for only 25 of 45 sampled rules. [[3]](#3-the-rule-inventory) The merge-and-closure gate is the clearest
case. Its prose is copied into six places, and a refusal at the one door where tickets are
closed would replace every copy with a line naming the check. That door already refuses to
close periodical reports that lack their evidence. Harbour has also moved prose into code:
four grounding rules moved from prose into a shared step that both prompt paths run, so the
guide "no longer re-types these rules as prose and they cannot drift".
[[2]](#2-the-steady-base-paper)

Code is not free. Checks that parse free text can be wrong, and a wrong check blocks real
work, which is why the paper proposes running each as a warning before enforcing it. Code
also carries its own residue, as section 4 showed. But a code check has one property no
sentence has: it fires by itself, and the record of its firing is evidence that it earns its
place. A prose rule only runs when an agent remembers it, and nothing records whether it
helped.

The steady base also asks something of the people who own the system. The same record that
shows a rule is working shows when it is not. A rule should stay because it keeps catching
things, not because it was once added for a good reason.

## 7 What the evidence does not show

The argument has a strong form and a weak one, and the evidence supports only the weak one.

It supports this much. In one system, over four months, the rule text at the gates and the guide
that writes most prompts grew roughly four- to sixfold, at a steady rate rather than a rising
one. Almost no rule was ever retired, and the review approval and ledger that decide whether
work merges are written only as prose; the one merge rule enforced at runtime is GitHub's
green-CI check. It also supports the claim that the rules cost mainly through the behaviour
they require, not through their tokens.

It does not show that the fleet would be as reliable with fewer rules. Nothing in the record
is a counterfactual. [[2]](#2-the-steady-base-paper) It does not show that a rule
which fires is catching anything. The paper counted rules being exercised, and a signature in
a comment is not a bug prevented. Most of it also comes from one paper, which has had one
independent check. That check upheld its headline and corrected six of its figures, which this
version carries. Its blind recode of the rule inventory matched the enforcement labels for 42
of 45 rules but the classes for only 25. [[2]](#2-the-steady-base-paper) Four months is short. June was when the
autonomous fleet began and every curve bends there, so some of the growth may be a young
system finding its footing and could flatten by itself. And not all prompt text is incident
prose: of the 96 tickets cited in it, 42 shipped real code, and most of the text describes
capabilities the code provides. [[2]](#2-the-steady-base-paper)

The essay's own claim could be wrong in a way anyone can observe. Suppose Harbour adopted
a prompt budget, moved its mechanical gates into code and began retiring rules that never
fire. The argument predicts that reliability would hold, measured by bugs found after merge,
and that cost per ticket would stop climbing. If bugs found after merge rose on the tiers that
lost gates, then some of the prose was paying for itself in ways the firing record could not
see, and a leaner base was the wrong base.

One more thing is worth saying plainly. The paper behind this essay, and this essay, were
both written in single sessions that skipped the review gate by the brief's design, and both
were merged on green CI alone [[13]](#13-the-papers-own-merge). GitHub required the green CI.
The rule that merging needs a recorded review approval is in the preamble added to every
dispatch, this one included. The brief overrode it in prose, and nothing in the system noticed
the missing approval. That is not a scandal. It is how a prose rule
works: it is enforced by whichever reader is most persuaded at the moment.

## Annotated reading list

This is an argued essay from one system's record, not a study. The Harbour sources are
measurements of that system; the three outside sources come from other fields and supply
mechanisms to consider, not estimates of their size here.

### 1 The debt metaphor

Cunningham, W. *The WyCash Portfolio Management System.* OOPSLA '92 experience report, 1992.

The origin of "technical debt": shipping first-time code is borrowing, repaid "promptly with a
rewrite", and the time lost to code that is not yet right is interest. It supports the essay's
framing of recurring cost. It does not support debt as a bad thing in itself: for Cunningham
"a little debt speeds development", and the danger is only the debt left unpaid. It is about
code, not about instructions to agents. The extension to prose rules is this essay's.

[Read the source](https://c2.com/doc/oopsla92.html)

### 2 The steady-base paper

Harbour. *Patches on patches — does Harbour converge to a steady base, or only grow?*
`docs/papers/harbour/steady-base.md`, version 2, 30 September 2026 (LIN-3143, corrected per
its independent check, `steady-base-check.md`, LIN-3145).

The evidence behind most of this essay: the template growth curves, the model-written prompt
split, the close-out lineage, the removal record, the code residue, the context-carry measure,
the one standing budget and the six-step proposal. It supports the growth and the mechanism.
It does not measure reliability against a counterfactual. Its own limits note that its
inventory is one reader's and that its cost measure covers five days on one machine. Its check
re-ran every measure, corrected six figures and disagreed with the inventory's class for 20
of the 45 rules it recoded.

[steady-base.md](steady-base.md) · [steady-base-check.md](steady-base-check.md)

### 3 The rule inventory

Harbour. `docs/papers/harbour/steady-base-rules.json`, with the paper's recompute script.

320 rules, each with its enforcement, restatements, citations and a class. It supports the
counts of prose-only gates, restatements and rules that could become code. The classes are
judgements: "convert to code" says a check *could* be written, not that it has been designed.
A blind recode of 45 rules agreed with the enforcement labels 42 times and with the classes 25
times (`steady-base-check.md`).

[steady-base-rules.json](steady-base-rules.json)

### 4 Review loops

Harbour. *Why does a plan go round plan-review more than once?* `review-loops.md`, version 2,
12 September 2026.

The cost of the gates and the extra passes they cause, and what a send-back actually asks for.
It supports the loop costs. By its own limits, it cannot say whether the loops are worth it.

[review-loops.md](review-loops.md)

### 5 The fleet complexity read

Harbour. *Is the fleet overcomplicated? A read of three landed tickets.*
`fleet-complexity-read.md`, 29 September 2026.

An independent auditor's read of three tickets, with the comparison against the owner driving
one agent. It supports both the waste on small work and the value of review on the credential
cutover. It is three tickets, and the "one agent" estimates are the auditor's judgement, not
measurements.

[fleet-complexity-read.md](fleet-complexity-read.md)

### 6 Review consumption

Harbour. *Which of a review's sentences does the close-out actually cite, discharge or act on?*
`review-consumption.md`, version 2, 18 September 2026.

Ten reviews, followed sentence by sentence into their close-outs. It supports "written in
full, read in part". It measures consumption by one downstream step, not whether the unread
text made the review better.

[review-consumption.md](review-consumption.md)

### 7 The levers inventory

Harbour. *What levers to make a task faster or cheaper are already written down?*
`efficiency-levers.md`.

The source of the mutation-check example. It supports the claim that the check has caught a
suite that proved nothing. The example is one ticket, and the catch came before the rule: the
lane review that the lever cites found reviewers had run mutation checks "unprompted", and the
check was written into the review template afterwards (LIN-2274).

[efficiency-levers.md](efficiency-levers.md) ·
[lane-run-review-2026-08-23.md](../../reviews/lane-run-review-2026-08-23.md)

### 8 What the reviews checked

Harbour. *What did the reviews behind the thirteen later-found misses check, and what would
have caught each one?* `what-the-reviews-checked.md`, version 1, 18 September 2026.

It supports the claim that one more review round would not have caught the genuine misses,
and that cheaper checks would have. One of those checks is a reader for the close-out, so the
cheaper fix is sometimes more review of a different kind. It covers thirteen bugs.

[what-the-reviews-checked.md](what-the-reviews-checked.md)

### 9 The standing budget

Harbour. `tests/unit/claude-md-line-budget.test.js`.

The one enforced budget: 110 lines, 12,000 bytes, and a failure message that sends overflow
into `docs/architecture/`. It supports the quoted message and the cap. The size history is
the paper's.

[claude-md-line-budget.test.js](../../../tests/unit/claude-md-line-budget.test.js)

### 10 A regulatory budget

National Audit Office. *The Business Impact Target: cutting the cost of regulation.* HC 236,
29 June 2016.

The United Kingdom's auditor on a government-wide target for cutting the cost of regulation to
business. It found that, in the Parliament's first year, net costs expected from decisions
outside the target's scope far exceeded the net reduction claimed inside it (summary paragraph
8, paragraph 2.6), that the scope was "open to manipulation" (paragraph 16), and that the
government did not know the total cost of its existing regulation (paragraph 6). It supports
the claim that a budget stops seeing what it does not count. It does not show cost moving out
of scope to escape the count: the largest exclusions, such as the National Living Wage, were
ministers' decisions for reasons of their own. It comes from another field and is not evidence
about software or agents.

[Read the source](https://www.nao.org.uk/wp-content/uploads/2016/06/The-Business-Impact-Target-cutting-the-cost-of-regulation.pdf)

### 11 Sunset review

Texas Sunset Advisory Commission. Home page, "How Sunset works" and "Sunset's Impact Since
1977".

A standing mechanism that makes an institution justify itself again or end, in place since
1977; Colorado had one a year earlier. The counts of agencies and programs abolished (42) and
consolidated (54), and of reviews (603), are the commission's own; the home page still gives
591 reviews. By those counts most reviews continue the agency, usually with changes. The essay
borrows the default, not the outcomes. Whether the reviews made Texas's government better is
beyond what these pages show.

[Read the source](https://www.sunset.texas.gov/how-sunset-works/impact-sunset-reviews)

### 12 The one evidence-based retirement

Harbour. Commit `35dc0e14`, "LIN-1270: revert the inert grounding-freshness / HEAD-report
layer", 12 July 2026.

The commit message's own words: the layer "never fires in practice", with "zero clean fired
notes" as the evidence. It supports the precedent. It is one case, and it retired code that
saved re-grounding work, not a prose rule written after an incident: its firing was logged by
construction, which a prose rule's is not.

### 13 The paper's own merge

LIN-3143, closing comment, 29 September 2026.

It records that the paper was merged on green CI in one bounded session with no review leg,
and that there is therefore no recorded review approval. GitHub shows no review on either PR
(#1625, #1626). It supports the last paragraph of section 7.

## Next

One line goes to `proposals.md` with this essay. If Harbour adopts the paper's first step, a
byte budget on every template, does the growth move next door, as part of it did with the
standing budget? The test is to measure, for eight weeks either
side of the budget, the size of every document an agent is told to read and the prose added
to production comments. If they grow faster once the templates are frozen, the budget moved
the cost without cutting it.

The paper's own Next, a hand-built firing record for the review and close-out rules, is
already in `proposals.md`. It is also the test this essay most depends on. If the rules that
never fire turn out to be few, the steady base is closer than this essay suggests. If they are
many, the ratchet is real, and the base can be lowered without touching the gates that catch
real bugs.

**Version 2 has been checked by an independent reader.** `paid-where-written-check.md`,
version 2 (LIN-3146), re-read every figure and outside source and weighed the argument.
Version 1's check was written by the essay's own session. This version carries the independent
check's corrections of figures and readings. Its findings on the argument are for John and are
in the check, not here.
